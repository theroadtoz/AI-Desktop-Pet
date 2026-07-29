import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertNoScreenshotResidue,
  cleanupRealUiRun,
  click,
  connectToElectron,
  createRealUiRunContext,
  evaluate,
  sleep,
  startElectron,
  stopElectron,
  typeText,
  waitFor,
  waitForWindow
} from "./support/real-ui-harness.mjs";
import { runWithRealUiDeadline } from "./support/real-ui-run-deadline.mjs";

const POSITIVE_MESSAGE = "西塔，你猜我刚才发现了什么？";
const NEGATIVE_MESSAGE = "你猜一下为什么这个程序会报错？";
const RUN_TIMEOUT_MS = 75_000;
const SHADOW_EVENT_TYPE = "xita_interaction_cue_shadow_observed";
const SHADOW_PAYLOAD_KEYS = ["count", "intensity", "matched", "reason"];

async function main() {
  const context = createRealUiRunContext({
    runName: "p2-88c-curious-shadow-real-ui",
    port: 9744,
    env: {
      AI_DESKTOP_PET_PROVIDER: "fake",
      AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: "1"
    },
    tmpResiduePatterns: [/^p2-88c-curious-shadow-real-ui$/i]
  });
  context.electronArgs = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
  context.p288cStage = "entry";

  let summary;
  try {
    summary = await runWithRealUiDeadline(() => run(context), RUN_TIMEOUT_MS);
  } catch (error) {
    summary = {
      ok: false,
      runtimePath: "production_electron",
      failureStage: context.p288cStage,
      failure: classifyFailure(error),
      checks: {
        cleanupCompleted: false
      }
    };
  } finally {
    let cleanupCompleted = false;
    try {
      await stopElectron(context);
      cleanupRealUiRun(context);
      cleanupCompleted = true;
    } catch {
      summary = {
        ...summary,
        ok: false,
        failure: "cleanup_failed"
      };
    }
    summary = {
      ...summary,
      checks: {
        ...(summary?.checks ?? {}),
        cleanupCompleted
      }
    };
  }

  process.stdout.write(`${JSON.stringify(summary)}\n`);
  if (!summary.ok) process.exitCode = 1;
}

