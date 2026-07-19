import { spawn, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  cleanupRealUiRun,
  connectToElectron,
  createRealUiRunContext,
  evaluate,
  findScreenshotResidue,
  sleep,
  startElectron,
  stopElectron,
  waitFor,
  waitForWindow
} from "./support/real-ui-harness.mjs";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const RUN_NAME = "p2-77-long-motion-runtime-real-ui";
const TELEMETRY_FAILURE_TYPES = new Set([
  "recovery_failed",
  "renderer_process_gone",
  "child_process_gone",
  "webgl_context_lost"
]);
const FORBIDDEN_TELEMETRY_KEYS = new Set([
  "commandLine",
  "content",
  "filePath",
  "mediaTitle",
  "message",
  "processName",
  "query",
  "snippet",
  "text",
  "title",
  "url",
  "windowTitle"
]);

export const P2_77_PRODUCTION_MOTION_CASES = [
  { actionType: "appearance", motionPresetId: "surprised-small", reason: "startup_first_visible_frame" },
  { actionType: "softSmile", motionPresetId: "happy-small", reason: "state_idle" },
  { actionType: "flusteredGlance", motionPresetId: "flustered-small", reason: "rapid_touch_combo" },
  { actionType: "doze", motionPresetId: "yawn-once", reason: "state_sleep" },
  { actionType: "headPat", motionPresetId: "head-pat-linger", reason: "click_head" },
  { actionType: "bodyAttentionTurn", motionPresetId: "body-attention-turn", reason: "click_body" },
  { actionType: "dialogueOpenWelcome", motionPresetId: "dialogue-open-welcome", reason: "chat_opened" },
  { actionType: "replyWarmSettle", motionPresetId: "reply-warm-settle", reason: "chat_reply_completed" },
  { actionType: "musicListenSway", motionPresetId: "music-listen-sway", reason: "state_music_playing_stable" },
  { actionType: "gamePresenceGlance", motionPresetId: "game-presence-glance", reason: "state_game_presence_stable" },
  { actionType: "searchNoteSettle", motionPresetId: "search-note-settle", reason: "state_search_cited" },
  { actionType: "returnFromIdle", motionPresetId: "return-from-idle", reason: "return_from_idle" },
  { actionType: "eveningWindowGlance", motionPresetId: "evening-window-glance", reason: "evening_companion_tick" },
  { actionType: "longWorkRecovery", motionPresetId: "long-work-recovery", reason: "long_work_session_complete" }
];

export const P2_77_REAL_UI_CASES = P2_77_PRODUCTION_MOTION_CASES.filter((item) => [
  "appearance",
  "flusteredGlance",
  "headPat",
  "bodyAttentionTurn",
  "dialogueOpenWelcome",
  "replyWarmSettle",
  "searchNoteSettle"
].includes(item.actionType));

export const P2_77_POLICY_ONLY_CASES = P2_77_PRODUCTION_MOTION_CASES.filter((item) => [
  "softSmile",
  "doze",
  "musicListenSway",
  "gamePresenceGlance",
  "returnFromIdle",
  "eveningWindowGlance",
  "longWorkRecovery"
].includes(item.actionType));

export function evaluateNativeLifecycle(events, expected, afterIndex = -1) {
  const relevant = events.filter((event) => event.__index > afterIndex);
  const starts = relevant.filter((event) => (
    event.type === "pet_interaction_action_started" &&
    event.payload?.type === expected.actionType &&
    event.payload?.reason === expected.reason &&
    event.payload?.motionPresetId === expected.motionPresetId
  ));
  const finishes = relevant.filter((event) => (
    event.type === "pet_interaction_action_finished" &&
    event.payload?.type === expected.actionType &&
    event.payload?.reason === expected.reason &&
    event.payload?.motionPresetId === expected.motionPresetId
  ));
  const completed = finishes.filter((event) => event.payload?.terminalStatus === "completed");
  const unsafeTerminal = finishes.filter((event) => ["failed", "timed_out"].includes(event.payload?.terminalStatus));
  const strictOrder = starts.length === 1 && completed.length === 1 && starts[0].__index < completed[0].__index;

  return {
    actionType: expected.actionType,
    motionPresetId: expected.motionPresetId,
    reason: expected.reason,
    startedCount: starts.length,
    finishedCount: finishes.length,
    completedCount: completed.length,
    observedTerminalStatuses: [...new Set(finishes.map((event) => event.payload?.terminalStatus ?? "none"))],
    unsafeTerminalCount: unsafeTerminal.length,
    strictOrder,
    passed: strictOrder && unsafeTerminal.length === 0
  };
}

