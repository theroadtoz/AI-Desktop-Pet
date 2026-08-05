import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertNoScreenshotResidue,
  assertRealUiRunParentRemoved,
  cleanupRealUiRun,
  click,
  connectToElectron,
  createRealUiRunContext,
  evaluate,
  readAcceptanceEvidenceForContext,
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
const packRoot = resolve(
  process.env.P2_88B_LOCAL_LLM_PACK_ROOT ||
  process.env.AI_DESKTOP_PET_LOCAL_LLM_SOURCE_ROOT ||
  join(root, "resources", "local-llm")
);
const FIXTURE_MESSAGE = "__p2_88b_medium_happy_fixture__，以后回复短一点。";
const RUNTIME_TIMEOUT_MS = 180_000;
const RUN_TIMEOUT_MS = 660_000;
export const FIRST_GENERIC_LIFECYCLE_TIMEOUT_MS = 15_000;
const MAX_BUNDLED_DIAGNOSTIC_COUNT = 10_000;
const DIAGNOSTIC_EVENT_TYPES = new Set([
  "p2_88b_affect_reply_action_gate",
  "dialogue_affect_action_dispatch",
  "pet_interaction_action_started",
  "pet_interaction_action_finished",
  "pet_interaction_action_skipped"
]);
const DIAGNOSTIC_ACTION_TYPES = new Set([
  "appearance", "headPat", "bodyAttentionTurn", "dialogueOpenWelcome", "replyWarmSettle",
  "musicListenSway", "gamePresenceGlance", "searchNoteSettle", "returnFromIdle",
  "eveningWindowGlance", "longWorkRecovery", "greeting", "listen", "curiousTilt",
  "softSmile", "quietNod", "shySmile", "lookAway", "thinking", "replyThinking",
  "playGame", "gameReady", "gameCheerLite", "reading", "readingIdle", "readingThink",
  "focus", "workFocus", "doze", "sleepySettle", "edgeGlance", "flusteredGlance", "replySustain"
]);
const DIAGNOSTIC_INTERACTION_REASONS = new Set([
  "startup_first_visible_frame", "click_head", "click_body", "window_shake_feedback",
  "chat_opened", "chat_input_focus", "chat_reply_waiting", "pet_edge_settled",
  "rapid_touch_combo", "chat_reply_sustain", "chat_reply_completed",
  "state_music_playing_stable", "state_game_presence_stable", "return_from_idle",
  "evening_companion_tick", "long_work_session_complete", "state_idle", "state_greet",
  "state_listen", "state_think", "state_reply_sustain", "state_sleep", "state_work",
  "state_game", "state_read", "state_edge", "state_flustered", "state_local_model_busy",
  "state_memory_injected", "state_memory_skipped", "state_search_cited", "state_proactive_bubble_visible"
]);
const DIAGNOSTIC_DISPATCH_REASONS = new Set([
  "accepted", "busy", "invalid_policy", "unsafe_request_id", "duplicate_request_id",
  "request_id_failed", "send_failed"
]);
const PET_RENDERER_READY_EXPRESSION = `(() => {
  const canvas = document.querySelector("#pet-canvas");
  return Boolean(window.petApi && canvas && canvas.width > 0 && canvas.height > 0);
})()`;