async function run(context) {
  context.p288cStage = "electron_start";
  startElectron(context);
  context.p288cStage = "cdp_connect";
  await connectToElectron(context, 30_000);
  context.p288cStage = "pet_window";
  const pet = await waitForWindow(context, "renderer/pet/index.html", 30_000);
  await waitFor(pet, "Boolean(window.petApi?.openChat)", { timeoutMs: 15_000 });
  await evaluate(pet, "window.petApi.openChat()");
  context.p288cStage = "chat_window";
  const chat = await waitForWindow(context, "renderer/chat/index.html", 30_000);
  await waitFor(chat, "Boolean(document.querySelector('#chat-input'))", { timeoutMs: 15_000 });

  context.p288cStage = "positive_request";
  const positiveStart = readTelemetry(context).length;
  await sendMessage(chat, POSITIVE_MESSAGE);
  const positiveShadow = await waitForTelemetry(
    context,
    positiveStart,
    (event) => event.type === SHADOW_EVENT_TYPE,
    10_000
  );
  const negativeStart = readTelemetry(context).length;

  context.p288cStage = "negative_request";
  await sendMessage(chat, NEGATIVE_MESSAGE);
  await sleep(500);
  const settingsDisabledStart = readTelemetry(context).length;

  context.p288cStage = "settings_disabled_request";
  await waitFor(chat, "Boolean(window.dialogueAffectApi?.setSettings)", {
    timeoutMs: 10_000
  });
  const disabledSettings = await evaluate(
    chat,
    "window.dialogueAffectApi.setSettings({ enabled: false })"
  );
  if (disabledSettings?.enabled !== false) {
    throw new Error("settings_disable_failed");
  }
  await sendMessage(chat, POSITIVE_MESSAGE);
  await sleep(500);

  context.p288cStage = "evidence";
  const events = readTelemetry(context);
  const positiveEvents = events.slice(positiveStart, negativeStart);
  const negativeEvents = events.slice(negativeStart, settingsDisabledStart);
  const settingsDisabledEvents = events.slice(settingsDisabledStart);
  const positiveShadowEvents = positiveEvents.filter((event) => event.type === SHADOW_EVENT_TYPE);
  const negativeShadowEvents = negativeEvents.filter((event) => event.type === SHADOW_EVENT_TYPE);
  const settingsDisabledShadowEvents = settingsDisabledEvents.filter(
    (event) => event.type === SHADOW_EVENT_TYPE
  );
  const positiveShadowCount = positiveShadowEvents.length;
  const negativeShadowCount = negativeShadowEvents.length;
  const settingsDisabledShadowCount = settingsDisabledShadowEvents.length;
  const shadowPayloadExactKeys =
    Object.keys(positiveShadow.payload ?? {}).sort().join(",") === SHADOW_PAYLOAD_KEYS.join(",") &&
    positiveShadow.payload?.matched === true &&
    positiveShadow.payload?.reason === "guess-invitation" &&
    positiveShadow.payload?.intensity === "low" &&
    positiveShadow.payload?.count === 1;
  const curiousStateTelemetryObserved = events.some((event) =>
    event.payload?.state === "curious" || event.payload?.stateId === "curious"
  );
  const curiousContextTelemetryObserved = events.some((event) =>
    event.payload?.dialogueContextId === "gentle-curious" ||
    event.payload?.emotionalDialogueContextId === "gentle-curious"
  );
  const curiousActionTelemetryObserved = events.some((event) =>
    event.payload?.reason === "state_curious" ||
    event.payload?.type === "curiousTilt" ||
    event.payload?.selectedActionType === "curiousTilt"
  );
  const noBodyLeak =
    !JSON.stringify(events).includes(POSITIVE_MESSAGE) &&
    !JSON.stringify(events).includes(NEGATIVE_MESSAGE);
  assertNoScreenshotResidue(context);

  return {
    ok:
      positiveShadowCount === 1 &&
      negativeShadowCount === 0 &&
      settingsDisabledShadowCount === 0 &&
      shadowPayloadExactKeys &&
      curiousStateTelemetryObserved === false &&
      curiousContextTelemetryObserved === false &&
      curiousActionTelemetryObserved === false &&
      noBodyLeak,
    runtimePath: "production_electron",
    evidenceBoundary: "dynamic safe shadow observation and no-observation plus static zero-wiring contract support shadow-only; auxiliary telemetry field observations are not standalone semantic proof",
    checks: {
      positiveShadowCount,
      negativeShadowCount,
      settingsDisabledShadowCount,
      shadowPayloadExactKeys,
      curiousStateTelemetryObserved,
      curiousContextTelemetryObserved,
      curiousActionTelemetryObserved,
      noBodyLeak
    }
  };
}

async function sendMessage(page, message) {
  const before = await evaluate(
    page,
    "document.querySelectorAll('.message-pet .message-content').length"
  );
  await typeText(page, "#chat-input", message);
  await click(page, "#send-button");
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const state = await evaluate(page, `(() => {
      const input = document.querySelector("#chat-input");
      const replies = [...document.querySelectorAll(".message-pet .message-content")];
      return {
        inputDisabled: Boolean(input?.disabled),
        replyCount: replies.length,
        lastReplyLength: replies.at(-1)?.textContent?.trim().length ?? 0,
        sessionState: document.querySelector("#chat-session-note")?.dataset.state ?? ""
      };
    })()`);
    if (state.replyCount > before && !state.inputDisabled && state.lastReplyLength > 0) return;
    if (state.replyCount <= before && !state.inputDisabled && state.sessionState === "error") {
      throw new Error("provider_chat_failed");
    }
    await sleep(150);
  }
  throw new Error("send_timeout");
}

async function waitForTelemetry(context, startIndex, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const event = readTelemetry(context).slice(startIndex).find(predicate);
    if (event) return event;
    await sleep(50);
  }
  throw new Error("telemetry_wait_timeout");
}

function readTelemetry(context) {
  const logDir = join(context.appDataDir, "logs");
  if (!existsSync(logDir)) return [];
  return readdirSync(logDir)
    .filter((name) => name.startsWith("telemetry-") && name.endsWith(".jsonl"))
    .map((name) => join(logDir, name))
    .sort((left, right) => statSync(left).mtimeMs - statSync(right).mtimeMs)
    .flatMap((path) => readFileSync(path, "utf8").split(/\r?\n/u)
      .flatMap((line) => {
        try {
          return line ? [JSON.parse(line)] : [];
        } catch {
          return [];
        }
      }));
}

function classifyFailure(error) {
  const message = error instanceof Error ? error.message : "runner_error";
  return ["runner_timeout", "provider_chat_failed", "send_timeout", "telemetry_wait_timeout", "settings_disable_failed"].includes(message)
    ? message
    : "runner_error";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