export function evaluateTelemetrySafety(events) {
  const failureEvents = events.filter((event) => (
    TELEMETRY_FAILURE_TYPES.has(event.type) ||
    (event.type === "pet_interaction_action_finished" &&
      ["failed", "timed_out"].includes(event.payload?.terminalStatus))
  ));
  const forbiddenKeys = [...new Set(events.flatMap((event) => (
    Object.keys(event.payload ?? {}).filter((key) => FORBIDDEN_TELEMETRY_KEYS.has(key))
  )))];

  return {
    passed: failureEvents.length === 0 && forbiddenKeys.length === 0,
    failureCount: failureEvents.length,
    forbiddenKeys
  };
}

async function main() {
  const context = createRealUiRunContext({
    runName: RUN_NAME,
    port: Number(process.env.P2_77_CDP_PORT || 9697),
    env: {
      AI_DESKTOP_PET_PROVIDER: "fake",
      AI_DESKTOP_PET_PROACTIVE_SPEECH_BUBBLE_IDLE_INTERVAL_MS: "600000",
      AI_DESKTOP_PET_LOW_FREQUENCY_COMPANION_EVENT_MINIMUM_INTERVAL_MS: "600000"
    },
    tmpResiduePatterns: [/^p2-77-long-motion-runtime-real-ui$/i]
  });
  context.electronArgs = [
    "--disable-background-timer-throttling",
    "--disable-backgrounding-occluded-windows",
    "--disable-renderer-backgrounding"
  ];
  const startedAt = Date.now();
  const screenshotBaseline = findExternalScreenshotResidue(context);
  const realUiCases = [];
  let technicalPlayback = null;
  let policyTests = null;
  let telemetrySafety = null;
  let failure = null;
  let electronPid = null;
  const bundledSearchServerPath = join(ROOT, "dist", "main", "services", "search", "baidu-search-mcp-server.js");
  const fakeSearchRecordPath = join(context.runDir, "bundled-mcp-fixture-calls.jsonl");
  let bundledSearchServerBackup = null;
  let bundledFixtureInstalled = false;
  let fakeMcpEvidence = {
    kind: "Fake MCP",
    configured: false,
    networkUsed: false,
    citationCount: 0,
    toolCallCount: 0,
    error: null
  };
  let diagnostics = [];
  const cleanup = {
    electronStopped: false,
    bundledFixtureRestored: false,
    screenshotResidueAdded: [],
    tmpRemoved: false
  };

  try {
    technicalPlayback = await runTechnicalPlaybackGate();
    policyTests = await runPolicyOnlyGate();

    if (!existsSync(bundledSearchServerPath)) {
      throw new Error("bundled-mcp-server-missing");
    }
    bundledSearchServerBackup = readFileSync(bundledSearchServerPath);
    writeFileSync(
      bundledSearchServerPath,
      createFakeMcpSearchServerSource(fakeSearchRecordPath),
      "utf8"
    );
    bundledFixtureInstalled = true;

    startElectron(context);
    electronPid = context.child?.pid ?? null;
    await connectToElectron(context, 40_000);
    const pet = await waitForWindow(context, "renderer/pet/index.html", 30_000);
    await waitFor(pet, "Boolean(window.petApi && document.querySelector('#pet-canvas'))", { timeoutMs: 20_000 });
    await bringPageToFront(pet);

    realUiCases.push(await observeExistingLifecycle(context, P2_77_REAL_UI_CASES[0], -1));
    await settleGlobalActionCooldown();
    realUiCases.push(await observeTriggeredLifecycle(context, P2_77_REAL_UI_CASES.find((item) => item.actionType === "headPat"), async () => {
      await bringPageToFront(pet);
      await clickPet(pet, "head");
    }));
    await settleGlobalActionCooldown();
    realUiCases.push(await observeTriggeredLifecycle(context, P2_77_REAL_UI_CASES.find((item) => item.actionType === "bodyAttentionTurn"), async () => {
      await bringPageToFront(pet);
      await clickPet(pet, "body");
    }));

    await settleGlobalActionCooldown();
    const welcomeCase = P2_77_REAL_UI_CASES.find((item) => item.actionType === "dialogueOpenWelcome");
    const welcomeStartIndex = lastTelemetryIndex(context);
    await evaluate(pet, "window.petApi?.openChat()");
    const chat = await waitForWindow(context, "renderer/chat/index.html", 20_000);
    await waitFor(chat, "Boolean(document.querySelector('#chat-page') && document.querySelector('#chat-input'))", { timeoutMs: 15_000 });
    await bringPageToFront(pet);
    await waitFor(chat, "window.webSearchApi.getStatus().then((status) => status.enabled === true && status.commandName === 'bundled-baidu-search' && status.toolName === 'search')", {
      timeoutMs: 5_000
    });
    realUiCases.push(await captureLifecycle(context, welcomeCase, welcomeStartIndex));

    await sleep(550);
    await observeNonMotionAction(context, "listen", "chat_input_focus", async () => {
      await evaluate(chat, "document.querySelector('#chat-input')?.blur()");
      await sleep(250);
      await evaluate(chat, "document.querySelector('#chat-input')?.focus()");
    });
    realUiCases.push(await observeTriggeredLifecycle(
      context,
      P2_77_REAL_UI_CASES.find((item) => item.actionType === "replyWarmSettle"),
      async () => {
        await submitChatTurn(chat, "请说明你的身份和人设，并用完整的一段话回答。");
        await bringPageToFront(pet);
      }
    ));
    await waitForChatSettled(chat);

    await settleGlobalActionCooldown();
    const searchCase = P2_77_REAL_UI_CASES.find((item) => item.actionType === "searchNoteSettle");
    try {
      const beforeCitationCount = await evaluate(chat, "document.querySelectorAll('.message-pet .message-citations').length");
      const searchLifecycle = await observeTriggeredLifecycle(
        context,
        searchCase,
        async () => {
          await submitChatTurn(chat, "请联网搜索一条用于动作验收的公开资料。");
          await bringPageToFront(pet);
        }
      );
      await waitForChatSettled(chat);
      await waitFor(chat, `document.querySelectorAll('.message-pet .message-citations').length > ${beforeCitationCount}`, {
        timeoutMs: 10_000
      });
      const citationCount = await evaluate(chat, `
        (() => {
          const citations = [...document.querySelectorAll(".message-pet .message-citations")];
          return citations.at(-1)?.querySelectorAll(".message-citation-item").length ?? 0;
        })()
      `);
      const toolCallCount = readFakeMcpToolCallCount(fakeSearchRecordPath);
      if (!searchLifecycle.passed || citationCount < 1 || toolCallCount < 1) {
        throw new Error("fake-mcp-citation-evidence-incomplete");
      }
      realUiCases.push(searchLifecycle);
      fakeMcpEvidence = {
        kind: "Fake MCP",
        configured: true,
        networkUsed: false,
        citationCount,
        toolCallCount,
        error: null
      };
    } catch (error) {
      const searchSetupError = sanitizeError(error);
      fakeMcpEvidence = {
        kind: "Fake MCP",
        configured: bundledFixtureInstalled,
        networkUsed: false,
        citationCount: 0,
        toolCallCount: readFakeMcpToolCallCount(fakeSearchRecordPath),
        error: searchSetupError.message
      };
      realUiCases.push({
        ...searchCase,
        startedCount: 0,
        finishedCount: 0,
        completedCount: 0,
        observedTerminalStatuses: ["none"],
        unsafeTerminalCount: 0,
        strictOrder: false,
        passed: false,
        failure: `fake-mcp-real-main-search-failed:${searchSetupError.message}`
      });
    }

    await sleep(550);
    realUiCases.push(await observeTriggeredLifecycle(
      context,
      P2_77_REAL_UI_CASES.find((item) => item.actionType === "flusteredGlance"),
      async () => {
        await bringPageToFront(pet);
        await clickPetRapidly(pet);
      }
    ));

    telemetrySafety = evaluateTelemetrySafety(readTelemetryEvents(context));
    if (!telemetrySafety.passed) {
      throw new Error("telemetry-safety-failed");
    }
  } catch (error) {
    failure = sanitizeError(error);
    diagnostics = readTelemetryEvents(context)
      .filter((event) => event.type.startsWith("pet_interaction_action_"))
      .slice(-12)
      .map(summarizeActionTelemetry);
  } finally {
    await stopElectron(context);
    cleanup.electronStopped = await ensureElectronStopped(context.port, electronPid);
    if (bundledFixtureInstalled && bundledSearchServerBackup) {
      try {
        writeFileSync(bundledSearchServerPath, bundledSearchServerBackup);
        cleanup.bundledFixtureRestored = true;
      } catch (error) {
        failure ??= sanitizeError(error);
      }
    } else {
      cleanup.bundledFixtureRestored = true;
    }
    cleanup.screenshotResidueAdded = findExternalScreenshotResidue(context)
      .filter((path) => !screenshotBaseline.includes(path));
    cleanupRealUiRun(context);
    cleanup.tmpRemoved = !existsSync(context.runParentDir);
  }

  telemetrySafety ??= {
    passed: failure?.message !== "telemetry-safety-failed",
    failureCount: 0,
    forbiddenKeys: []
  };
  const allRealUiPassed = realUiCases.length === P2_77_REAL_UI_CASES.length && realUiCases.every((item) => item.passed);
  const coverageGaps = realUiCases
    .filter((item) => !item.passed)
    .map((item) => ({
      actionType: item.actionType,
      motionPresetId: item.motionPresetId,
      reason: item.reason,
      failure: item.failure ?? "native-lifecycle-not-observed"
    }));
  const summary = {
    ok: failure === null &&
      technicalPlayback?.passed === true &&
      policyTests?.passed === true &&
      allRealUiPassed &&
      telemetrySafety.passed &&
      cleanup.electronStopped &&
      cleanup.bundledFixtureRestored &&
      cleanup.screenshotResidueAdded.length === 0 &&
      cleanup.tmpRemoved,
    safeSummaryOnly: true,
    productionElectron: true,
    externalModelUsed: false,
    arbitraryActionPayloadEntry: false,
    durationMs: Date.now() - startedAt,
    productionMotionCoverage: {
      total: P2_77_PRODUCTION_MOTION_CASES.length,
      technicalPlayback
    },
    realUi: {
      actualProductionEvents: true,
      expectedCount: P2_77_REAL_UI_CASES.length,
      observedCount: realUiCases.length,
      coverageGapCount: coverageGaps.length,
      coverageGaps,
      cases: realUiCases
    },
    policyOnly: {
      simulatedPolicyOnly: true,
      realOsStateClaimed: false,
      realLongWaitClaimed: false,
      cases: P2_77_POLICY_ONLY_CASES.map(({ actionType, motionPresetId, reason }) => ({ actionType, motionPresetId, reason })),
      tests: policyTests
    },
    fakeMcpEvidence,
    telemetrySafety,
    diagnostics,
    cleanup,
    failure
  };

  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) {
    process.exitCode = 1;
  }
}

