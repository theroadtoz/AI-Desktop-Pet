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
  assert.match(scheduleSource, /replyCompletionAffectRetryScheduler\.schedule\(\(\) =>/);
  assert.doesNotMatch(scheduleSource, /setTimeout|clearTimeout|trackAccepted|delete lastPetActionTriggerAtByReason|PET_ACTION_TRIGGER_SAME_REASON_THROTTLE_MS\s*=/);
  assert.match(appSource, /function cancelReplyCompletionAffectAction\(\): void \{[\s\S]*replyCompletionAffectRetryScheduler\.cancel\(\);/);
});

test("P2-88B new request, hide, reset, disable, and quiesce share retry cancellation", () => {
  const appSource = readFileSync(join(repoRoot, "src/main/app.ts"), "utf8");
  for (const marker of [
    "petActionDispatchCoordinator?.reset();",
    "function handleChatWindowInactive(): void",
    'transitionPetRole({ type: "request:started", requestVersion: request.requestVersion })',
    "currentDialogueAffectSettings = dialogueAffectSettingsStore.saveSettings(update);",
    "function quiesceApp(): void"
  ]) {
    const start = appSource.indexOf(marker);
    assert.notEqual(start, -1, marker);
    assert.match(appSource.slice(start, start + 650), /cancelReplyCompletionAffectAction\(\)/, marker);
  }
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

test("P2-88B bundled runner makes the second fixture eligible after the first exact reply terminal and idle", () => {
  const runnerSource = readFileSync(
    join(repoRoot, "scripts/p2-88b-affect-presentation-bundled-real-ui.mjs"),
    "utf8"
  );
  const firstFixture = runnerSource.indexOf("await sendMessage(chat, FIXTURE_MESSAGE);", runnerSource.indexOf('context.p288Stage = "first_fixture"'));
  const firstIdle = runnerSource.indexOf("waitForFirstReplyCompletionActionIdle(context, firstStart, RUNTIME_TIMEOUT_MS)", firstFixture);
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
    assert.match(runnerSource, /payload\?\.type === "appearance"/);
    assert.doesNotMatch(runnerSource, /Page\.captureScreenshot|captureScreenshot\(chat|capturePetOnlyStateIdleVisualEvidence\(\{\s*pet:\s*chat/);
  }
});
