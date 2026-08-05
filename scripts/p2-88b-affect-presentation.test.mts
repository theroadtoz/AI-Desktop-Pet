import assert from "node:assert/strict";
import test from "node:test";
import { resolveAffectDialoguePresentation } from "../src/main/services/affect/affect-dialogue-presentation-resolver.ts";
import { resolveCompanionContextArbitration } from "../src/main/services/companion-context/companion-context-arbitration-policy.ts";
import { createXitaAffectCoordinator } from "../src/main/services/affect/xita-affect-coordinator.ts";
import {
  PET_ACTION_TRIGGER_SAME_REASON_THROTTLE_MS,
  PET_INTERACTION_GLOBAL_COOLDOWN_MS,
  REPLY_COMPLETION_AFFECT_GLOBAL_COOLDOWN_RETRY_DELAY_MS
} from "../src/shared/pet-interaction-cooldown.ts";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createBundledFirstLifecycleDiagnostic,
  createBundledFirstLifecycleSnapshot,
  hasExactFirstGenericReplyLifecycle,
  isSafeBundledFirstLifecycleDiagnostic,
  isExactBundledProviderStatus
} from "./p2-88b-affect-presentation-bundled-real-ui.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function arbitrationInput(
  update: Partial<Parameters<typeof resolveCompanionContextArbitration>[0]> = {}
) {
  return {
    channel: "reply-completion-affect-action" as never,
    lifecycle: "ready",
    interaction: "chat-visible",
    engagement: "allowed",
    dialogueMode: "default",
    dialogueSource: "default",
    presenceMode: "default",
    affectBand: "gentle",
    presentationBusy: false,
    proactiveCadence: "normal",
    affectEnabled: true,
    relevantSourceEnabled: true,
    environmentEnabled: true,
    ...update
  } as const;
}

test("P2-88B lets only medium happy request the existing idle soft-smile route", () => {
  assert.deepEqual(resolveAffectDialoguePresentation({ state: "happy", intensity: "low" }).action, null);
  assert.deepEqual(resolveAffectDialoguePresentation({ state: "happy", intensity: "medium" }).action, {
    reason: "state_idle"
  });
  assert.deepEqual(resolveAffectDialoguePresentation({ state: "happy", intensity: "high" }).action, null);
});

test("P2-88B keeps presentation reachable only for calm happy concerned and serious", () => {
  assert.deepEqual(resolveAffectDialoguePresentation({ state: "concerned", intensity: "low" }).action, {
    reason: "state_listen"
  });
  assert.deepEqual(resolveAffectDialoguePresentation({ state: "serious", intensity: "medium" }).action, {
    reason: "state_think"
  });

  for (const state of ["curious", "playful", "embarrassed", "sleepy"] as const) {
    assert.deepEqual(resolveAffectDialoguePresentation({ state, intensity: "low" }), {
      expression: { emotion: "neutral", intensity: "low", mode: "neutral" },
      action: null,
      replyAction: "suppressed"
    });
  }
});

test("P2-88B exposes a closed reply-completion choice that never upgrades high affect", () => {
  assert.equal(
    resolveAffectDialoguePresentation({ state: "calm", intensity: "low" }).replyAction,
    "generic"
  );
  assert.equal(
    resolveAffectDialoguePresentation({ state: "happy", intensity: "low" }).replyAction,
    "suppressed"
  );
  assert.equal(
    resolveAffectDialoguePresentation({ state: "happy", intensity: "medium" }).replyAction,
    "affect"
  );
  for (const state of ["happy", "concerned", "serious"] as const) {
    const resolution = resolveAffectDialoguePresentation({ state, intensity: "high" });
    assert.equal(resolution.replyAction, "suppressed");
    assert.deepEqual(resolution.expression, { emotion: "neutral", intensity: "low", mode: "neutral" });
  }
});

test("P2-88B reply-completion affect actions retain the existing busy focus sleep and disabled gates", () => {
  assert.deepEqual(resolveCompanionContextArbitration(arbitrationInput()), {
    decision: "allow",
    reason: "allowed",
    replay: "never",
    actionIntent: "affect-action",
    priority: 20
  });

  for (const update of [
    { presentationBusy: true, reason: "presentation_busy" },
    { interaction: "model-busy" as const, reason: "model_busy" },
    { lifecycle: "sleep" as const, reason: "lifecycle_sleep" },
    { dialogueMode: "work" as const, reason: "focus_suppressed" },
    { affectEnabled: false, reason: "affect_disabled" }
  ]) {
    const decision = resolveCompanionContextArbitration(arbitrationInput(update));
    assert.equal(decision.decision, "suppress");
    assert.equal(decision.reason, update.reason);
    assert.equal(decision.replay, "never");
  }
});