async function runTechnicalPlaybackGate() {
  const child = await runNode([
    "--experimental-strip-types",
    "scripts/p2-65-reaction-motion-technical-playback.mts"
  ], 90_000);
  const parsed = parseLastJsonObject(child.stdout);
  if (child.exitCode !== 0 || !parsed?.ok || parsed.cases?.length !== P2_77_PRODUCTION_MOTION_CASES.length) {
    throw new Error("technical-playback-gate-failed");
  }
  if (parsed.unmappedRegisteredPresetIds?.length !== 0 || parsed.cubismParsePresetIds?.length !== P2_77_PRODUCTION_MOTION_CASES.length) {
    throw new Error("technical-playback-coverage-incomplete");
  }
  const cases = parsed.cases.map((item) => ({
    actionType: item.actionType,
    motionPresetId: item.motionPresetId,
    started: item.startStatus === "started",
    completed: item.completionStatus === "completed",
    restored: item.restoreStatus === "restored",
    released: item.cleanupStatus === "released"
  }));
  return {
    passed: cases.every((item) => item.started && item.completed && item.restored && item.released),
    caseCount: cases.length,
    realCubismParseCount: parsed.cubismParsePresetIds.length,
    cases
  };
}

async function runPolicyOnlyGate() {
  const child = await runNode([
    "--experimental-strip-types",
    "--test",
    "scripts/p2-77-runtime-trigger-policy.test.mts",
    "scripts/desktop-context-monitor.test.mts"
  ], 45_000);
  if (child.exitCode !== 0) {
    throw new Error("policy-only-gate-failed");
  }
  return {
    passed: true,
    simulatedPolicyOnly: true,
    realOsStateClaimed: false,
    realLongWaitClaimed: false,
    testFiles: 2
  };
}