async function main() {
  const validation = validateLocalLlmPack(packRoot);
  if (!validation.ok) {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      mode: "bundled-local-qwen-real-ui",
      failure: validation.status,
      validation
    })}\n`);
    process.exitCode = 1;
    return;
  }

  const context = createRealUiRunContext({
    runName: "p2-88b-affect-presentation-bundled-real-ui",
    port: 9743,
    env: {
      AI_DESKTOP_PET_PROVIDER: "",
      AI_DESKTOP_PET_API_KEY: "",
      AI_DESKTOP_PET_BASE_URL: "",
      AI_DESKTOP_PET_MODEL: "",
      AI_DESKTOP_PET_BUNDLED_LLAMA_CPP_ROOT: packRoot,
      AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY: "1",
      AI_DESKTOP_PET_P2_88B_SAFE_FIXTURE: "1",
      AI_DESKTOP_PET_P2_88B_VISUAL_REVIEW_HANDSHAKE:
        process.env.AI_DESKTOP_PET_P2_88B_VISUAL_REVIEW_HANDSHAKE === "1" ? "1" : ""
    },
    tmpResiduePatterns: [/^p2-88b-affect-presentation-bundled-real-ui$/i]
  });
  context.electronArgs = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
  context.p288Stage = "entry";

  let summary;
  try {
    summary = await runWithRealUiDeadline(() => run(context, validation), RUN_TIMEOUT_MS);
  } catch (error) {
    summary = {
      ok: false,
      mode: "bundled-local-qwen-real-ui",
      failureStage: context.p288Stage,
      failure: classifyFailure(error),
      failureName: error instanceof Error ? error.name : "unknown",
      gateDecision: context.p288GateDecision ?? null,
      gateReason: context.p288GateReason ?? null,
      activeMainReason: context.p288ActiveMainReason ?? null,
      localBusyReason: context.p288LocalBusyReason ?? null,
      blockerTerminalMatched: context.p288BlockerTerminalMatched ?? false,
      dispatchStatus: context.p288DispatchStatus ?? null,
      dispatchReason: context.p288DispatchReason ?? null,
      dispatchRequestIdPresent: context.p288DispatchRequestIdPresent ?? false,
      cooldownRetryObserved: context.p288CooldownRetryObserved ?? false,
      retryDispatchRequestIdPresent: context.p288RetryDispatchRequestIdPresent ?? false,
      retryRequestIdDistinct: context.p288RetryRequestIdDistinct ?? false,
      retryDispatchReasonAllowed: context.p288RetryDispatchReasonAllowed ?? false,
      acceptedDispatchCount: context.p288AcceptedDispatchCount ?? 0,
      terminalRequestIdMatched: context.p288TerminalRequestIdMatched ?? false,
      dispatchReasonAllowed: context.p288DispatchReasonAllowed ?? false,
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
      humanVisualReviewConfirmed: context.p288HumanVisualReviewConfirmed ?? false,
      firstLifecycleDiagnostic: context.p288FirstLifecycleDiagnostic ?? null,
      validation
    };
  } finally {
    try {
      await cleanup(context);
      assertRealUiRunParentRemoved(context);
    } catch {
      summary = { ...summary, ok: false, failure: "visual_evidence_cleanup_failed" };
    }
    if (summary?.checks) summary.checks.visualEvidenceDeleted = context.p288VisualEvidenceDeleted === true;
    else if (summary) summary.visualEvidenceDeleted = context.p288VisualEvidenceDeleted === true;
  }

  process.stdout.write(`${JSON.stringify(summary)}\n`);
  if (!summary.ok) process.exitCode = 1;
}

async function run(context, validation) {
  context.p288Stage = "electron_start";
  startElectron(context);
  context.p288Stage = "cdp_connect";
  await connectToElectron(context, 45_000);
  const pet = await waitForWindow(context, "renderer/pet/index.html", 45_000);
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
  await waitFor(pet, "Boolean(window.petApi?.openChat)", { timeoutMs: 20_000 });
  await evaluate(pet, "window.petApi.openChat()");
  const chat = await waitForWindow(context, "renderer/chat/index.html", 45_000);
  await waitFor(chat, "Boolean(window.configApi?.getProviderStatus)", { timeoutMs: 30_000 });

  context.p288Stage = "provider_status";
  const provider = await waitForEmbeddedProvider(chat, validation);

  context.p288Stage = "initial_idle";
  await waitForActionIdle(context, 12_000);

  context.p288Stage = "first_fixture";
  const firstStart = readTelemetry(context).length;
  let replyUiCompleted = false;
  try {
    await sendMessage(chat, FIXTURE_MESSAGE);
    replyUiCompleted = true;
    await waitForFirstReplyCompletionActionIdle(context, firstStart);
  } catch (error) {
    if (!replyUiCompleted) {
      context.p288FirstLifecycleDiagnostic = createBundledFirstLifecycleDiagnostic({
        replyUiCompleted: false
      });
    }
    throw error;
  }
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
    RUNTIME_TIMEOUT_MS
  );
  context.p288GateDecision = gate.payload?.decision ?? null;
  context.p288GateReason = gate.payload?.reason ?? null;
  context.p288ActiveMainReason = gate.payload?.activeMainReason ?? null;
  context.p288LocalBusyReason = gate.payload?.localBusyReason ?? null;
  const gateAllowed = gate.payload?.decision === "allow" && gate.payload?.reason === "allowed";
  const deferredAfterWaitingTerminal =
    gate.payload?.decision === "suppress" &&
    gate.payload?.reason === "presentation_busy" &&
    (gate.payload?.activeMainReason === "chat_reply_waiting" ||
      gate.payload?.activeMainReason === "state_local_model_busy");
  if (!gateAllowed && !deferredAfterWaitingTerminal) {
    throw new Error("bundled_affect_gate_suppressed");
  }
  let blockerTerminalMatched = !deferredAfterWaitingTerminal;
  if (deferredAfterWaitingTerminal) {
    context.p288Stage = "reply_waiting_blocker_terminal";
    const blockerStarted = await waitForTelemetry(
      context,
      secondStart,
      (event) => isStarted(event, gate.payload.activeMainReason),
      RUNTIME_TIMEOUT_MS
    );
    await waitForTelemetry(
      context,
      secondStart,
      (event) =>
        isTerminal(event) &&
        event.payload?.reason === gate.payload.activeMainReason &&
        event.payload?.requestId === blockerStarted.payload?.requestId,
      RUNTIME_TIMEOUT_MS
    );
    blockerTerminalMatched = true;
  }
  context.p288BlockerTerminalMatched = blockerTerminalMatched;
  context.p288Stage = "affect_dispatch";
  const dispatch = await waitForTelemetry(
    context,
    secondStart,
    (event) => event.type === "dialogue_affect_action_dispatch",
    RUNTIME_TIMEOUT_MS
  );
  context.p288DispatchStatus = dispatch.payload?.status ?? null;
  context.p288DispatchReason = dispatch.payload?.reason ?? null;
  context.p288DispatchRequestIdPresent = typeof dispatch.payload?.requestId === "string";
  context.p288DispatchReasonAllowed = dispatch.payload?.reason === "accepted";
  if (dispatch.payload?.status !== "accepted") throw new Error("bundled_affect_dispatch_suppressed");
  const initialRequestId = typeof dispatch.payload?.requestId === "string" ? dispatch.payload.requestId : "";
  if (!context.p288DispatchRequestIdPresent || !context.p288DispatchReasonAllowed) {
    throw new Error("bundled_affect_dispatch_invalid");
  }
  context.p288Stage = "state_idle_started";
  const startedOrTerminal = await waitForTelemetry(
    context,
    secondStart,
    (event) =>
      (isStarted(event, "state_idle") && event.payload?.requestId === initialRequestId) ||
      (isTerminal(event) && event.payload?.reason === "state_idle" && event.payload?.requestId === initialRequestId),
    RUNTIME_TIMEOUT_MS
  );
  let started = startedOrTerminal;
  let retryDispatch = null;
  let cooldownRetryObserved = false;
  if (!isStarted(startedOrTerminal, "state_idle")) {
    context.p288StateIdleTerminalType = startedOrTerminal.type;
    context.p288StateIdleSkipReason = startedOrTerminal.payload?.skipReason ?? null;
    if (
      startedOrTerminal.type !== "pet_interaction_action_skipped" ||
      startedOrTerminal.payload?.skipReason !== "global_cooldown"
    ) {
      throw new Error("bundled_state_idle_not_started");
    }
    cooldownRetryObserved = true;
    context.p288CooldownRetryObserved = true;
    context.p288Stage = "global_cooldown_retry_dispatch";
    retryDispatch = await waitForTelemetry(
      context,
      secondStart,
      (event) =>
        event.type === "dialogue_affect_action_dispatch" &&
        event.payload?.status === "accepted" &&
        typeof event.payload?.requestId === "string" &&
        event.payload.requestId !== initialRequestId,
      RUNTIME_TIMEOUT_MS
    );
    context.p288RetryDispatchRequestIdPresent = typeof retryDispatch.payload?.requestId === "string" &&
      retryDispatch.payload.requestId.length > 0;
    context.p288RetryRequestIdDistinct = context.p288RetryDispatchRequestIdPresent &&
      retryDispatch.payload.requestId !== initialRequestId;
    context.p288RetryDispatchReasonAllowed = retryDispatch.payload?.reason === "accepted";
    if (!context.p288RetryDispatchRequestIdPresent || !context.p288RetryRequestIdDistinct || !context.p288RetryDispatchReasonAllowed) {
      throw new Error("bundled_global_cooldown_retry_invalid");
    }
    context.p288Stage = "global_cooldown_retry_started";
    started = await waitForTelemetry(
      context,
      secondStart,
      (event) => isStarted(event, "state_idle") && event.payload?.requestId === retryDispatch.payload?.requestId,
      RUNTIME_TIMEOUT_MS
    );
  }
  context.p288Stage = "state_idle_visual_evidence";
  const visualEvidence = await capturePetOnlyStateIdleVisualEvidence({
    pet,
    context,
    hasExactTerminal: () => readTelemetry(context).slice(secondStart).some(
      (event) => isTerminal(event) && event.payload?.requestId === started.payload?.requestId
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
    (event) => isTerminal(event) && event.payload?.requestId === started.payload?.requestId,
    RUNTIME_TIMEOUT_MS
  );
  const dispatchRequestIdPresent = context.p288DispatchRequestIdPresent;
  const terminalRequestIdMatched = started.payload?.requestId === (retryDispatch?.payload?.requestId ?? initialRequestId) &&
    terminal.payload?.requestId === started.payload?.requestId;
  const dispatchReasonAllowed = context.p288DispatchReasonAllowed;
  context.p288TerminalRequestIdMatched = terminalRequestIdMatched;
  context.p288Stage = "final_idle";
  await sleep(500);

  const relevant = readTelemetry(context).slice(secondStart).filter((event) =>
    event.type === "p2_88b_affect_reply_action_gate" ||
    event.type === "dialogue_affect_action_dispatch" ||
    isStarted(event) || isTerminal(event)
  );
  const providerEmbedded = isExactBundledProviderStatus(provider, validation);
  const noBodyLeak = !JSON.stringify(relevant).includes(FIXTURE_MESSAGE);
  const acceptedDispatchCount = relevant.filter(
    (event) => event.type === "dialogue_affect_action_dispatch" && event.payload?.status === "accepted"
  ).length;
  context.p288AcceptedDispatchCount = acceptedDispatchCount;
  const exactAcceptedDispatchCount = acceptedDispatchCount === (cooldownRetryObserved ? 2 : 1);
  const stateIdleStarted = started.payload?.reason === "state_idle";
  const stateIdleTerminalMatched = terminal.payload?.reason === "state_idle" &&
    terminal.payload?.requestId === started.payload?.requestId;
  assertNoScreenshotResidue(context);

  return {
    ok: firstSignalHeld &&
      providerEmbedded &&
      (gateAllowed || deferredAfterWaitingTerminal) &&
      blockerTerminalMatched &&
      exactAcceptedDispatchCount &&
      dispatchRequestIdPresent &&
      terminalRequestIdMatched &&
      dispatchReasonAllowed &&
      stateIdleStarted &&
      stateIdleTerminalMatched &&
      baseline.baselineVisible &&
      visualEvidence.stateIdleFrameVisible &&
      (!visualReview.visualReviewHandshakeEnabled || visualReview.humanVisualReviewConfirmed) &&
      (!cooldownRetryObserved || (
        context.p288RetryDispatchRequestIdPresent &&
        context.p288RetryRequestIdDistinct &&
        context.p288RetryDispatchReasonAllowed
      )) &&
      noBodyLeak,
    mode: "bundled-local-qwen-real-ui",
    model: validation.alias,
    evidenceBoundary: "real bundled local-provider reply verifies natural reply-completion idle action lifecycle, not real emotion understanding",
    checks: {
      firstSignalHeld,
      providerEmbedded,
      gateAllowed,
      deferredAfterWaitingTerminal,
      blockerTerminalMatched,
      cooldownRetryObserved,
      retryDispatchRequestIdPresent: context.p288RetryDispatchRequestIdPresent ?? false,
      retryRequestIdDistinct: context.p288RetryRequestIdDistinct ?? false,
      retryDispatchReasonAllowed: context.p288RetryDispatchReasonAllowed ?? false,
      acceptedDispatchCount,
      exactAcceptedDispatchCount,
      dispatchRequestIdPresent,
      terminalRequestIdMatched,
      dispatchReasonAllowed,
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
      stateIdleTerminalMatched,
      noBodyLeak
    }
  };
}

async function sendMessage(page, message) {
  const before = await evaluate(page, "document.querySelectorAll('.message-pet .message-content').length");
  await typeText(page, "#chat-input", message);
  await click(page, "#send-button");
  const deadline = Date.now() + RUNTIME_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const state = await evaluate(page, `(() => {
      const input = document.querySelector("#chat-input");
      const replies = [...document.querySelectorAll(".message-pet .message-content")];
      return { inputDisabled: Boolean(input?.disabled), replyCount: replies.length, lastReplyLength: replies.at(-1)?.textContent?.trim().length ?? 0, sessionState: document.querySelector("#chat-session-note")?.dataset.state ?? "" };
    })()`);
    if (state.replyCount > before && !state.inputDisabled && state.lastReplyLength > 0) return;
    if (state.replyCount <= before && !state.inputDisabled && state.sessionState === "error") throw new Error("provider_chat_failed");
    await sleep(200);
  }
  throw new Error("send_timeout");
}

export function isExactBundledProviderStatus(provider, validation) {
  return validation?.ok === true &&
    typeof validation.alias === "string" &&
    validation.alias.length > 0 &&
    provider?.providerId === "local-openai-compatible" &&
    provider.model === validation.alias &&
    provider.isFallback === false;
}

async function waitForEmbeddedProvider(page, validation) {
  const deadline = Date.now() + RUNTIME_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const provider = await evaluate(page, "window.configApi.getProviderStatus()");
    if (isExactBundledProviderStatus(provider, validation)) return provider;
    await sleep(400);
  }
  throw new Error("embedded_provider_timeout");
}

async function waitForTelemetry(context, startIndex, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const entry = readTelemetry(context).slice(startIndex).find(predicate);
    if (entry) return entry;
    await sleep(50);
  }
  throw new Error("telemetry_wait_timeout");
}

async function waitForFirstReplyCompletionActionIdle(context, startIndex) {
  const atReplyDone = readBundledFirstLifecycleSnapshot(context, startIndex);
  const deadline = Date.now() + FIRST_GENERIC_LIFECYCLE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const events = readTelemetry(context).slice(startIndex);
    if (hasExactFirstGenericReplyLifecycle(events)) {
      await waitForActionIdle(context, Math.max(1, deadline - Date.now()));
      return;
    }
    await sleep(50);
  }
  const atTimeout = readBundledFirstLifecycleSnapshot(context, startIndex);
  context.p288FirstLifecycleDiagnostic = createBundledFirstLifecycleDiagnostic({
    replyUiCompleted: true,
    events: readTelemetry(context).slice(startIndex),
    atReplyDone,
    atTimeout
  });
  throw new Error("first_generic_reply_lifecycle_incomplete");
}

function readBundledFirstLifecycleSnapshot(context, firstStart) {
  const result = readAcceptanceEvidenceForContext(context, "p2-88b");
  if (!result.ok) throw new Error("acceptance_evidence_invalid");
  const fileExists = existsSync(join(
    context.appDataDir,
    "acceptance-evidence",
    `${context.acceptanceRunId}.ndjson`
  ));
  return createBundledFirstLifecycleSnapshot({ fileExists, events: result.events, firstStart });
}

export function createBundledFirstLifecycleSnapshot({ fileExists, events, firstStart }) {
  if (typeof fileExists !== "boolean" || !Array.isArray(events) ||
    !Number.isSafeInteger(firstStart) || firstStart < 0 || firstStart > events.length ||
    events.length > MAX_BUNDLED_DIAGNOSTIC_COUNT) {
    throw new Error("bundled_diagnostic_snapshot_invalid");
  }
  const sinceStart = events.slice(firstStart);
  const tuples = new Map();
  for (const event of sinceStart) {
    const tuple = projectBundledEvidenceTuple(event);
    if (!tuple) throw new Error("bundled_diagnostic_event_invalid");
    const key = JSON.stringify(tuple);
    tuples.set(key, { ...tuple, count: (tuples.get(key)?.count ?? 0) + 1 });
  }
  const snapshot = {
    fileExists,
    parsedCount: events.length,
    sinceStartCount: sinceStart.length,
    events: [...tuples.values()].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)))
  };
  if (!isSafeBundledFirstLifecycleSnapshot(snapshot)) throw new Error("bundled_diagnostic_snapshot_unsafe");
  return snapshot;
}

function projectBundledEvidenceTuple(event) {
  if (!event || typeof event !== "object" || !DIAGNOSTIC_EVENT_TYPES.has(event.type) ||
    !event.payload || typeof event.payload !== "object") return null;
  const { payload } = event;
  const tuple = { type: event.type };
  if (event.type === "p2_88b_affect_reply_action_gate") {
    if (payload.reason !== "allowed" && payload.reason !== "presentation_busy") return null;
    return { ...tuple, reason: payload.reason };
  }
  if (event.type === "dialogue_affect_action_dispatch") {
    if ((payload.status !== "accepted" && payload.status !== "rejected") || !DIAGNOSTIC_DISPATCH_REASONS.has(payload.reason)) return null;
    return { ...tuple, status: payload.status, reason: payload.reason };
  }
  if (!DIAGNOSTIC_ACTION_TYPES.has(payload.actionType) || !DIAGNOSTIC_INTERACTION_REASONS.has(payload.reason)) return null;
  if (event.type === "pet_interaction_action_skipped") {
    if (payload.skipReason !== "global_cooldown") return null;
    return { ...tuple, actionType: payload.actionType, reason: payload.reason, skipReason: payload.skipReason };
  }
  return { ...tuple, actionType: payload.actionType, reason: payload.reason };
}

function isSafeBundledFirstLifecycleSnapshot(value) {
  if (!value || typeof value !== "object") return false;
  const keys = Object.keys(value).sort();
  if (keys.length !== 4 || keys.join(",") !== "events,fileExists,parsedCount,sinceStartCount" ||
    typeof value.fileExists !== "boolean" || !isDiagnosticCount(value.parsedCount) ||
    !isDiagnosticCount(value.sinceStartCount) || value.sinceStartCount > value.parsedCount ||
    !Array.isArray(value.events)) return false;
  return value.events.every((event) => isSafeBundledEvidenceTuple(event));
}

function isSafeBundledEvidenceTuple(value) {
  if (!value || typeof value !== "object" || !DIAGNOSTIC_EVENT_TYPES.has(value.type) || !isDiagnosticCount(value.count) || value.count === 0) return false;
  const keys = Object.keys(value).sort();
  if (value.type === "p2_88b_affect_reply_action_gate") {
    return keys.join(",") === "count,reason,type" && (value.reason === "allowed" || value.reason === "presentation_busy");
  }
  if (value.type === "dialogue_affect_action_dispatch") {
    return keys.join(",") === "count,reason,status,type" &&
      (value.status === "accepted" || value.status === "rejected") && DIAGNOSTIC_DISPATCH_REASONS.has(value.reason);
  }
  if (value.type === "pet_interaction_action_skipped") {
    return keys.join(",") === "actionType,count,reason,skipReason,type" &&
      value.skipReason === "global_cooldown" &&
      DIAGNOSTIC_ACTION_TYPES.has(value.actionType) && DIAGNOSTIC_INTERACTION_REASONS.has(value.reason);
  }
  return keys.join(",") === "actionType,count,reason,type" &&
    DIAGNOSTIC_ACTION_TYPES.has(value.actionType) && DIAGNOSTIC_INTERACTION_REASONS.has(value.reason);
}

function isDiagnosticCount(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_BUNDLED_DIAGNOSTIC_COUNT;
}

export function createBundledFirstLifecycleDiagnostic({ replyUiCompleted, events = [], atReplyDone, atTimeout }) {
  if (replyUiCompleted !== true) return { classification: "reply_incomplete" };
  if (!isSafeBundledFirstLifecycleSnapshot(atReplyDone) || !isSafeBundledFirstLifecycleSnapshot(atTimeout) || !Array.isArray(events)) {
    throw new Error("bundled_diagnostic_input_invalid");
  }
  let classification;
  const gate = events.find((event) => event.type === "p2_88b_affect_reply_action_gate");
  const skippedGlobalCooldown = events.some((event) =>
    event.type === "pet_interaction_action_skipped" &&
    event.payload?.reason === "chat_reply_completed" &&
    event.payload?.skipReason === "global_cooldown"
  );
  if (skippedGlobalCooldown) {
    classification = "skipped_global_cooldown";
  } else if (!gate) {
    classification = "gate_absent";
  } else if (gate.payload?.reason === "presentation_busy" ||
    events.some((event) => event.type === "dialogue_affect_action_dispatch" && event.payload?.reason === "busy")) {
    classification = "presentation_busy";
  } else if (gate.payload?.decision !== "allow" || gate.payload?.reason !== "allowed") {
    classification = "non_warm";
  } else if (events.some((event) => event.type === "dialogue_affect_action_dispatch" && event.payload?.status === "accepted" && event.payload?.reason === "accepted")) {
    classification = "mapping_gap";
  } else {
    throw new Error("bundled_diagnostic_classification_unknown");
  }
  const diagnostic = { classification, atReplyDone, atTimeout };
  if (!isSafeBundledFirstLifecycleDiagnostic(diagnostic)) throw new Error("bundled_diagnostic_output_unsafe");
  return diagnostic;
}

export function isSafeBundledFirstLifecycleDiagnostic(value) {
  if (!value || typeof value !== "object" || typeof value.classification !== "string") return false;
  if (value.classification === "reply_incomplete") return Object.keys(value).length === 1;
  if (!new Set(["gate_absent", "presentation_busy", "non_warm", "mapping_gap", "skipped_global_cooldown"]).has(value.classification)) return false;
  const keys = Object.keys(value).sort();
  return keys.join(",") === "atReplyDone,atTimeout,classification" &&
    isSafeBundledFirstLifecycleSnapshot(value.atReplyDone) && isSafeBundledFirstLifecycleSnapshot(value.atTimeout);
}

export function hasExactFirstGenericReplyLifecycle(events) {
  const started = events.filter((event) => isStarted(event, "chat_reply_completed"));
  if (started.length !== 1) return false;
  const requestId = started[0].payload.requestId;
  const terminals = events.filter(
    (event) => isTerminal(event) &&
      event.payload?.reason === "chat_reply_completed" &&
      event.payload?.requestId === requestId
  );
  return terminals.length === 1 && terminals[0].type === "pet_interaction_action_finished";
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

function readTelemetry(context) {
  const result = readAcceptanceEvidenceForContext(context, "p2-88b");
  if (!result.ok) throw new Error("acceptance_evidence_invalid");
  return result.events;
}

function isStarted(event, reason) {
  return event.type === "pet_interaction_action_started" && event.payload?.reason === reason && typeof event.payload?.requestId === "string";
}

function isTerminal(event) {
  return event.type === "pet_interaction_action_finished" || event.type === "pet_interaction_action_skipped";
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

async function waitForStartupAppearanceFinished(context, timeoutMs) {
  return waitForTelemetry(
    context,
    0,
    (event) =>
      event.type === "pet_interaction_action_finished" &&
      event.payload?.actionType === "appearance",
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

function validateLocalLlmPack(resourceRoot) {
  const result = spawnSync(process.execPath, ["scripts/p2-20h-validate-local-llm-resources.mjs"], {
    cwd: root,
    env: { ...process.env, AI_DESKTOP_PET_LOCAL_LLM_SOURCE_ROOT: resourceRoot, AI_DESKTOP_PET_BUNDLED_LLAMA_CPP_ROOT: "" },
    encoding: "utf8",
    windowsHide: true
  });
  let summary = {};
  try { summary = JSON.parse(result.stdout?.trim() || "{}"); } catch { /* closed validator summary only */ }
  return { ok: result.status === 0 && summary.ok === true, status: summary.status ?? "validator_failed", alias: summary.alias, resourceRootName: summary.resourceRootName ?? basename(resourceRoot), safeSummaryOnly: true };
}

async function cleanup(context) {
  try { await stopElectron(context); } catch { /* preserve run result */ }
  let cleanupFailed = false;
  try { cleanupPetOnlyVisualEvidence(context); } catch { cleanupFailed = true; }
  try { cleanupRealUiRun(context); } catch { cleanupFailed = true; }
  if (cleanupFailed) throw new Error("visual_evidence_cleanup_failed");
}

function classifyFailure(error) {
  const message = error instanceof Error ? error.message : "runner_error";
  return ["runner_timeout", "embedded_runtime_timeout", "embedded_provider_timeout", "provider_chat_failed", "send_timeout", "action_idle_timeout", "telemetry_wait_timeout", "pet_renderer_not_visible", "bundled_affect_gate_suppressed", "bundled_affect_dispatch_suppressed", "bundled_state_idle_not_started", "visual_review_rejected", "visual_review_timeout", "visual_review_evidence_unavailable"].includes(message) ? message : "runner_error";
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
