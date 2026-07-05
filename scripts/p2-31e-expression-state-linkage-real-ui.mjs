import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertNoScreenshotResidue,
  cleanupRealUiRun,
  click,
  connectToElectron,
  createRealUiRunContext,
  evaluate,
  findScreenshotResidue,
  log,
  readPrivacyCheckText,
  setDialogueMode,
  setPresenceMode,
  sleep,
  startElectron,
  stopElectron,
  typeText,
  waitFor,
  waitForWindow
} from "./support/real-ui-harness.mjs";
import { PET_TELEMETRY_ALLOWED_FIELDS } from "../src/shared/pet-telemetry-contract.ts";

const context = createRealUiRunContext({
  runName: "p2-31e-expression-state-linkage-real-ui",
  port: Number(process.env.P2_31E_CDP_PORT || 9632),
  env: {
    AI_DESKTOP_PET_PROACTIVE_SPEECH_BUBBLE_IDLE_INTERVAL_MS: process.env.P2_31E_IDLE_INTERVAL_MS || "60000"
  }
});

const requiredCaseIds = new Set([
  "chat-input-focus-listen-happy",
  "chat-reply-waiting-think-dark",
  "state-work-glasses",
  "state-game-gesture-game",
  "state-read-glasses",
  "state-sleep-presentation-only",
  "pet-edge-presentation-only",
  "rapid-touch-flustered-happy"
]);

const forbiddenOutputPatterns = [
  /sk-[A-Za-z0-9]/,
  /\.env\.local/i,
  /providerRequestBody/i,
  /factCardBody/i,
  /memoryContext\.cards/i,
  /"messages"\s*:|messages\s*:/i,
  /"content"\s*:|content\s*:/i,
  /prompt/i,
  /apiKey/i,
  /expressionName/i,
  /expressionPath/i,
  /resourcePath/i,
  /partId/i,
  /\.motion3\.json/i,
  /\.exp3\.json/i,
  /\b[A-Za-z]:[\\/]/
];

const telemetryAllowedFields = new Set(PET_TELEMETRY_ALLOWED_FIELDS);

