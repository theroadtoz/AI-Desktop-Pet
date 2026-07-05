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
import {
  PET_LAYERED_ACTION_DECISION_CATALOG,
  getPetLayeredActionDecisionForReason
} from "../src/shared/pet-layered-action-decision.ts";
import { PET_TELEMETRY_ALLOWED_FIELDS } from "../src/shared/pet-telemetry-contract.ts";

const context = createRealUiRunContext({
  runName: "p2-31d-layered-action-matrix-real-ui",
  port: Number(process.env.P2_31D_CDP_PORT || 9631),
  env: {
    AI_DESKTOP_PET_PROACTIVE_SPEECH_BUBBLE_IDLE_INTERVAL_MS: process.env.P2_31D_IDLE_INTERVAL_MS || "60000"
  }
});

const requiredCaseIds = new Set([
  "chat-opened-listen",
  "chat-input-focus-listen",
  "chat-reply-waiting-think",
  "state-work",
  "state-game",
  "state-read",
  "state-sleep",
  "pet-edge-settled",
  "rapid-touch-combo"
]);

const visibleMatrixExpectations = [
  { reason: "chat_opened", stateId: "listen", actionType: "listen" },
  { reason: "chat_input_focus", stateId: "listen", actionType: "listen" },
  { reason: "chat_reply_waiting", stateId: "think", actionType: "replyThinking" },
  { reason: "state_work", stateId: "work", actionType: "workFocus" },
  { reason: "state_game", stateId: "game", actionType: "gameReady" },
  { reason: "state_read", stateId: "read", actionType: "readingIdle" },
  { reason: "state_sleep", stateId: "sleep", actionType: "doze" },
  { reason: "chat_reply_sustain", stateId: "reply-sustain", actionType: "replySustain" },
  { reason: "pet_edge_settled", stateId: "edge", actionType: "edgeGlance" },
  { reason: "rapid_touch_combo", stateId: "flustered", actionType: "flusteredGlance" }
];

const catalogOnlyStates = ["idle", "greet", "local-model-busy"];
const telemetryAllowedFields = new Set(PET_TELEMETRY_ALLOWED_FIELDS);

const forbiddenOutputPatterns = [
  /sk-[A-Za-z0-9]/,
  /\.env\.local/i,
  /providerRequestBody/i,
  /factCardBody/i,
  /"messages"\s*:|messages\s*:/i,
  /"content"\s*:|content\s*:/i,
  /prompt/i,
  /apiKey/i,
  /expressionName/i,
  /partId/i,
  /\.motion3\.json/i,
  /\.exp3\.json/i,
  /\b[A-Za-z]:[\\/]/
];

async function main() {
  log(context, "run=p2-31d-layered-action-matrix-real-ui");
  const startedAt = Date.now();
  const checks = {};
  const cases = [];

  try {
    const { pet } = await startApp();
    const openChatStartIndex = lastTelemetryIndex();
    const chat = await openChatFromPet(pet);
    cases.push(await collectCase({
      caseId: "chat-opened-listen",
      reason: "chat_opened",
      afterIndex: openChatStartIndex,
      timeoutMs: 6_000
    }));
    await sleep(1_800);

    cases.push(await runCase({
      caseId: "chat-input-focus-listen",
      reason: "chat_input_focus",
      timeoutMs: 6_000,
      trigger: async () => {
        await evaluate(chat, "document.querySelector('#chat-input')?.blur()");
        await sleep(250);
        await evaluate(chat, "document.querySelector('#chat-input')?.focus()");
      }
    }));
    await sleep(1_800);

    cases.push(await runCase({
      caseId: "chat-reply-waiting-think",
      reason: "chat_reply_waiting",
      timeoutMs: 8_000,
      trigger: async () => {
        await sendChatMessage(chat, "p2-31d concise state check");
        await waitFor(chat, "document.querySelector('#chat-input')?.disabled === false", { timeoutMs: 20_000 });
        await evaluate(chat, "document.querySelector('#chat-input')?.blur()");
      }
    }));
    await sleep(2_300);

    for (const definition of [
      { caseId: "state-work", reason: "state_work", modeId: "work" },
      { caseId: "state-game", reason: "state_game", modeId: "game" },
      { caseId: "state-read", reason: "state_read", modeId: "reading" }
    ]) {
      cases.push(await runCase({
        caseId: definition.caseId,
        reason: definition.reason,
        timeoutMs: 7_000,
        trigger: () => setDialogueMode(chat, definition.modeId)
      }));
      await sleep(2_300);
    }

    cases.push(await runCase({
      caseId: "state-sleep",
      reason: "state_sleep",
      timeoutMs: 7_000,
      trigger: () => setPresenceMode(chat, "sleep")
    }));
    await sleep(2_300);

    cases.push(await runCase({
      caseId: "chat-reply-sustain",
      reason: "chat_reply_sustain",
      required: false,
      timeoutMs: 10_000,
      skippedWhenMissing: "not-observed-with-fast-fake-provider",
      trigger: async () => {
        await setPresenceMode(chat, "default");
        await sleep(800);
        await sendChatMessage(chat, "p2-31d detailed reply sustain attempt");
        await waitFor(chat, "document.querySelector('#chat-input')?.disabled === false", { timeoutMs: 20_000 });
      }
    }));
    await sleep(2_000);

    cases.push(await runCase({
      caseId: "pet-edge-settled",
      reason: "pet_edge_settled",
      timeoutMs: 8_000,
      trigger: () => dragPetToBottomEdge(pet)
    }));
    await sleep(2_000);

    cases.push(await runCase({
      caseId: "rapid-touch-combo",
      reason: "rapid_touch_combo",
      timeoutMs: 8_000,
      trigger: () => tapPetBodyRapidly(pet)
    }));

    const telemetryEvents = readTelemetryEvents();
    const unsafeTelemetryFields = findUnsafeInteractionTelemetryFields(telemetryEvents);
    checks.telemetryPayloadAllowlist = unsafeTelemetryFields.length === 0;
    checks.catalogMatchesVisibleMatrix = visibleMatrixExpectations.every((expected) => {
      const decision = getPetLayeredActionDecisionForReason(expected.reason);
      return decision.stateId === expected.stateId && decision.actionType === expected.actionType;
    });
    checks.catalogOnlyStatesRecorded = catalogOnlyStates.every((stateId) => Boolean(PET_LAYERED_ACTION_DECISION_CATALOG[stateId]));
    checks.requiredCasesPassed = cases
      .filter((item) => item.required)
      .every((item) => item.status === "passed");
    checks.optionalCasesHonest = cases
      .filter((item) => !item.required)
      .every((item) => item.status === "passed" || item.status === "skipped");

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
      catalogOnlyStates,
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
    if (process.env.P2_31D_KEEP_TMP !== "1") {
      cleanupRealUiRun(context);
    }
  }
}

