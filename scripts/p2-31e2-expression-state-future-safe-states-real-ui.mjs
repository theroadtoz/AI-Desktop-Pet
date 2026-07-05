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
  sleep,
  startElectron,
  stopElectron,
  waitFor,
  waitForWindow
} from "./support/real-ui-harness.mjs";
import { PET_TELEMETRY_ALLOWED_FIELDS } from "../src/shared/pet-telemetry-contract.ts";

const context = createRealUiRunContext({
  runName: "p2-31e2-expression-state-future-safe-states-real-ui",
  port: Number(process.env.P2_31E2_CDP_PORT || 9633),
  env: {
    AI_DESKTOP_PET_PROVIDER: "local-openai-compatible",
    AI_DESKTOP_PET_BASE_URL: "http://127.0.0.1:9/v1",
    AI_DESKTOP_PET_MODEL: "p2-31e2-local-model-busy",
    AI_DESKTOP_PET_TIMEOUT_MS: "1000",
    AI_DESKTOP_PET_PROACTIVE_SPEECH_BUBBLE_IDLE_INTERVAL_MS: process.env.P2_31E2_IDLE_INTERVAL_MS || "60000"
  }
});

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
  log(context, "run=p2-31e2-expression-state-future-safe-states-real-ui");
  const startedAt = Date.now();
  const checks = {};
  const cases = [];

  try {
    const { pet } = await startApp();
    const chat = await openChatFromPet(pet);
    await sleep(4_000);

    const afterIndex = lastTelemetryIndex();
    await setChatInputValueWithoutFocus(chat, "p2-31e2 local model busy trigger check");
    await click(chat, "#send-button");

    const event = await waitForAction({
      actionType: "replyThinking",
      reason: "state_local_model_busy",
      stateId: "local-model-busy",
      expressionPresetId: "dark",
      afterIndex,
      timeoutMs: 8_000
    });

    await waitFor(chat, "document.querySelector('#chat-input')?.disabled === false", { timeoutMs: 15_000 });

    cases.push(buildCaseResult({
      caseId: "local-provider-request-local-model-busy-dark",
      required: true,
      status: event ? "passed" : "failed",
      event,
      expected: {
        providerId: "local-openai-compatible",
        stateId: "local-model-busy",
        reason: "state_local_model_busy",
        actionType: "replyThinking",
        expressionPresetId: "dark"
      }
    }));

    const telemetryEvents = readTelemetryEvents();
    const unsafeTelemetryFields = findUnsafeInteractionTelemetryFields(telemetryEvents);
    checks.telemetryPayloadAllowlist = unsafeTelemetryFields.length === 0;
    checks.requiredCasesPassed = cases.every((item) => item.status === "passed");
    checks.expressionPresetTelemetrySafe = cases.every((item) => (
      item.observed?.expressionPresetId === item.expected.expressionPresetId
    ));
    checks.localProviderDoesNotUseGenericWaitingReason = telemetryEvents
      .filter((candidate) => candidate.__index > afterIndex)
      .every((candidate) => (
        candidate.type !== "pet_interaction_action_started" ||
        candidate.payload?.reason !== "chat_reply_waiting"
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
      provider: "local-openai-compatible",
      localModelChatQualityClaim: false,
      localProviderReachabilityRequired: false,
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
      provider: "local-openai-compatible",
      localModelChatQualityClaim: false,
      durationMs: Date.now() - startedAt,
      checks,
      cases,
      failureCategory: classifyError(error)
    });
    process.exitCode = 1;
  } finally {
    await stopElectron(context);
    if (process.env.P2_31E2_KEEP_TMP !== "1") {
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
  await waitFor(chat, "Boolean(document.querySelector('#chat-input'))");
  return chat;
}

async function setChatInputValueWithoutFocus(chat, text) {
  await evaluate(chat, `
    (() => {
      const input = document.querySelector("#chat-input");
      if (!input) throw new Error("Missing chat input");
      input.blur();
      input.value = ${JSON.stringify(text)};
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    })()
  `);
  await waitFor(chat, "document.querySelector('#send-button')?.disabled === false");
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
    event.type === "pet_interaction_action_started" &&
    event.payload?.type === actionType &&
    event.payload?.reason === reason &&
    event.payload?.stateId === stateId &&
    event.payload?.expressionPresetId === expressionPresetId
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

function buildCaseResult({ caseId, required, status, event, expected }) {
  return {
    caseId,
    required,
    covered: status === "passed",
    status,
    expected,
    observed: summarizeAction(event)
  };
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
    .filter((line) => !(line.includes('"type":"provider_request_') && line.includes('"promptTemplateProfile"')))
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