async function main() {
  log(context, "run=p2-31e-expression-state-linkage-real-ui");
  const startedAt = Date.now();
  const checks = {};
  const cases = [];
  const deferredCases = [];

  try {
    const { pet } = await startApp();
    const chat = await openChatFromPet(pet);
    await sendChatMessage(chat, "p2-31e expression state linkage check");
    await waitFor(chat, "document.querySelector('#chat-input')?.disabled === false", { timeoutMs: 20_000 });
    await evaluate(chat, "document.querySelector('#chat-input')?.blur()");

    deferredCases.push({
      caseId: "chat-input-focus-listen-happy",
      reason: "chat_input_focus",
      stateId: "listen",
      actionType: "listen",
      expressionPresetId: "happy"
    });
    deferredCases.push({
      caseId: "chat-reply-waiting-think-dark",
      reason: "chat_reply_waiting",
      stateId: "think",
      actionType: "replyThinking",
      expressionPresetId: "dark"
    });
    await sleep(2_300);

    for (const definition of [
      {
        caseId: "state-work-glasses",
        reason: "state_work",
        stateId: "work",
        actionType: "workFocus",
        expressionPresetId: "glasses",
        modeId: "work"
      },
      {
        caseId: "state-game-gesture-game",
        reason: "state_game",
        stateId: "game",
        actionType: "gameReady",
        expressionPresetId: "gestureGame",
        modeId: "game"
      },
      {
        caseId: "state-read-glasses",
        reason: "state_read",
        stateId: "read",
        actionType: "readingIdle",
        expressionPresetId: "glasses",
        modeId: "reading"
      }
    ]) {
      cases.push(await runCase({
        ...definition,
        timeoutMs: 7_000,
        trigger: () => setDialogueMode(chat, definition.modeId)
      }));
      await sleep(2_300);
    }

    cases.push(await runCase({
      caseId: "state-sleep-presentation-only",
      reason: "state_sleep",
      stateId: "sleep",
      actionType: "doze",
      expressionPresetId: null,
      timeoutMs: 7_000,
      trigger: () => setPresenceMode(chat, "sleep")
    }));
    await sleep(2_300);

    cases.push(await runCase({
      caseId: "chat-reply-sustain-optional",
      reason: "chat_reply_sustain",
      stateId: "reply-sustain",
      actionType: "replySustain",
      expressionPresetId: "happy",
      required: false,
      timeoutMs: 10_000,
      skippedWhenMissing: "not-observed-with-fast-fake-provider",
      trigger: async () => {
        await setPresenceMode(chat, "default");
        await setDialogueMode(chat, "default");
        await sleep(800);
        await sendChatMessage(chat, "p2-31e reply sustain expression attempt");
        await waitFor(chat, "document.querySelector('#chat-input')?.disabled === false", { timeoutMs: 20_000 });
      }
    }));
    await sleep(2_000);

    cases.push(await runCase({
      caseId: "pet-edge-presentation-only",
      reason: "pet_edge_settled",
      stateId: "edge",
      actionType: "edgeGlance",
      expressionPresetId: null,
      timeoutMs: 8_000,
      trigger: () => dragPetToBottomEdge(pet)
    }));
    await sleep(2_000);

    cases.push(await runCase({
      caseId: "rapid-touch-flustered-happy",
      reason: "rapid_touch_combo",
      stateId: "flustered",
      actionType: "flusteredGlance",
      expressionPresetId: "happy",
      timeoutMs: 8_000,
      trigger: () => tapPetBodyRapidly(pet)
    }));

    const telemetryEvents = readTelemetryEvents();
    cases.unshift(...deferredCases.map((definition) => buildCaseFromTelemetry(telemetryEvents, definition)));
    const unsafeTelemetryFields = findUnsafeInteractionTelemetryFields(telemetryEvents);
    checks.telemetryPayloadAllowlist = unsafeTelemetryFields.length === 0;
    checks.requiredCasesPassed = cases
      .filter((item) => item.required)
      .every((item) => item.status === "passed");
    checks.optionalCasesHonest = cases
      .filter((item) => !item.required)
      .every((item) => item.status === "passed" || item.status === "skipped");
    checks.expressionPresetTelemetrySafe = cases
      .filter((item) => item.status === "passed")
      .every((item) => (
        item.expected.expressionPresetId === null
          ? item.observed.expressionPresetId === undefined
          : item.observed.expressionPresetId === item.expected.expressionPresetId
      ));

    const privacyText = stripKnownInternalRuntimeTelemetry(
      readPrivacyCheckText(context, ["progress.log", "electron.stdout.log", "electron.stderr.log"])
    );
    checks.noForbiddenText = !forbiddenOutputPatterns.some((pattern) => pattern.test(privacyText));
    assertNoScreenshotResidue(context);
    const residueBeforeCleanup = findScreenshotResidue(context).filter((path) => !path.includes(context.runParentDir));
    checks.noScreenshotResidueBeforeCleanup = residueBeforeCleanup.length === 0;

    const summary = {
      ok: Object.values(checks).every(Boolean),
      safeSummaryOnly: true,
      provider: "fake",
      durationMs: Date.now() - startedAt,
      checks,
      cases,
      unsafeTelemetryFieldCount: unsafeTelemetryFields.length,
      counts: countActionStarts(telemetryEvents)
    };
    checks.safeSummaryHasNoForbiddenText = isSafeSummary(summary);
    summary.ok = Object.values(checks).every(Boolean);
    writeResult(summary);

    if (!summary.ok) {
      process.exitCode = 1;
    }
  } catch (error) {
    writeResult({
      ok: false,
      safeSummaryOnly: true,
      provider: "fake",
      durationMs: Date.now() - startedAt,
      checks,
      cases,
      failureCategory: classifyError(error)
    });
    process.exitCode = 1;
  } finally {
    await stopElectron(context);
    if (process.env.P2_31E_KEEP_TMP !== "1") {
      cleanupRealUiRun(context);
    }
  }
}

async function startApp() {
  startElectron(context);
  await connectToElectron(context);
  const pet = await waitForWindow(context, "renderer/pet/index.html");
  await waitFor(pet, "Boolean(window.petApi)");
  await sleep(4_200);
  return { pet };
}

async function openChatFromPet(pet) {
  await evaluate(pet, "window.petApi?.openChat()");
  const chat = await waitForWindow(context, "renderer/chat/index.html");
  await waitFor(chat, "Boolean(document.querySelector('#chat-page'))");
  await waitFor(chat, "document.querySelector('#provider-status')?.innerText.includes('Fake Provider')");
  return chat;
}

async function sendChatMessage(chat, text) {
  await typeText(chat, "#chat-input", text);
  await click(chat, "#send-button");
}

async function runCase(definition) {
  const afterIndex = lastTelemetryIndex();
  try {
    await definition.trigger();
  } catch {
    return buildCaseResult({
      ...definition,
      afterIndex,
      status: definition.required === false ? "skipped" : "failed",
      skipReason: "trigger-error"
    });
  }

  return collectCase({ ...definition, afterIndex });
}

