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
import {
  capturePetOnlyStateIdleVisualEvidence,
  cleanupPetOnlyVisualEvidence,
  waitForPetOnlyVisualReview,
  waitForPetVisibleBaseline
} from "./support/p2-88b-pet-only-visual-evidence.mjs";
import { runWithRealUiDeadline } from "./support/real-ui-run-deadline.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const FIXTURE_MESSAGE = "__p2_88b_medium_happy_fixture__，以后回复短一点。";
const RUN_TIMEOUT_MS = 90_000;
const PET_RENDERER_READY_EXPRESSION = `(() => {
  const canvas = document.querySelector("#pet-canvas");
  return Boolean(window.petApi && canvas && canvas.width > 0 && canvas.height > 0);
})()`;

async function main() {
  const context = createRealUiRunContext({
    runName: "p2-88b-affect-presentation-real-ui",
    port: 9742,
    env: {
      AI_DESKTOP_PET_PROVIDER: "fake",
      AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: "1",
      AI_DESKTOP_PET_P2_88B_SAFE_FIXTURE: "1",
      AI_DESKTOP_PET_P2_88B_VISUAL_REVIEW_HANDSHAKE:
        process.env.AI_DESKTOP_PET_P2_88B_VISUAL_REVIEW_HANDSHAKE === "1" ? "1" : ""
    },
    tmpResiduePatterns: [/^p2-88b-affect-presentation-real-ui$/i]
  });
  context.electronArgs = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
  context.p288Stage = "entry";

  let summary;
  try {
    summary = await runWithRealUiDeadline(() => run(context), RUN_TIMEOUT_MS);
  } catch (error) {
    summary = {
      ok: false,
      runtimePath: "production_electron",
      failureStage: context.p288Stage,
      failure: classifyFailure(error),
      failureName: error instanceof Error ? error.name : "unknown",
      failureCode: typeof error === "object" && error !== null && typeof error.code === "string"
        ? error.code.slice(0, 64)
        : null,
      gateDecision: context.p288GateDecision ?? null,
      gateReason: context.p288GateReason ?? null,
      dispatchStatus: context.p288DispatchStatus ?? null,
      dispatchReason: context.p288DispatchReason ?? null,
      activeMainReason: context.p288ActiveMainReason ?? null,
      localBusyReason: context.p288LocalBusyReason ?? null,
      stateIdleTerminalType: context.p288StateIdleTerminalType ?? null,
      stateIdleSkipReason: context.p288StateIdleSkipReason ?? null,
      baselineVisible: context.p288BaselineVisible ?? false,
      baselineRendererContextLost: context.p288BaselineRendererContextLost ?? null,
      baselineRendererVisiblePixels: context.p288BaselineRendererVisiblePixels ?? 0,
      baselinePngVisiblePixels: context.p288BaselinePngVisiblePixels ?? 0,
      baselineProbeAttempts: context.p288BaselineProbeAttempts ?? 0,
      baselineCanvasWidth: context.p288BaselineCanvasWidth ?? 0,
      baselineCanvasHeight: context.p288BaselineCanvasHeight ?? 0,
      baselineCanvasSizeNonZero: context.p288BaselineCanvasSizeNonZero ?? false,
      stateIdleFrameVisible: context.p288StateIdleFrameVisible ?? false,
      capturedFrameCount: context.p288CapturedFrameCount ?? 0,
      visualReviewHandshakeEnabled: context.p288VisualReviewHandshakeEnabled ?? false,
      visualReviewDecision: context.p288VisualReviewDecision ?? "not_requested",
      humanVisualReviewConfirmed: context.p288HumanVisualReviewConfirmed ?? false
    };
  } finally {
    try {
      await cleanup(context);
    } catch {
      summary = { ...summary, ok: false, failure: "visual_evidence_cleanup_failed" };
    }
    if (summary?.checks) summary.checks.visualEvidenceDeleted = context.p288VisualEvidenceDeleted === true;
    else if (summary) summary.visualEvidenceDeleted = context.p288VisualEvidenceDeleted === true;
  }

  process.stdout.write(`${JSON.stringify(summary)}\n`);
  if (!summary.ok) process.exitCode = 1;
}