test("P2-88B keeps tired distinct from sleepy and does not dispatch during background affect inference", () => {
  const coordinator = createXitaAffectCoordinator({ now: () => 1_000 });
  assert.equal(coordinator.applyUserAffect({
    kind: "tired",
    confidence: "high",
    source: "explicit-text",
    observedAtMs: 1_000
  }).state, "concerned");

  const appSource = readFileSync(join(repoRoot, "src/main/app.ts"), "utf8");
  const start = appSource.indexOf("function startBackgroundUserAffectClassification");
  const end = appSource.indexOf("function getCompanionContextLifecycle", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const backgroundInference = appSource.slice(start, end);
  assert.match(backgroundInference, /inference\.coordinator\.applyUserAffect\(affect\)/);
  assert.doesNotMatch(backgroundInference, /requestPetActionTrigger|sendPetActionTrigger|resolveDialogueReplyActionReason/);
});

test("P2-88B keeps its medium-happy real-UI input behind an acceptance-only closed fixture", () => {
  const appSource = readFileSync(join(repoRoot, "src/main/app.ts"), "utf8");
  assert.match(appSource, /AI_DESKTOP_PET_P2_88B_SAFE_FIXTURE/);
  assert.match(appSource, /P2_88B_ACCEPTANCE_MEDIUM_HAPPY_FIXTURE/);
  assert.match(appSource, /kind: "positive",[\s\S]*confidence: "medium",[\s\S]*source: "conversational-inference"/);
  assert.match(appSource, /p2_88b_affect_reply_action_gate/);
  assert.match(appSource, /isP288bAcceptanceFixtureEnabled/);
  assert.match(appSource, /createReplyCompletionAffectActionController/);
  assert.match(appSource, /deferReplyCompletionAffectActionIfEligible/);
  assert.match(appSource, /dispatchDeferredReplyCompletionAffectAction/);
});

test("P2-88B keeps app retry orchestration thin and delegates its one-shot timer", () => {
  assert.equal(PET_ACTION_TRIGGER_SAME_REASON_THROTTLE_MS, 700);
  assert.ok(REPLY_COMPLETION_AFFECT_GLOBAL_COOLDOWN_RETRY_DELAY_MS > PET_ACTION_TRIGGER_SAME_REASON_THROTTLE_MS);
  assert.ok(REPLY_COMPLETION_AFFECT_GLOBAL_COOLDOWN_RETRY_DELAY_MS > PET_INTERACTION_GLOBAL_COOLDOWN_MS);

  const appSource = readFileSync(join(repoRoot, "src/main/app.ts"), "utf8");
  const scheduleStart = appSource.indexOf("function scheduleReplyCompletionAffectGlobalCooldownRetry");
  const scheduleEnd = appSource.indexOf("function applyAutomaticSituationSnapshot", scheduleStart);
  const scheduleSource = appSource.slice(scheduleStart, scheduleEnd);
  assert.notEqual(scheduleStart, -1);
  assert.notEqual(scheduleEnd, -1);
  assert.match(scheduleSource, /requestPetActionTriggerWithResult\(input\.reason\)/);
  assert.equal((scheduleSource.match(/requestPetActionTriggerWithResult\(/g) ?? []).length, 1);
  assert.match(scheduleSource, /replyCompletionAffectActionController\.scheduleAffectCooldownRetry\(\(\) =>/);
  assert.doesNotMatch(scheduleSource, /setTimeout|clearTimeout|trackAccepted|delete lastPetActionTriggerAtByReason|PET_ACTION_TRIGGER_SAME_REASON_THROTTLE_MS\s*=/);
  assert.match(appSource, /createReplyCompletionAffectActionController\(\{[\s\S]*replyCompletionAffectRetryScheduler\.schedule\(callback\)/);
  assert.match(appSource, /function cancelReplyCompletionAffectAction\(\): void \{\s*replyCompletionAffectActionController\.cancel\(\);\s*\}/);
});

test("P2-91C1 app delegates generic policy to the production controller with live typed adapters", () => {
  const appSource = readFileSync(join(repoRoot, "src/main/app.ts"), "utf8");
  const controllerSource = readFileSync(
    join(repoRoot, "src/main/services/affect/reply-completion-affect-action-controller.ts"),
    "utf8"
  );
  assert.match(appSource, /replyCompletionAffectActionController\.registerGenericCompletion\(\{/);
  assert.match(appSource, /replyCompletionAffectActionController\.handleGenericLifecycle\(\{/);
  assert.equal((appSource.match(/readSnapshot: readGenericReplyCompletionLiveSnapshot/g) ?? []).length, 2);
  assert.match(appSource, /dispatch: dispatchGenericReplyCompletionAction/);
  assert.match(appSource, /publish: publishPetPresentation/);
  assert.doesNotMatch(appSource, /deferReplyCompletionGenericActionIfEligible|dispatchDeferredReplyCompletionGenericAction|\.deferGeneric\(|\.consumeGenericAfterLifecycle\(/);

  const snapshotStart = appSource.indexOf("function readGenericReplyCompletionLiveSnapshot");
  const snapshotEnd = appSource.indexOf("function scheduleReplyCompletionAffectGlobalCooldownRetry", snapshotStart);
  const snapshotSource = appSource.slice(snapshotStart, snapshotEnd);
  assert.ok(snapshotStart >= 0 && snapshotEnd > snapshotStart);
  assert.match(snapshotSource, /latestCompletedRequestVersion: latestCompletedChatRequestVersion/);
  assert.match(snapshotSource, /activeRequestVersion: activeChatRequestVersion/);
  assert.match(snapshotSource, /hasActiveStream: chatEngine\?\.hasActiveStream\(\) \?\? false/);
  assert.doesNotMatch(snapshotSource, /presentation_busy|chat_reply_waiting|state_local_model_busy|trackAccepted|701/);

  assert.match(controllerSource, /input\.arbitration\.reason === "presentation_busy"/);
  assert.match(controllerSource, /input\.activeMainRequest\.reason === "chat_reply_waiting"/);
  assert.match(controllerSource, /input\.activeMainRequest\.reason === "state_local_model_busy"/);
  assert.match(controllerSource, /snapshot\.latestCompletedRequestVersion !== requestVersion/);
  assert.match(controllerSource, /snapshot\.activeRequestVersion !== null/);
  assert.match(controllerSource, /snapshot\.hasActiveStream/);
  assert.match(controllerSource, /publishAffectTerminalPresentation/);
  assert.match(controllerSource, /createReplyCompletionAffectRetryScheduler/);
  assert.match(controllerSource, /replaceScheduledPurpose\("generic_initial_settle"/);
  assert.match(controllerSource, /replaceScheduledPurpose\("affect_cooldown_retry"/);
  assert.doesNotMatch(controllerSource, /setTimeout|701/);
});

test("P2-91C1 generic completion is cancelled by new, abort, hide/close, rebuild, reset, disable, and quiesce", () => {
  const appSource = readFileSync(join(repoRoot, "src/main/app.ts"), "utf8");
  for (const marker of [
    'nextPetWindow.on("closed", () =>',
    "function rebuildPetWindow",
    "function handleChatWindowInactive(): void",
    'transitionPetRole({ type: "request:started", requestVersion: request.requestVersion })',
    'ipcMain.on("chat:abort", (event) =>',
    "currentDialogueAffectSettings = dialogueAffectSettingsStore.saveSettings(update);",
    "function quiesceApp(): void"
  ]) {
    const start = appSource.indexOf(marker);
    assert.notEqual(start, -1, marker);
    assert.match(appSource.slice(start, start + 650), /cancelReplyCompletionAffectAction\(\)/, marker);
  }
  assert.match(
    appSource,
    /createAppShutdownCoordinator\(\{[\s\S]*quiesce: quiesceApp,[\s\S]*destroyWindows: destroyAppWindows/
  );
});

test("P2-88B real-UI runners verify one global-cooldown retry without exposing request ids", () => {
  for (const runnerName of [
    "p2-88b-affect-presentation-real-ui.mjs",
    "p2-88b-affect-presentation-bundled-real-ui.mjs"
  ]) {
    const runnerSource = readFileSync(join(repoRoot, "scripts", runnerName), "utf8");
    for (const field of [
      "global_cooldown",
      "cooldownRetryObserved",
      "retryDispatchRequestIdPresent",
      "retryRequestIdDistinct",
      "retryDispatchReasonAllowed",
      "acceptedDispatchCount",
      "exactAcceptedDispatchCount",
      "terminalRequestIdMatched"
    ]) {
      assert.match(runnerSource, new RegExp(`\\b${field}\\b`));
    }
    assert.match(runnerSource, /acceptedDispatchCount === \(cooldownRetryObserved \? 2 : 1\)/);

    const summaryStart = runnerSource.indexOf("return {\n    ok:");
    const summaryEnd = runnerSource.indexOf("\n  };\n}", summaryStart);
    assert.notEqual(summaryStart, -1);
    assert.notEqual(summaryEnd, -1);
    const safeSuccessSummary = runnerSource.slice(summaryStart, summaryEnd);
    assert.doesNotMatch(safeSuccessSummary, /FIXTURE_MESSAGE|appDataDir|packRoot|payload\?\.requestId/);
    assert.doesNotMatch(safeSuccessSummary, /requestId\s*:/);
  }
});

test("P2-88B bundled runner waits only for the two exact reply-waiting blockers", () => {
  const runnerSource = readFileSync(
    join(repoRoot, "scripts/p2-88b-affect-presentation-bundled-real-ui.mjs"),
    "utf8"
  );
  assert.match(runnerSource, /activeMainReason/);
  assert.match(runnerSource, /localBusyReason/);
  assert.match(runnerSource, /"chat_reply_waiting"/);
  assert.match(runnerSource, /"state_local_model_busy"/);
  assert.match(runnerSource, /deferredAfterWaitingTerminal/);
  assert.match(runnerSource, /gateAllowed \|\| deferredAfterWaitingTerminal/);
  assert.doesNotMatch(runnerSource, /gate\.payload\?\.reason === "presentation_busy"\s*\)\s*\{/);
});

test("P2-91C1 bundled runner accepts only the exact validated embedded provider status", () => {
  const validation = { ok: true, alias: "qwen3.5-2b-q4_k_m" };
  const exact = {
    providerId: "local-openai-compatible",
    model: validation.alias,
    isFallback: false
  };

  assert.equal(isExactBundledProviderStatus(exact, validation), true);
  assert.equal(isExactBundledProviderStatus(null, validation), false);
  assert.equal(isExactBundledProviderStatus({}, validation), false);
  assert.equal(isExactBundledProviderStatus({ ...exact, providerId: "fake" }, validation), false);
  assert.equal(isExactBundledProviderStatus({ ...exact, model: "other-model" }, validation), false);
  assert.equal(isExactBundledProviderStatus({ ...exact, isFallback: true }, validation), false);
  assert.equal(isExactBundledProviderStatus({ ...exact, isFallback: undefined }, validation), false);
  assert.equal(isExactBundledProviderStatus(exact, { ok: false, alias: validation.alias }), false);
  assert.equal(isExactBundledProviderStatus(exact, { ok: true }), false);

  const legacyTelemetryOnly = {
    bundled_llama_cpp_runtime_status: { status: "ready" },
    bundled_llama_cpp_provider_handoff: {
      providerId: exact.providerId,
      alias: exact.model,
      isFallback: false
    }
  };
  assert.equal(isExactBundledProviderStatus(legacyTelemetryOnly, validation), false);
});

test("P2-91C1 bundled runner never scans persistent runtime or handoff payloads", () => {
  const runnerSource = readFileSync(
    join(repoRoot, "scripts/p2-88b-affect-presentation-bundled-real-ui.mjs"),
    "utf8"
  );

  for (const forbidden of [
    "readPersistentTelemetry",
    "waitForEmbeddedRuntime",
    "bundled_llama_cpp_runtime_status",
    "bundled_llama_cpp_provider_handoff"
  ]) {
    assert.doesNotMatch(runnerSource, new RegExp(forbidden));
  }
  assert.match(runnerSource, /waitForEmbeddedProvider\(chat, validation\)/);
  assert.match(runnerSource, /provider\.model === validation\.alias/);
  assert.match(runnerSource, /readAcceptanceEvidenceForContext\(context, "p2-88b"\)/);

  const providerStatusIndex = runnerSource.indexOf("waitForEmbeddedProvider(chat, validation)");
  const firstFixtureIndex = runnerSource.indexOf("await sendMessage(chat, FIXTURE_MESSAGE);");
  assert.ok(providerStatusIndex >= 0);
  assert.ok(firstFixtureIndex > providerStatusIndex);
});

test("P2-91C1 bundled runner orders exact provider handoff, initial idle, then first fixture", () => {
  const runnerSource = readFileSync(
    join(repoRoot, "scripts/p2-88b-affect-presentation-bundled-real-ui.mjs"),
    "utf8"
  );
  const hasOrderedGate = (source: string) => {
    const providerStatus = source.indexOf("await waitForEmbeddedProvider(chat, validation);");
    const initialIdle = source.indexOf('context.p288Stage = "initial_idle";');
    const idleSuccess = source.indexOf("await waitForActionIdle(context, 12_000);");
    const firstSend = source.indexOf("await sendMessage(chat, FIXTURE_MESSAGE);");
    return providerStatus >= 0 &&
      initialIdle > providerStatus &&
      idleSuccess > initialIdle &&
      firstSend > idleSuccess;
  };

  assert.equal(hasOrderedGate(runnerSource), true);
  assert.equal(hasOrderedGate(runnerSource.replace('context.p288Stage = "initial_idle";', "")), false);
  assert.equal(hasOrderedGate(runnerSource.replace("waitForActionIdle(context, 12_000)", "waitForActionIdle(context, 11_999)")), false);
  assert.equal(
    hasOrderedGate(runnerSource.replace(
      "await waitForActionIdle(context, 12_000);",
      "void 0;"
    )),
    false
  );
});

test("P2-91C1 first bundled generic reply needs one start and one matching finished terminal", () => {
  const requestId = "0123456789abcdef0123456789abcdef";
  const started = {
    type: "pet_interaction_action_started",
    payload: { reason: "chat_reply_completed", requestId }
  };
  const finished = {
    type: "pet_interaction_action_finished",
    payload: { reason: "chat_reply_completed", requestId, terminalStatus: "completed" }
  };
  const skipped = {
    type: "pet_interaction_action_skipped",
    payload: { reason: "chat_reply_completed", requestId, skipReason: "global_cooldown" }
  };

  assert.equal(hasExactFirstGenericReplyLifecycle([started, finished]), true);
  assert.equal(hasExactFirstGenericReplyLifecycle([skipped]), false);
  assert.equal(hasExactFirstGenericReplyLifecycle([started, skipped]), false);
  assert.equal(hasExactFirstGenericReplyLifecycle([finished]), false);
  assert.equal(hasExactFirstGenericReplyLifecycle([started]), false);
  assert.equal(hasExactFirstGenericReplyLifecycle([started, finished, finished]), false);
  assert.equal(hasExactFirstGenericReplyLifecycle([started, { ...finished, payload: { ...finished.payload, requestId: "fedcba9876543210fedcba9876543210" } }]), false);
});

test("P2-91C1 bundled first-reply diagnostic projects strict evidence into bounded aggregate tuples", () => {
  const requestId = "0123456789abcdef0123456789abcdef";
  const events = [
    {
      runId: "12345678-1234-4123-8123-123456789abc",
      suite: "p2-88b",
      type: "pet_interaction_action_started",
      payload: { actionType: "softSmile", reason: "chat_reply_completed", requestId }
    },
    {
      runId: "12345678-1234-4123-8123-123456789abc",
      suite: "p2-88b",
      type: "pet_interaction_action_started",
      payload: { actionType: "softSmile", reason: "chat_reply_completed", requestId }
    },
    {
      runId: "12345678-1234-4123-8123-123456789abc",
      suite: "p2-88b",
      type: "dialogue_affect_action_dispatch",
      payload: { status: "accepted", reason: "accepted", requestId }
    }
  ];

  const snapshot = createBundledFirstLifecycleSnapshot({
    fileExists: true,
    events,
    firstStart: 1
  });

  assert.deepEqual(snapshot, {
    fileExists: true,
    parsedCount: 3,
    sinceStartCount: 2,
    events: [
      { type: "dialogue_affect_action_dispatch", status: "accepted", reason: "accepted", count: 1 },
      { type: "pet_interaction_action_started", actionType: "softSmile", reason: "chat_reply_completed", count: 1 }
    ]
  });
  assert.doesNotMatch(JSON.stringify(snapshot), /0123456789abcdef|runId|suite|body|path|model|host|raw|timestamp/u);
});

test("P2-91C1 bundled first-reply diagnostic stays a closed failure classifier", () => {
  const genericStarted = {
    type: "pet_interaction_action_started",
    payload: { actionType: "softSmile", reason: "chat_reply_completed", requestId: "0123456789abcdef0123456789abcdef" }
  };
  const acceptedDispatch = {
    type: "dialogue_affect_action_dispatch",
    payload: { status: "accepted", reason: "accepted", requestId: "0123456789abcdef0123456789abcdef" }
  };
  const allowGate = {
    type: "p2_88b_affect_reply_action_gate",
    payload: { decision: "allow", reason: "allowed", activeMainReason: null, localBusyReason: null }
  };
  const snapshot = createBundledFirstLifecycleSnapshot({ fileExists: true, events: [], firstStart: 0 });

  assert.deepEqual(createBundledFirstLifecycleDiagnostic({ replyUiCompleted: false }), {
    classification: "reply_incomplete"
  });
  assert.equal(createBundledFirstLifecycleDiagnostic({ replyUiCompleted: true, events: [], atReplyDone: snapshot, atTimeout: snapshot }).classification, "gate_absent");
  assert.equal(createBundledFirstLifecycleDiagnostic({
    replyUiCompleted: true,
    events: [{
      type: "pet_interaction_action_skipped",
      payload: {
        actionType: "replyWarmSettle",
        reason: "chat_reply_completed",
        skipReason: "global_cooldown",
        requestId: "0123456789abcdef0123456789abcdef"
      }
    }],
    atReplyDone: snapshot,
    atTimeout: snapshot
  }).classification, "skipped_global_cooldown");
  assert.equal(createBundledFirstLifecycleDiagnostic({
    replyUiCompleted: true,
    events: [{ ...allowGate, payload: { ...allowGate.payload, decision: "suppress", reason: "presentation_busy" } }],
    atReplyDone: snapshot,
    atTimeout: snapshot
  }).classification, "presentation_busy");
  assert.equal(createBundledFirstLifecycleDiagnostic({
    replyUiCompleted: true,
    events: [{ ...allowGate, payload: { ...allowGate.payload, decision: "suppress", reason: "allowed" } }],
    atReplyDone: snapshot,
    atTimeout: snapshot
  }).classification, "non_warm");
  assert.deepEqual(createBundledFirstLifecycleDiagnostic({
    replyUiCompleted: true,
    events: [allowGate, acceptedDispatch, genericStarted],
    atReplyDone: snapshot,
    atTimeout: snapshot
  }), {
    classification: "mapping_gap",
    atReplyDone: snapshot,
    atTimeout: snapshot
  });
  assert.throws(() => createBundledFirstLifecycleDiagnostic({ replyUiCompleted: true, events: [allowGate] }));
});

test("P2-91C1 bundled first-reply diagnostic rejects extra, raw, and non-enum output fields", () => {
  const exact = {
    classification: "gate_absent",
    atReplyDone: {
      fileExists: false,
      parsedCount: 0,
      sinceStartCount: 0,
      events: []
    },
    atTimeout: {
      fileExists: false,
      parsedCount: 0,
      sinceStartCount: 0,
      events: []
    }
  };
  assert.equal(isSafeBundledFirstLifecycleDiagnostic(exact), true);
  for (const mutation of [
    { ...exact, requestId: "0123456789abcdef0123456789abcdef" },
    { ...exact, atReplyDone: { ...exact.atReplyDone, path: "C:\\secret" } },
    { ...exact, atTimeout: { ...exact.atTimeout, events: [{ type: "unknown", count: 1 }] } },
    { ...exact, atTimeout: { ...exact.atTimeout, events: [{ type: "pet_interaction_action_started", actionType: "bad", count: 1 }] } }
  ]) {
    assert.equal(isSafeBundledFirstLifecycleDiagnostic(mutation), false);
  }
});

test("P2-91C1 bundled first-reply diagnostic starts at reply completion and never resets its 15-second deadline", () => {
  const runnerSource = readFileSync(
    join(repoRoot, "scripts/p2-88b-affect-presentation-bundled-real-ui.mjs"),
    "utf8"
  );
  const firstStart = runnerSource.indexOf("const firstStart = readTelemetry(context).length;");
  const firstSend = runnerSource.indexOf("await sendMessage(chat, FIXTURE_MESSAGE);", firstStart);
  const replyDone = runnerSource.indexOf("replyUiCompleted = true;", firstSend);
  const firstLifecycle = runnerSource.indexOf("await waitForFirstReplyCompletionActionIdle(context, firstStart);", replyDone);
  const lifecycleStart = runnerSource.indexOf("async function waitForFirstReplyCompletionActionIdle");
  const atReplyDone = runnerSource.indexOf("const atReplyDone = readBundledFirstLifecycleSnapshot(context, startIndex);", lifecycleStart);
  const deadline = runnerSource.indexOf("Date.now() + FIRST_GENERIC_LIFECYCLE_TIMEOUT_MS", atReplyDone);
  const atTimeout = runnerSource.indexOf("const atTimeout = readBundledFirstLifecycleSnapshot(context, startIndex);", deadline);
  const functionEnd = runnerSource.indexOf("export function createBundledFirstLifecycleSnapshot", lifecycleStart);

  assert.ok(firstStart >= 0 && firstSend > firstStart && replyDone > firstSend && firstLifecycle > replyDone);
  assert.ok(atReplyDone > lifecycleStart && deadline > atReplyDone && atTimeout > deadline);
  assert.match(runnerSource, /FIRST_GENERIC_LIFECYCLE_TIMEOUT_MS = 15_000/u);
  assert.doesNotMatch(runnerSource.slice(lifecycleStart, functionEnd), /RUNTIME_TIMEOUT_MS/u);
  assert.equal((runnerSource.slice(lifecycleStart, functionEnd).match(/Date\.now\(\) \+ FIRST_GENERIC_LIFECYCLE_TIMEOUT_MS/gu) ?? []).length, 1);
});

test("P2-88B bundled runner makes the second fixture eligible after the first exact reply terminal and idle", () => {
  const runnerSource = readFileSync(
    join(repoRoot, "scripts/p2-88b-affect-presentation-bundled-real-ui.mjs"),
    "utf8"
  );
  const firstFixture = runnerSource.indexOf("await sendMessage(chat, FIXTURE_MESSAGE);", runnerSource.indexOf('context.p288Stage = "first_fixture"'));
  const firstIdle = runnerSource.indexOf("waitForFirstReplyCompletionActionIdle(context, firstStart)", firstFixture);
  const secondStart = runnerSource.indexOf("const secondStart = readTelemetry(context).length;", firstFixture);
  assert.ok(firstFixture >= 0);
  assert.ok(firstIdle > firstFixture);
  assert.ok(secondStart > firstIdle);
  assert.match(runnerSource, /isStarted\(event, "chat_reply_completed"\)/);
  assert.match(runnerSource, /event\.payload\?\.reason === "chat_reply_completed"/);
  assert.match(runnerSource, /async function waitForActionIdle/);
  assert.match(runnerSource, /function activeActionIds/);
  assert.doesNotMatch(runnerSource, /activeMainReason === "chat_reply_completed"/);
});

test("P2-88B real-UI runners clear their deadline timer on both success and failure paths", () => {
  for (const runnerName of [
    "p2-88b-affect-presentation-real-ui.mjs",
    "p2-88b-affect-presentation-bundled-real-ui.mjs"
  ]) {
    const runnerSource = readFileSync(join(repoRoot, "scripts", runnerName), "utf8");
    assert.match(runnerSource, /import \{ runWithRealUiDeadline \} from "\.\/support\/real-ui-run-deadline\.mjs"/);
    assert.match(runnerSource, /await runWithRealUiDeadline\(\(\) => run\(context/);
    assert.doesNotMatch(runnerSource, /Promise\.race\(\[\s*run\(context/);
  }
});

test("P2-88B visual evidence is pet-only, lifecycle-bound, pixel-guarded, and finally deleted", () => {
  const supportSource = readFileSync(
    join(repoRoot, "scripts/support/p2-88b-pet-only-visual-evidence.mjs"),
    "utf8"
  );
  assert.match(supportSource, /waitForVisibleRendererFrame/);
  assert.match(supportSource, /PET_VISIBLE_BASELINE_TIMEOUT_MS = 12_000/);
  assert.match(supportSource, /PET_VISIBLE_BASELINE_POLL_INTERVAL_MS = 150/);
  assert.match(supportSource, /maxOuterAttempts/);
  assert.match(supportSource, /baselineObservation/);
  assert.match(supportSource, /captureVisiblePageFrame/);
  assert.match(supportSource, /Page\.captureScreenshot/);
  assert.match(supportSource, /pet-idle-250ms\.png/);
  assert.match(supportSource, /pet-idle-750ms\.png/);
  assert.match(supportSource, /hasExactTerminal\(\)/);
  assert.match(supportSource, /VISUAL_REVIEW_TIMEOUT_MS = 120_000/);
  assert.match(supportSource, /review-ready/);
  assert.match(supportSource, /review-approve/);
  assert.match(supportSource, /review-reject/);
  assert.match(supportSource, /visual_review_timeout/);
  assert.match(supportSource, /AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY/);
  assert.match(supportSource, /AI_DESKTOP_PET_P2_88B_SAFE_FIXTURE/);
  assert.match(supportSource, /AI_DESKTOP_PET_P2_88B_VISUAL_REVIEW_HANDSHAKE/);
  assert.match(supportSource, /rmSync\(visualDir, \{ recursive: true, force: true \}\)/);
  assert.doesNotMatch(supportSource, /chat|captureBeyondViewport:\s*true|Input\.dispatchMouseEvent|process\.stdout|console\.log/);

  for (const runnerName of [
    "p2-88b-affect-presentation-real-ui.mjs",
    "p2-88b-affect-presentation-bundled-real-ui.mjs"
  ]) {
    const runnerSource = readFileSync(join(repoRoot, "scripts", runnerName), "utf8");
    const readyIndex = runnerSource.indexOf("PET_RENDERER_READY_EXPRESSION");
    const appearanceIndex = runnerSource.indexOf("waitForStartupAppearanceFinished(context, 12_000)");
    const baselineIndex = runnerSource.indexOf("waitForPetVisibleBaseline(pet, {");
    const startedIndex = runnerSource.indexOf('context.p288Stage = "state_idle_started"');
    const captureIndex = runnerSource.indexOf("capturePetOnlyStateIdleVisualEvidence", startedIndex);
    const terminalIndex = runnerSource.indexOf('context.p288Stage = "state_idle_terminal"');
    assert.ok(readyIndex >= 0);
    assert.ok(appearanceIndex > readyIndex);
    assert.ok(baselineIndex > appearanceIndex);
    assert.ok(baselineIndex >= 0);
    assert.ok(startedIndex >= 0);
    assert.ok(captureIndex > startedIndex);
    assert.ok(captureIndex < terminalIndex);
    assert.match(runnerSource, /AI_DESKTOP_PET_P2_88B_VISUAL_REVIEW_HANDSHAKE/);
    assert.match(runnerSource, /waitForPetOnlyVisualReview\(context\)/);
    assert.match(runnerSource, /humanVisualReviewConfirmed/);
    assert.match(runnerSource, /cleanupPetOnlyVisualEvidence\(context\)/);
    assert.match(runnerSource, /baselineRendererContextLost/);
    assert.match(runnerSource, /baselineRendererVisiblePixels/);
    assert.match(runnerSource, /baselinePngVisiblePixels/);
    assert.match(runnerSource, /baselineProbeAttempts/);
    assert.match(runnerSource, /baselineCanvasWidth/);
    assert.match(runnerSource, /baselineCanvasHeight/);
    assert.match(runnerSource, /baselineCanvasSizeNonZero/);
    assert.match(runnerSource, /pet_interaction_action_finished/);
    assert.match(runnerSource, /payload\?\.actionType === "appearance"/);
    assert.doesNotMatch(runnerSource, /Page\.captureScreenshot|captureScreenshot\(chat|capturePetOnlyStateIdleVisualEvidence\(\{\s*pet:\s*chat/);
  }
});

test("P2-91C1 P2-88B runners use strict run evidence and verify whole-parent cleanup", () => {
  for (const runnerName of [
    "p2-88b-affect-presentation-real-ui.mjs",
    "p2-88b-affect-presentation-bundled-real-ui.mjs"
  ]) {
    const runnerSource = readFileSync(join(repoRoot, "scripts", runnerName), "utf8");
    assert.match(runnerSource, /readAcceptanceEvidenceForContext\(context, "p2-88b"\)/u);
    assert.match(runnerSource, /assertRealUiRunParentRemoved\(context\)/u);
    assert.match(runnerSource, /cleanupRealUiRun\(context\)/u);
    assert.doesNotMatch(runnerSource, /AI_DESKTOP_PET_ACCEPTANCE_EVIDENCE_(?:PATH|DIR|FILE)/u);
  }
});