async function collectCase(definition) {
  const event = await waitForAction({
    actionType: definition.actionType,
    reason: definition.reason,
    stateId: definition.stateId,
    expressionPresetId: definition.expressionPresetId,
    afterIndex: definition.afterIndex ?? -1,
    timeoutMs: definition.timeoutMs
  });

  if (event) {
    return buildCaseResult({
      ...definition,
      event,
      status: "passed"
    });
  }

  const required = definition.required ?? requiredCaseIds.has(definition.caseId);
  return buildCaseResult({
    ...definition,
    status: required ? "failed" : "skipped",
    skipReason: required ? "not-observed" : definition.skippedWhenMissing ?? "not-covered"
  });
}

function buildCaseResult(definition) {
  const required = definition.required ?? requiredCaseIds.has(definition.caseId);

  return {
    caseId: definition.caseId,
    required,
    covered: definition.status === "passed",
    status: definition.status,
    ...(definition.skipReason ? { skipReason: definition.skipReason } : {}),
    expected: {
      stateId: definition.stateId,
      reason: definition.reason,
      actionType: definition.actionType,
      expressionPresetId: definition.expressionPresetId
    },
    observed: summarizeAction(definition.event)
  };
}

function buildCaseFromTelemetry(events, definition) {
  const event = events.find((candidate) => matchesExpectedAction(candidate, definition));

  return buildCaseResult({
    ...definition,
    event,
    status: event ? "passed" : "failed",
    skipReason: event ? undefined : "not-observed"
  });
}

function readTelemetryEvents() {
  const logDirectory = join(context.appDataDir, "logs");
  if (!existsSync(logDirectory)) {
    return [];
  }

  const events = [];
  const files = readdirSync(logDirectory)
    .filter((name) => name.startsWith("telemetry-") && name.endsWith(".jsonl"))
    .map((name) => join(logDirectory, name))
    .sort();

  for (const file of files) {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      try {
        events.push(JSON.parse(line));
      } catch {
        // Ignore a partial telemetry line from the running app.
      }
    }
  }

  return events.map((event, index) => ({ ...event, __index: index }));
}

function lastTelemetryIndex() {
  return readTelemetryEvents().length - 1;
}

async function waitForAction({
  actionType,
  reason,
  stateId,
  expressionPresetId,
  timeoutMs,
  afterIndex = -1
}) {
  return waitForTelemetry((event) => (
    event.__index > afterIndex &&
    matchesExpectedAction(event, {
      actionType,
      reason,
      stateId,
      expressionPresetId
    })
  ), timeoutMs);
}

function matchesExpectedAction(event, {
  actionType,
  reason,
  stateId,
  expressionPresetId
}) {
  if (
    event.type !== "pet_interaction_action_started" ||
    event.payload?.type !== actionType ||
    event.payload?.reason !== reason ||
    event.payload?.stateId !== stateId
  ) {
    return false;
  }

  if (expressionPresetId === null) {
    return event.payload?.expressionPresetId === undefined;
  }

  return event.payload?.expressionPresetId === expressionPresetId;
}

async function waitForTelemetry(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const event = readTelemetryEvents().find(predicate);
    if (event) {
      return event;
    }
    await sleep(150);
  }

  return null;
}

async function dragPetToBottomEdge(pet) {
  await dragWithOffsets(pet, 331, [[0, 900], [0, 1_800], [0, 3_000]], 80);
  await sleep(650);
}

async function dragWithOffsets(pet, pointerId, offsets, delayMs) {
  await dispatchPointerDown(pet, pointerId);
  for (const [offsetX, offsetY] of offsets) {
    await dispatchPointerMove(pet, pointerId, offsetX, offsetY);
    await sleep(delayMs);
  }
  const [lastX, lastY] = offsets.at(-1) ?? [0, 0];
  await dispatchPointerUp(pet, pointerId, lastX, lastY);
}

async function dispatchPointerDown(pet, pointerId) {
  await evaluate(pet, `
    (() => {
      const canvas = document.querySelector("#pet-canvas");
      if (!canvas) throw new Error("Missing pet canvas");
      const rect = canvas.getBoundingClientRect();
      const x = rect.left + rect.width * 0.5;
      const y = rect.top + rect.height * 0.48;
      window.__p231eDragBase = {
        screenX: window.screenX + x,
        screenY: window.screenY + y
      };
      canvas.dispatchEvent(new PointerEvent("pointerdown", {
        pointerId: ${pointerId},
        pointerType: "mouse",
        clientX: x,
        clientY: y,
        screenX: window.__p231eDragBase.screenX,
        screenY: window.__p231eDragBase.screenY,
        buttons: 1,
        bubbles: true
      }));
    })()
  `);
}