function runNode(args, timeoutMs) {
  return new Promise((resolveRun) => {
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env: process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      resolveRun({ exitCode, stdout, stderr, timedOut });
    });
  });
}

function parseLastJsonObject(output) {
  for (const line of output.split(/\r?\n/u).reverse()) {
    if (!line.trim().startsWith("{")) continue;
    try {
      return JSON.parse(line);
    } catch {}
  }
  return null;
}

async function observeExistingLifecycle(context, expected, afterIndex) {
  return captureLifecycle(context, expected, afterIndex);
}

async function observeTriggeredLifecycle(context, expected, trigger) {
  if (!expected) throw new Error("missing-expected-lifecycle-case");
  const afterIndex = lastTelemetryIndex(context);
  await trigger();
  return captureLifecycle(context, expected, afterIndex);
}

async function captureLifecycle(context, expected, afterIndex) {
  try {
    return await requireLifecycle(context, expected, afterIndex);
  } catch (error) {
    return {
      ...evaluateNativeLifecycle(readTelemetryEvents(context), expected, afterIndex),
      failure: sanitizeError(error).message
    };
  }
}

async function requireLifecycle(context, expected, afterIndex) {
  await requireTelemetry(context, (event) => (
    event.__index > afterIndex &&
    event.type === "pet_interaction_action_started" &&
    event.payload?.type === expected.actionType &&
    event.payload?.reason === expected.reason &&
    event.payload?.motionPresetId === expected.motionPresetId
  ), 12_000, `${expected.actionType}-started`);
  await requireTelemetry(context, (event) => (
    event.__index > afterIndex &&
    event.type === "pet_interaction_action_finished" &&
    event.payload?.type === expected.actionType &&
    event.payload?.reason === expected.reason &&
    event.payload?.motionPresetId === expected.motionPresetId &&
    event.payload?.terminalStatus === "completed"
  ), 15_000, `${expected.actionType}-completed`);
  const result = evaluateNativeLifecycle(readTelemetryEvents(context), expected, afterIndex);
  if (!result.passed) throw new Error(`native-lifecycle-invalid:${expected.actionType}`);
  return result;
}

