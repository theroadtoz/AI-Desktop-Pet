import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

import {
  assertNoScreenshotResidue,
  chatUiSelectors,
  cleanupRealUiRun,
  connectToElectron,
  createRunDeadline,
  createRealUiRunContext,
  evaluate,
  getPageByUrlPart,
  RealUiHarnessError,
  runBodyActionAcceptance,
  runStructuredRealUiAcceptance,
  sleep,
  startElectron,
  stopElectron,
  typeText,
  click,
  waitFor,
  waitForActionLifecycleIdle
} from "./support/real-ui-harness.mjs";

const require = createRequire(import.meta.url);

const SENTINELS = [
  "C1_PROMPT_SENTINEL", "C1_BODY_SENTINEL", "C1_PATH_SENTINEL",
  "C1_REQUEST_ID_SENTINEL", "C1_ACTION_ID_SENTINEL", "C1_MODEL_SENTINEL",
  "C1_HOST_SENTINEL", "C1_PORT_SENTINEL", "C1_KEY_SENTINEL", "C1_METADATA_SENTINEL"
];
let context = null;
let parsePersistentTelemetryEvent = null;
let persistentActionTypes = null;
const progress = { stage: "initial", observedLineCount: 0 };
const runDeadline = createRunDeadline(70_000);

function checkpoint(stage) {
  progress.stage = stage;
  progress.observedLineCount = readLines().length;
}

function readLines() {
  const directory = join(context.appDataDir, "logs");
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.startsWith("telemetry-") && name.endsWith(".jsonl"))
    .sort()
    .flatMap((name) => readFileSync(join(directory, name), "utf8").split(/\r?\n/u).filter(Boolean));
}

function readEvents() {
  return readLines().map((line) => JSON.parse(line));
}

async function waitForPersistedEvent(afterIndex, predicate, timeoutMs = 15_000) {
  const stageDeadline = Date.now() + runDeadline.remaining(timeoutMs);
  while (true) {
    const event = readEvents().slice(afterIndex).find(predicate);
    if (event) return event;
    const stageRemaining = stageDeadline - Date.now();
    if (stageRemaining <= 0) throw new RealUiHarnessError("run_timeout");
    await sleep(Math.min(100, runDeadline.remaining(stageRemaining)));
  }
}

async function waitForWithin(page, expression, timeoutMs) {
  try {
    return await waitFor(page, expression, { timeoutMs: runDeadline.remaining(timeoutMs) });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Timed out waiting for:")) {
      throw new RealUiHarnessError("run_timeout");
    }
    throw error;
  }
}

function recordBodyAttempt(stage, bodyAttempt) {
  progress.bodyAttempt = bodyAttempt;
  checkpoint(stage);
}