async function dispatchPointerMove(pet, pointerId, offsetX, offsetY) {
  await evaluate(pet, `
    (() => {
      const canvas = document.querySelector("#pet-canvas");
      if (!canvas) throw new Error("Missing pet canvas");
      const rect = canvas.getBoundingClientRect();
      const x = rect.left + rect.width * 0.5;
      const y = rect.top + rect.height * 0.48;
      const base = window.__p231eDragBase ?? {
        screenX: window.screenX + x,
        screenY: window.screenY + y
      };
      canvas.dispatchEvent(new PointerEvent("pointermove", {
        pointerId: ${pointerId},
        pointerType: "mouse",
        clientX: x + ${offsetX},
        clientY: y + ${offsetY},
        screenX: base.screenX + ${offsetX},
        screenY: base.screenY + ${offsetY},
        buttons: 1,
        bubbles: true
      }));
    })()
  `);
}

async function dispatchPointerUp(pet, pointerId, offsetX, offsetY) {
  await evaluate(pet, `
    (() => {
      const canvas = document.querySelector("#pet-canvas");
      if (!canvas) throw new Error("Missing pet canvas");
      const rect = canvas.getBoundingClientRect();
      const x = rect.left + rect.width * 0.5;
      const y = rect.top + rect.height * 0.48;
      const base = window.__p231eDragBase ?? {
        screenX: window.screenX + x,
        screenY: window.screenY + y
      };
      canvas.dispatchEvent(new PointerEvent("pointerup", {
        pointerId: ${pointerId},
        pointerType: "mouse",
        clientX: x + ${offsetX},
        clientY: y + ${offsetY},
        screenX: base.screenX + ${offsetX},
        screenY: base.screenY + ${offsetY},
        bubbles: true
      }));
    })()
  `);
}

async function tapPetBodyRapidly(pet) {
  for (let index = 0; index < 5; index += 1) {
    await tapPetBody(pet, 400 + index);
    await sleep(90);
  }
  await sleep(800);
}

async function tapPetBody(pet, pointerId) {
  await evaluate(pet, `
    (() => {
      const canvas = document.querySelector("#pet-canvas");
      if (!canvas) throw new Error("Missing pet canvas");
      const rect = canvas.getBoundingClientRect();
      const x = rect.left + rect.width * 0.5;
      const y = rect.top + rect.height * 0.48;
      canvas.dispatchEvent(new PointerEvent("pointerdown", {
        pointerId: ${pointerId},
        pointerType: "mouse",
        clientX: x,
        clientY: y,
        screenX: window.screenX + x,
        screenY: window.screenY + y,
        buttons: 1,
        bubbles: true
      }));
      canvas.dispatchEvent(new PointerEvent("pointerup", {
        pointerId: ${pointerId},
        pointerType: "mouse",
        clientX: x,
        clientY: y,
        screenX: window.screenX + x,
        screenY: window.screenY + y,
        bubbles: true
      }));
    })()
  `);
}

function summarizeAction(event) {
  if (!event) {
    return null;
  }

  const payload = event.payload ?? {};
  return {
    eventType: event.type === "pet_interaction_action_started" ? "started" : event.type,
    type: payload.type,
    reason: payload.reason,
    stateId: payload.stateId,
    modeId: payload.modeId,
    presenceModeId: payload.presenceModeId,
    expressionPresetId: payload.expressionPresetId,
    durationMs: payload.durationMs,
    skipReason: payload.skipReason
  };
}

function findUnsafeInteractionTelemetryFields(events) {
  const unsafe = new Set();
  for (const event of events) {
    if (!String(event.type).startsWith("pet_interaction_action_") || !event.payload) {
      continue;
    }
    for (const key of Object.keys(event.payload)) {
      if (!telemetryAllowedFields.has(key)) {
        unsafe.add(key);
      }
    }
  }
  return [...unsafe].sort();
}

function countActionStarts(events) {
  const counts = {};
  for (const event of events) {
    if (event.type !== "pet_interaction_action_started") {
      continue;
    }
    const expression = event.payload?.expressionPresetId ?? "none";
    const key = `${event.payload?.type}:${event.payload?.reason}:${event.payload?.stateId ?? "none"}:${expression}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

function isSafeSummary(value) {
  const serialized = JSON.stringify(value);
  return !forbiddenOutputPatterns.some((pattern) => pattern.test(serialized));
}

function stripKnownInternalRuntimeTelemetry(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => !(line.includes('"type":"startup"') && line.includes('"userDataPath"')))
    .join("\n");
}

function writeResult(summary) {
  writeFileSync(context.resultPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  console.log(JSON.stringify(summary, null, 2));
}

function classifyError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (/Timed out/i.test(message)) {
    return "timeout";
  }
  if (/Screenshot residue/i.test(message)) {
    return "screenshot_residue";
  }
  return "script_failed";
}

await main();