async function startApp() {
  startElectron(context);
  await connectToElectron(context);
  const pet = await waitForWindow(context, "renderer/pet/index.html");
  await waitFor(pet, "Boolean(window.petApi)");
  await collectCase({
    caseId: "startup-appearance",
    reason: "startup_first_visible_frame",
    actionType: "appearance",
    stateId: undefined,
    required: false,
    timeoutMs: 12_000
  });
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
  const expected = getExpected(definition);
  const event = await waitForAction({
    actionType: expected.actionType,
    reason: definition.reason,
    stateId: expected.stateId,
    afterIndex: definition.afterIndex ?? -1,
    timeoutMs: definition.timeoutMs
  });

  if (event) {
    return buildCaseResult({
      ...definition,
      expected,
      event,
      status: "passed"
    });
  }

  const required = definition.required ?? requiredCaseIds.has(definition.caseId);
  return buildCaseResult({
    ...definition,
    expected,
    status: required ? "failed" : "skipped",
    skipReason: required ? "not-observed" : definition.skippedWhenMissing ?? "not-covered"
  });
}

function getExpected(definition) {
  if (definition.actionType) {
    return {
      stateId: definition.stateId,
      triggerReason: definition.reason,
      actionType: definition.actionType,
      allowedDialogueModes: [],
      allowedPresenceModes: [],
      motionPresetFallbackStatus: "expected-safe-skip"
    };
  }

  const decision = getPetLayeredActionDecisionForReason(definition.reason);
  return {
    stateId: decision.stateId,
    triggerReason: decision.triggerReason,
    actionType: decision.actionType,
    allowedDialogueModes: [...decision.allowedDialogueModes],
    allowedPresenceModes: [...decision.allowedPresenceModes],
    motionPresetFallbackStatus: decision.motionPresetFallback.status
  };
}

function buildCaseResult(definition) {
  const expected = definition.expected ?? getExpected(definition);
  const required = definition.required ?? requiredCaseIds.has(definition.caseId);

  return {
    caseId: definition.caseId,
    required,
    covered: definition.status === "passed",
    status: definition.status,
    ...(definition.skipReason ? { skipReason: definition.skipReason } : {}),
    expected,
    observed: summarizeAction(definition.event)
  };
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
  timeoutMs,
  afterIndex = -1
}) {
  return waitForTelemetry((event) => (
    event.type === "pet_interaction_action_started" &&
    event.__index > afterIndex &&
    event.payload?.type === actionType &&
    event.payload?.reason === reason &&
    (stateId === undefined || event.payload?.stateId === stateId)
  ), timeoutMs);
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
  await dragWithOffsets(pet, 231, [[0, 900], [0, 1_800], [0, 3_000]], 80);
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
  await sleep(500);
}

async function dispatchPointerDown(pet, pointerId) {
  await evaluate(pet, `
    (() => {
      const canvas = document.querySelector("#pet-canvas");
      if (!canvas) throw new Error("Missing pet canvas");
      const rect = canvas.getBoundingClientRect();
      const x = rect.left + rect.width * 0.5;
      const y = rect.top + rect.height * 0.48;
      window.__p231dDragBase = {
        screenX: window.screenX + x,
        screenY: window.screenY + y
      };
      canvas.dispatchEvent(new PointerEvent("pointerdown", {
        pointerId: ${pointerId},
        pointerType: "mouse",
        clientX: x,
        clientY: y,
        screenX: window.__p231dDragBase.screenX,
        screenY: window.__p231dDragBase.screenY,
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
      const base = window.__p231dDragBase ?? {
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
      const base = window.__p231dDragBase ?? {
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
    await tapPetBody(pet, 300 + index);
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
    const key = `${event.payload?.type}:${event.payload?.reason}:${event.payload?.stateId ?? "none"}`;
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