const outcome = await runStructuredRealUiAcceptance({
  initialResult: {
    lineCount: 0,
    rootExact: false,
    sentinelFree: false,
    catalogPayloadExact: false,
    chatPath: false,
    petActionPath: false,
    recoveryPath: false,
    ownedDynamicPort: false,
    progress
  },
  execute: async () => {
    const telemetryContract = require("../dist/shared/telemetry-contract.js");
    ({ parsePersistentTelemetryEvent } = telemetryContract);
    persistentActionTypes = telemetryContract.PERSISTENT_TELEMETRY_CATALOG
      .pet_interaction_action_started.fields.actionType.values;
    context = createRealUiRunContext({
      runName: "p2-91c-telemetry-real-ui",
      port: 0,
      structuredFailures: true,
      env: {
        AI_DESKTOP_PET_MODEL: "C1_MODEL_SENTINEL",
        AI_DESKTOP_PET_BASE_URL: "http://C1_HOST_SENTINEL:9750/C1_PATH_SENTINEL",
        AI_DESKTOP_PET_API_KEY: "C1_KEY_SENTINEL"
      }
    });
    startElectron(context);
    await connectToElectron(context, runDeadline.remaining(20_000));
    assert.equal(context.cdpEndpointOwned, true);
    checkpoint("electron_connected");

    const pet = await getPageByUrlPart(context, "renderer/pet/index.html", runDeadline.remaining(20_000));
    const chat = await getPageByUrlPart(context, "renderer/chat/index.html", runDeadline.remaining(20_000));
    await waitForWithin(chat, `document.querySelector(${JSON.stringify(chatUiSelectors.chat.input)})`, 10_000);
    checkpoint("pages_ready");

    const chatIndex = readEvents().length;
    await typeText(chat, chatUiSelectors.chat.input, "C1_PROMPT_SENTINEL");
    checkpoint("chat_typed");
    await click(chat, chatUiSelectors.chat.send);
    checkpoint("chat_clicked");
    checkpoint("chat_reply_wait");
    await waitForWithin(chat, `(() => {
      const input = document.querySelector(${JSON.stringify(chatUiSelectors.chat.input)});
      const send = document.querySelector(${JSON.stringify(chatUiSelectors.chat.send)});
      const replies = [...document.querySelectorAll("#messages .message-pet .message-content")];
      const reply = replies.at(-1)?.textContent?.trim() ?? "";
      return input?.disabled === false && send?.disabled === false && reply.length > 0;
    })()`, 12_000);
    checkpoint("chat_ui_completed");
    await waitForPersistedEvent(chatIndex, (event) => event.type === "chat_stream_completed");
    checkpoint("chat_persisted");

    await waitForActionLifecycleIdle({
      readEvents,
      deadline: runDeadline,
      stableMs: 550,
      stageTimeoutMs: 15_000
    });
    checkpoint("action_idle_stable");
    const bodyDeadline = createRunDeadline(70_000);
    const bodyAttempt = await runBodyActionAcceptance({
      readEvents,
      actionType: "bodyAttentionTurn",
      actionTypes: persistentActionTypes,
      deadline: bodyDeadline,
      stableMs: 550,
      trigger: async (attempt) => {
        checkpoint("action_dispatch");
        return evaluate(pet, `(() => {
          const canvas = document.querySelector("#pet-canvas");
          if (!canvas) return false;
          const rect = canvas.getBoundingClientRect();
          if (!(rect.width > 0 && rect.height > 0)) return false;
          const x = rect.left + rect.width * 0.5;
          const y = rect.top + rect.height * 0.48;
          for (const type of ["pointerdown", "pointerup"]) {
            canvas.dispatchEvent(new PointerEvent(type, {
              pointerId: ${191} + ${attempt}, pointerType: "mouse", clientX: x, clientY: y,
              screenX: x, screenY: y, button: 0, buttons: type === "pointerdown" ? 1 : 0, bubbles: true
            }));
          }
          return true;
        })()`);
      },
      onProgress: (result) => recordBodyAttempt("action_lifecycle_wait", result)
    });
    recordBodyAttempt("action_persisted", bodyAttempt);

    const recoveryIndex = readEvents().length;
    const recoveryTriggered = await evaluate(pet, `(() => {
      const canvas = document.querySelector("#pet-canvas");
      const gl = canvas?.getContext("webgl2") ?? canvas?.getContext("webgl") ?? canvas?.getContext("experimental-webgl");
      const extension = gl?.getExtension("WEBGL_lose_context");
      if (!extension || gl.isContextLost()) return false;
      extension.loseContext();
      window.setTimeout(() => { if (gl.isContextLost()) extension.restoreContext(); }, 2500);
      return true;
    })()`);
    assert.equal(recoveryTriggered, true);
    await waitForPersistedEvent(recoveryIndex, (event) => event.type === "recovery_started");
    await waitForPersistedEvent(recoveryIndex, (event) => event.type === "recovery_succeeded");
    checkpoint("recovery_persisted");

    const lines = readLines();
    assert.ok(lines.length > 0, "telemetry JSONL was not created");
    const parsed = lines.map((line) => JSON.parse(line));
    assert.ok(parsed.every((event) => (
      event && typeof event === "object" &&
      JSON.stringify(Object.keys(event).sort()) === JSON.stringify(["payload", "timestamp", "type"])
    )));
    const raw = lines.join("\n");
    assert.ok(SENTINELS.every((sentinel) => !raw.includes(sentinel)));
    assert.ok(parsed.every((event) => parsePersistentTelemetryEvent(event) !== null));
    return {
      lineCount: lines.length,
      rootExact: true,
      sentinelFree: true,
      catalogPayloadExact: true,
      chatPath: true,
      petActionPath: true,
      recoveryPath: true,
      ownedDynamicPort: true,
      progress: { stage: "complete", observedLineCount: lines.length, bodyAttempt }
    };
  },
  cleanupSteps: [
    async () => context && stopElectron(context),
    async () => {
      if (!context?.cdpEndpointOwned) return;
      await assert.rejects(fetch(`http://127.0.0.1:${context.port}/json/version`, {
        signal: AbortSignal.timeout(500)
      }));
    },
    async () => context && assertNoScreenshotResidue(context),
    async () => context && cleanupRealUiRun(context),
    async () => context && assert.equal(existsSync(context.runParentDir), false)
  ],
  emit: (line) => process.stdout.write(line)
});
if (!outcome.ok) process.exitCode = 1;
