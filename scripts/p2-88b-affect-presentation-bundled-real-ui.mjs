import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
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
const packRoot = resolve(
  process.env.P2_88B_LOCAL_LLM_PACK_ROOT ||
  process.env.AI_DESKTOP_PET_LOCAL_LLM_SOURCE_ROOT ||
  join(root, "resources", "local-llm")
);
const FIXTURE_MESSAGE = "__p2_88b_medium_happy_fixture__，以后回复短一点。";
const RUNTIME_TIMEOUT_MS = 180_000;
const RUN_TIMEOUT_MS = 660_000;
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
      validation
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

  context.p288Stage = "runtime_handoff";
  const handoff = await waitForEmbeddedRuntime(context);
  const provider = await waitForEmbeddedProvider(chat, handoff);

  context.p288Stage = "first_fixture";
  const firstStart = readTelemetry(context).length;
  await sendMessage(chat, FIXTURE_MESSAGE);
  await waitForFirstReplyCompletionActionIdle(context, firstStart, RUNTIME_TIMEOUT_MS);
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
  const providerEmbedded = provider?.providerId === "local-openai-compatible" && provider?.isFallback === false;
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
    model: handoff.alias ?? validation.alias ?? "unknown",
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

async function waitForEmbeddedRuntime(context) {
  const deadline = Date.now() + RUNTIME_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const entries = readTelemetry(context);
    const runtime = [...entries].reverse().find((entry) => entry.type === "bundled_llama_cpp_runtime_status" && entry.payload?.status === "ready")?.payload;
    const handoff = [...entries].reverse().find((entry) => entry.type === "bundled_llama_cpp_provider_handoff")?.payload;
    if (runtime?.status === "ready" && handoff?.providerId === "local-openai-compatible" && handoff?.localPresetId === "embedded-llama-cpp") return handoff;
    await sleep(400);
  }
  throw new Error("embedded_runtime_timeout");
}

async function waitForEmbeddedProvider(page, handoff) {
  const deadline = Date.now() + RUNTIME_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const provider = await evaluate(page, "window.configApi.getProviderStatus()");
    if (provider?.providerId === "local-openai-compatible" && provider?.model === handoff?.alias && provider?.isFallback === false) return provider;
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

async function waitForFirstReplyCompletionActionIdle(context, startIndex, timeoutMs) {
  const started = await waitForTelemetry(
    context,
    startIndex,
    (event) => isStarted(event, "chat_reply_completed"),
    timeoutMs
  );
  await waitForTelemetry(
    context,
    startIndex,
    (event) =>
      isTerminal(event) &&
      event.payload?.reason === "chat_reply_completed" &&
      event.payload?.requestId === started.payload?.requestId,
    timeoutMs
  );
  await waitForActionIdle(context, timeoutMs);
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
  const logDir = join(context.appDataDir, "logs");
  if (!existsSync(logDir)) return [];
  return readdirSync(logDir).filter((name) => name.startsWith("telemetry-") && name.endsWith(".jsonl"))
    .map((name) => join(logDir, name)).sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs)
    .flatMap((path) => readFileSync(path, "utf8").split(/\r?\n/u).flatMap((line) => {
      try { return line ? [JSON.parse(line)] : []; } catch { return []; }
    }));
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