async function observeNonMotionAction(context, actionType, reason, trigger) {
  const afterIndex = lastTelemetryIndex(context);
  await trigger();
  await requireTelemetry(context, (event) => (
    event.__index > afterIndex &&
    event.type === "pet_interaction_action_started" &&
    event.payload?.type === actionType &&
    event.payload?.reason === reason
  ), 5_000, `${actionType}-started`);
  await requireTelemetry(context, (event) => (
    event.__index > afterIndex &&
    event.type === "pet_interaction_action_finished" &&
    event.payload?.type === actionType &&
    event.payload?.reason === reason
  ), 5_000, `${actionType}-completed`);
}

function readTelemetryEvents(context) {
  const logDirectory = join(context.appDataDir, "logs");
  if (!existsSync(logDirectory)) return [];
  const events = [];
  for (const name of readdirSync(logDirectory).filter((entry) => entry.startsWith("telemetry-") && entry.endsWith(".jsonl")).sort()) {
    for (const line of readFileSync(join(logDirectory, name), "utf8").split(/\r?\n/u)) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line));
      } catch {}
    }
  }
  return events.map((event, index) => ({ ...event, __index: index }));
}

function lastTelemetryIndex(context) {
  return readTelemetryEvents(context).length - 1;
}

async function requireTelemetry(context, predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = readTelemetryEvents(context).find(predicate);
    if (match) return match;
    await sleep(120);
  }
  throw new Error(`telemetry-timeout:${label}`);
}

async function clickPet(pet, hitArea) {
  const yRatio = hitArea === "head" ? 0.2 : 0.48;
  await evaluate(pet, createPointerSequenceExpression(yRatio, 77, 1));
}

async function settleGlobalActionCooldown() {
  await sleep(550);
}

async function clickPetRapidly(pet) {
  await evaluate(pet, createPointerSequenceExpression(0.48, 177, 3));
}