async function run(context) {
  context.p288Stage = "electron_start";
  startElectron(context);
  context.p288Stage = "cdp_connect";
  await connectToElectron(context, 30_000);
  context.p288Stage = "pet_window";
  const pet = await waitForWindow(context, "renderer/pet/index.html", 30_000);
  context.p288Stage = "pet_renderer_ready";
  await waitFor(pet, PET_RENDERER_READY_EXPRESSION, { timeoutMs: 12_000 });
  recordBaselineCanvasState(context, await evaluate(pet, `(() => {
    const canvas = document.querySelector("#pet-canvas");
    return { width: canvas?.width ?? 0, height: canvas?.height ?? 0 };
  })()`));
  context.p288Stage = "startup_appearance_finished";
  await waitForStartupAppearanceFinished(context, 12_000);
  context.p288Stage = "pet_visible_baseline";
  const baseline = await waitForPetVisibleBaseline(pet, {
    onObservation: (value) => recordBaselineObservation(context, value)
  });
  context.p288BaselineVisible = baseline.baselineVisible;
  context.p288Stage = "chat_open";
  await waitFor(pet, "Boolean(window.petApi?.openChat)", { timeoutMs: 15_000 });
  await evaluate(pet, "window.petApi.openChat()");
  context.p288Stage = "chat_window";
  const chat = await waitForWindow(context, "renderer/chat/index.html", 30_000);
  await waitFor(chat, "Boolean(document.querySelector('#chat-input'))", { timeoutMs: 15_000 });
  context.p288Stage = "initial_idle";
  await waitForActionIdle(context, 12_000);

  context.p288Stage = "first_fixture";
  const firstStart = readTelemetry(context).length;
  await sendMessage(chat, FIXTURE_MESSAGE);
  await waitForActionIdle(context, 12_000);
  const firstEvents = readTelemetry(context).slice(firstStart);
  const firstSignalHeld = !firstEvents.some((event) => isStarted(event, "state_idle"));

  context.p288Stage = "second_fixture";
  const secondStart = readTelemetry(context).length;
  await sendMessage(chat, FIXTURE_MESSAGE);
  context.p288Stage = "affect_gate";
  const gate = await waitForTelemetry(
    context,
    secondStart,
    (event) => event.type === "p2_88b_affect_reply_action_gate",
    15_000
  );
  context.p288GateDecision = gate.payload?.decision ?? null;
  context.p288GateReason = gate.payload?.reason ?? null;
  context.p288ActiveMainReason = gate.payload?.activeMainReason ?? null;
  context.p288LocalBusyReason = gate.payload?.localBusyReason ?? null;
  const deferredAfterWaitingTerminal =
    gate.payload?.decision === "suppress" &&
    gate.payload?.reason === "presentation_busy" &&
    gate.payload?.activeMainReason === "chat_reply_waiting";
  if (!deferredAfterWaitingTerminal) {
    throw new Error("waiting_terminal_defer_missing");
  }
  context.p288Stage = "affect_dispatch";
  const dispatch = await waitForTelemetry(
    context,
    secondStart,
    (event) => event.type === "dialogue_affect_action_dispatch",
    15_000
  );
  context.p288DispatchStatus = dispatch.payload?.status ?? null;
  context.p288DispatchReason = dispatch.payload?.reason ?? null;
  if (dispatch.payload?.status !== "accepted") {
    throw new Error("affect_dispatch_suppressed");
  }
  const initialRequestId = typeof dispatch.payload?.requestId === "string" ? dispatch.payload.requestId : "";
  const initialDispatchRequestIdPresent = initialRequestId.length > 0;
  const initialDispatchReasonAllowed = dispatch.payload?.reason === "accepted";
  if (!initialDispatchRequestIdPresent || !initialDispatchReasonAllowed) {
    throw new Error("affect_dispatch_invalid");
  }
  context.p288Stage = "state_idle_started";
  const startedOrTerminal = await waitForTelemetry(
    context,
    secondStart,
    (event) =>
      (isStarted(event, "state_idle") && event.payload?.requestId === initialRequestId) ||
      (isTerminal(event) && event.payload?.reason === "state_idle" && event.payload?.requestId === initialRequestId),
    15_000
  );
  let finalStarted = startedOrTerminal;
  let retryDispatch = null;
  let cooldownRetryObserved = false;
  if (!isStarted(startedOrTerminal, "state_idle")) {
    context.p288StateIdleTerminalType = startedOrTerminal.type;
    context.p288StateIdleSkipReason = startedOrTerminal.payload?.skipReason ?? null;
    if (
      startedOrTerminal.type !== "pet_interaction_action_skipped" ||
      startedOrTerminal.payload?.skipReason !== "global_cooldown"
    ) {
      throw new Error("state_idle_not_started");
    }
    cooldownRetryObserved = true;
    context.p288Stage = "global_cooldown_retry_dispatch";
    retryDispatch = await waitForTelemetry(
      context,
      secondStart,
      (event) =>
        event.type === "dialogue_affect_action_dispatch" &&
        event.payload?.status === "accepted" &&
        typeof event.payload?.requestId === "string" &&
        event.payload.requestId !== initialRequestId,
      15_000
    );
    context.p288Stage = "global_cooldown_retry_started";
    finalStarted = await waitForTelemetry(
      context,
      secondStart,
      (event) => isStarted(event, "state_idle") && event.payload?.requestId === retryDispatch.payload?.requestId,
      15_000
    );
  }
  context.p288Stage = "state_idle_visual_evidence";
  const visualEvidence = await capturePetOnlyStateIdleVisualEvidence({
    pet,
    context,
    hasExactTerminal: () => readTelemetry(context).slice(secondStart).some(
      (event) => isTerminal(event) && event.payload?.requestId === finalStarted.payload?.requestId
    )
  });
  context.p288StateIdleFrameVisible = visualEvidence.stateIdleFrameVisible;
  context.p288CapturedFrameCount = visualEvidence.capturedFrameCount;
  context.p288Stage = "state_idle_visual_review";
  const visualReview = await waitForPetOnlyVisualReview(context);
  context.p288Stage = "state_idle_terminal";
  const terminal = await waitForTelemetry(
    context,
    secondStart,
    (event) => isTerminal(event) && event.payload?.requestId === finalStarted.payload?.requestId,
    15_000
  );
  context.p288Stage = "final_idle";
  await waitForActionIdle(context, 12_000);

  const events = readTelemetry(context);
  context.p288Stage = "residue_check";
  const relevant = events.filter((event) =>
    event.type === "dialogue_affect_decision" ||
    event.type === "p2_88b_affect_reply_action_gate" ||
    event.type === "dialogue_affect_action_dispatch" ||
    event.type === "pet_interaction_action_started" ||
    isTerminal(event)
  );
  const acceptedDispatchCount = events.slice(secondStart).filter(
    (event) => event.type === "dialogue_affect_action_dispatch" && event.payload?.status === "accepted"
  ).length;
  const retryDispatchRequestIdPresent = typeof retryDispatch?.payload?.requestId === "string" &&
    retryDispatch.payload.requestId.length > 0;
  const retryRequestIdDistinct = retryDispatchRequestIdPresent && retryDispatch.payload.requestId !== initialRequestId;
  const retryDispatchReasonAllowed = !cooldownRetryObserved || retryDispatch?.payload?.reason === "accepted";
  const stateIdleStarted = isStarted(finalStarted, "state_idle");
  const terminalRequestIdMatched = stateIdleStarted &&
    terminal.payload?.reason === "state_idle" &&
    terminal.payload?.requestId === finalStarted.payload?.requestId;
  const exactAcceptedDispatchCount = acceptedDispatchCount === (cooldownRetryObserved ? 2 : 1);
  const noBodyLeak = !JSON.stringify(relevant).includes(FIXTURE_MESSAGE);
  assertNoScreenshotResidue(context);

  return {
    ok: firstSignalHeld &&
      deferredAfterWaitingTerminal &&
      initialDispatchRequestIdPresent &&
      initialDispatchReasonAllowed &&
      stateIdleStarted &&
      terminalRequestIdMatched &&
      exactAcceptedDispatchCount &&
      baseline.baselineVisible &&
      visualEvidence.stateIdleFrameVisible &&
      (!visualReview.visualReviewHandshakeEnabled || visualReview.humanVisualReviewConfirmed) &&
      (!cooldownRetryObserved || (
        retryDispatchRequestIdPresent &&
        retryRequestIdDistinct &&
        retryDispatchReasonAllowed
      )) &&
      noBodyLeak,
    runtimePath: "production_electron",
    evidenceBoundary: "closed acceptance fixture verifies Electron main arbitration and renderer lifecycle, not real emotion understanding",
    checks: {
      firstSignalHeld,
      deferredAfterWaitingTerminal,
      initialDispatchRequestIdPresent,
      initialDispatchReasonAllowed,
      cooldownRetryObserved,
      retryDispatchRequestIdPresent,
      retryRequestIdDistinct,
      retryDispatchReasonAllowed,
      acceptedDispatchCount,
      exactAcceptedDispatchCount,
      baselineVisible: baseline.baselineVisible,
      stateIdleFrameVisible: visualEvidence.stateIdleFrameVisible,
      capturedFrameCount: visualEvidence.capturedFrameCount,
      pngVisiblePixels: visualEvidence.pngVisiblePixels,
      rendererVisiblePixels: visualEvidence.rendererVisiblePixels,
      rendererContextLost: visualEvidence.rendererContextLost,
      rendererProbeAttempts: baseline.rendererProbeAttempts + visualEvidence.rendererProbeAttempts,
      screenshotAttempts: visualEvidence.screenshotAttempts,
      visualReviewHandshakeEnabled: visualReview.visualReviewHandshakeEnabled,
      visualReviewDecision: visualReview.visualReviewDecision,
      humanVisualReviewConfirmed: visualReview.humanVisualReviewConfirmed,
      stateIdleStarted,
      terminalRequestIdMatched,
      noBodyLeak
    }
  };
}