function createPointerSequenceExpression(yRatio, firstPointerId, count) {
  return `
    (() => {
      const canvas = document.querySelector("#pet-canvas");
      if (!canvas) throw new Error("missing-pet-canvas");
      const rect = canvas.getBoundingClientRect();
      const x = rect.left + rect.width * 0.5;
      const y = rect.top + rect.height * ${yRatio};
      for (let index = 0; index < ${count}; index += 1) {
        const pointerId = ${firstPointerId} + index;
        for (const type of ["pointerdown", "pointerup"]) {
          canvas.dispatchEvent(new PointerEvent(type, {
            pointerId,
            pointerType: "mouse",
            clientX: x,
            clientY: y,
            screenX: x,
            screenY: y,
            buttons: type === "pointerdown" ? 1 : 0,
            bubbles: true
          }));
        }
      }
      return true;
    })()
  `;
}

function bringPageToFront(page) {
  return page.cdp.send("Page.bringToFront");
}

async function submitChatTurn(chat, prompt) {
  await evaluate(chat, `
    (() => {
      const input = document.querySelector("#chat-input");
      const form = document.querySelector("#chat-form");
      if (!input || !form) throw new Error("missing-chat-form");
      input.value = ${JSON.stringify(prompt)};
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      form.requestSubmit();
      return true;
    })()
  `);
}

async function waitForChatSettled(chat) {
  await waitFor(chat, `
    (() => {
      const input = document.querySelector("#chat-input");
      const replies = [...document.querySelectorAll(".message-pet .message-content")];
      return Boolean(input && !input.disabled && replies.at(-1)?.textContent?.trim().length);
    })()
  `, { timeoutMs: 20_000 });
}

function readFakeMcpToolCallCount(recordPath) {
  if (!existsSync(recordPath)) return 0;
  return readFileSync(recordPath, "utf8")
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 0)
    .length;
}

function createFakeMcpSearchServerSource(recordPath) {
  return `
const { writeFileSync } = require("node:fs");
const { createInterface } = require("node:readline");
const recordPath = ${JSON.stringify(recordPath)};
const reader = createInterface({ input: process.stdin });
reader.on("line", (line) => {
  const message = JSON.parse(line);
  if (message.method === "initialize") {
    respond(message.id, { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "p2-77-bundled-mcp-fixture", version: "0.0.0" } });
    return;
  }
  if (message.method === "tools/list") {
    respond(message.id, { tools: [{ name: "search", description: "P2-77 local Fake MCP fixture", inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] } }] });
    return;
  }
  if (message.method === "tools/call") {
    writeFileSync(recordPath, JSON.stringify({ method: message.method }) + "\\n", { flag: "a" });
    const results = [{ title: "P2-77 Fake MCP citation fixture", snippet: "Local deterministic citation fixture with no network access.", url: "https://example.test/p2-77" }];
    respond(message.id, { structuredContent: { results }, content: [{ type: "text", text: JSON.stringify({ results }) }] });
    return;
  }
  if (Object.prototype.hasOwnProperty.call(message, "id")) respond(message.id, {});
});
function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
}
`;
}

function findExternalScreenshotResidue(context) {
  return findScreenshotResidue(context)
    .filter((path) => !path.includes(context.runParentDir))
    .sort();
}

async function ensureElectronStopped(port, pid) {
  if (await waitForElectronStopped(port, pid, 5_000)) return true;
  if (pid) {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true, stdio: "ignore" });
  }
  return waitForElectronStopped(port, pid, 5_000);
}

async function waitForElectronStopped(port, pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const endpointClosed = await fetch(`http://127.0.0.1:${port}/json/version`)
      .then(() => false)
      .catch(() => true);
    let processStopped = true;
    if (pid) {
      try {
        process.kill(pid, 0);
        processStopped = false;
      } catch {}
    }
    if (endpointClosed && processStopped) return true;
    await sleep(200);
  }
  return false;
}

function sanitizeError(error) {
  const message = String(error instanceof Error ? error.message : error);
  return {
    category: /timeout/i.test(message) ? "real_ui_timeout" : "failed",
    message: message.slice(0, 160)
  };
}

function summarizeActionTelemetry(event) {
  return {
    type: event.type,
    actionType: event.payload?.type ?? null,
    reason: event.payload?.reason ?? null,
    motionPresetId: event.payload?.motionPresetId ?? null,
    terminalStatus: event.payload?.terminalStatus ?? null,
    skipReason: event.payload?.skipReason ?? null,
    activeType: event.payload?.activeType ?? null
  };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  await main();
}