async function sendMessage(page, message) {
  const before = await evaluate(page, "document.querySelectorAll('.message-pet .message-content').length");
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

async function waitForActionIdle(context, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let stableSince = null;
  while (Date.now() < deadline) {
    if (activeActionIds(readTelemetry(context)).size === 0) {
      stableSince ??= Date.now();
      if (Date.now() - stableSince >= 450) return;
    } else {
      stableSince = null;
    }
    await sleep(50);
  }
  throw new Error("action_idle_timeout");
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

function activeActionIds(events) {
  const active = new Set();
  for (const event of events) {
    const actionId = typeof event.payload?.requestId === "string" && /^[a-f0-9]{32}$/u.test(event.payload.requestId)
      ? `main:${event.payload.requestId}`
      : typeof event.payload?.actionInstanceId === "string" && /^[A-Za-z0-9_-]{1,64}$/u.test(event.payload.actionInstanceId)
        ? `local:${event.payload.actionInstanceId}`
        : null;
    if (!actionId) continue;
    if (event.type === "pet_interaction_action_started") active.add(actionId);
    if (isTerminal(event)) active.delete(actionId);
  }
  return active;
}

function isStarted(event, reason) {
  return event.type === "pet_interaction_action_started" && event.payload?.reason === reason &&
    typeof event.payload?.requestId === "string";
}

function isTerminal(event) {
  return event.type === "pet_interaction_action_finished" || event.type === "pet_interaction_action_skipped";
}

async function waitForStartupAppearanceFinished(context, timeoutMs) {
  return waitForTelemetry(
    context,
    0,
    (event) =>
      event.type === "pet_interaction_action_finished" &&
      event.payload?.type === "appearance",
    timeoutMs
  );
}

function recordBaselineCanvasState(context, value) {
  const width = Number.isSafeInteger(value?.width) && value.width >= 0 ? value.width : 0;
  const height = Number.isSafeInteger(value?.height) && value.height >= 0 ? value.height : 0;
  context.p288BaselineCanvasWidth = width;
  context.p288BaselineCanvasHeight = height;
  context.p288BaselineCanvasSizeNonZero = width > 0 && height > 0;
}

function recordBaselineObservation(context, value) {
  context.p288BaselineVisible = value?.baselineVisible === true;
  context.p288BaselineRendererContextLost = value?.rendererContextLost === true;
  context.p288BaselineRendererVisiblePixels =
    Number.isSafeInteger(value?.rendererVisiblePixels) ? value.rendererVisiblePixels : 0;
  context.p288BaselinePngVisiblePixels = 0;
  context.p288BaselineProbeAttempts =
    Number.isSafeInteger(value?.rendererProbeAttempts) ? value.rendererProbeAttempts : 0;
  recordBaselineCanvasState(context, {
    width: value?.canvasWidth,
    height: value?.canvasHeight
  });
}

async function cleanup(context) {
  try {
    await stopElectron(context);
  } catch {
    // The final summary remains a fail if the runner did not complete its evidence path.
  }
  let cleanupFailed = false;
  try { cleanupPetOnlyVisualEvidence(context); } catch { cleanupFailed = true; }
  try { cleanupRealUiRun(context); } catch { cleanupFailed = true; }
  if (cleanupFailed) throw new Error("visual_evidence_cleanup_failed");
}

function classifyFailure(error) {
  const message = error instanceof Error ? error.message : "runner_error";
  return ["runner_timeout", "provider_chat_failed", "send_timeout", "action_idle_timeout", "telemetry_wait_timeout", "pet_renderer_not_visible", "waiting_terminal_defer_missing", "affect_dispatch_suppressed", "state_idle_not_started", "visual_review_rejected", "visual_review_timeout", "visual_review_evidence_unavailable"].includes(message)
    ? message
    : "runner_error";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
