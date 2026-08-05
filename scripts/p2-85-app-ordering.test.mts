import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const appSource = readFileSync(join(repoRoot, "src/main/app.ts"), "utf8");
const genericControllerSource = readFileSync(
  join(repoRoot, "src/main/services/affect/reply-completion-affect-action-controller.ts"),
  "utf8"
);
const scenarioSource = readFileSync(
  join(repoRoot, "src/main/services/companion-context/p2-85-acceptance-scenarios.ts"),
  "utf8"
);

function functionBody(name: string, nextName: string): string {
  const start = appSource.indexOf(`function ${name}`);
  const end = appSource.indexOf(`function ${nextName}`, start);
  assert.notEqual(start, -1, `${name} must exist`);
  assert.notEqual(end, -1, `${nextName} must follow ${name}`);
  return appSource.slice(start, end);
}

test("P2-85 app ordering contracts remain explicit", () => {
  const openChat = functionBody("openChatWindow", "isPetSender");
  assert.doesNotMatch(openChat, /petActionDispatchCoordinator\?\.reset\(\)/);
  assert.match(openChat, /sendPetActionTrigger\("chat_opened", \{ supersessionPolicy: "replace_active" \}\)/);

  assert.match(scenarioSource, /function startChatOpenedReplaceActive\(\): P285AcceptanceScenarioStartResult/);
  assert.match(scenarioSource, /adapters\.openChatWindow\(\);/);
  assert.match(scenarioSource, /adapters\.getActiveMainRequest\(\)/);
  assert.match(scenarioSource, /replacement\.requestId === active\.requestId/);
  assert.match(scenarioSource, /adapters\.cancelAction\(\)/);
  assert.doesNotMatch(scenarioSource, /dispatch\(\s*"chat_opened"/);
  assert.match(appSource, /createP285AcceptanceScenarioController\(\{[\s\S]*openChatWindow,/);
  const acceptanceSetupStart = appSource.indexOf("p285AcceptanceScenarioController = createP285AcceptanceScenarioController({");
  const acceptanceSetupEnd = appSource.indexOf("if (pendingChatWindowOpen)", acceptanceSetupStart);
  assert.notEqual(acceptanceSetupStart, -1, "P2-85 acceptance setup must exist");
  assert.notEqual(acceptanceSetupEnd, -1, "P2-85 acceptance setup must close");
  const acceptanceSetup = appSource.slice(acceptanceSetupStart, acceptanceSetupEnd);
  const resetStart = acceptanceSetup.indexOf("async resetLiveBaseline() {");
  const resetEnd = acceptanceSetup.indexOf("clearProactiveCandidate()", resetStart);
  assert.notEqual(resetStart, -1, "reset baseline adapter must exist");
  assert.notEqual(resetEnd, -1, "reset baseline adapter must finish before candidate adapter");
  const reset = acceptanceSetup.slice(resetStart, resetEnd);
  const interactionReset = reset.indexOf("isChatInteractionActive = false;");
  const hideChatWindow = reset.indexOf("chatWindow?.hide();");
  const barrier = reset.indexOf("setImmediate(resolve)");
  const cancelActive = reset.indexOf("petActionDispatchCoordinator?.cancelActive();");
  const clearCandidate = reset.indexOf("proactiveBubbleCoordinator?.clear();");
  assert.ok(interactionReset >= 0, "reset must clear chat interaction state");
  assert.ok(
    interactionReset < hideChatWindow && hideChatWindow < barrier && barrier < cancelActive && cancelActive < clearCandidate,
    "reset must hide chat, wait for its event-loop acknowledgement, then clear active action and candidate"
  );
  assert.match(reset, /chatWindow\?\.once\("hide", resolve\);/u);
  assert.match(reset, /!petActionDispatchCoordinator\?\.getState\(\)\.busy/u);

  const presenceLifecycle = functionBody("syncAutomaticPresenceLifecycle", "applyAutomaticSituationSnapshot");
  assert.match(presenceLifecycle, /quietRequested:\s*false/);
  assert.doesNotMatch(presenceLifecycle, /currentProactiveCompanionSettings\.cadence/);

  const contextInput = functionBody("createCompanionContextArbitrationInput", "resolveDialogueReplyActionReason");
  assert.match(contextInput, /channel,/);
  assert.doesNotMatch(contextInput, /isPetLocked/);

  const replyActionReason = functionBody("resolveDialogueReplyActionReason", "syncAutomaticPresenceLifecycle");
  assert.match(replyActionReason, /createCompanionContextArbitrationInput\("affect-action"\)/);
  assert.doesNotMatch(replyActionReason, /createCompanionContextArbitrationInput\("reply-completion-action"\)/);
  assert.doesNotMatch(replyActionReason, /isPetLocked/);

  const hasGenericOwnershipAndOrdering = (source: string, controllerSource: string): boolean => {
    const replyScopeStart = source.indexOf("const replyExpression = selectEmotionPresentation(result);");
    const replyScopeEnd = source.indexOf('logTelemetry("chat_stream_completed")', replyScopeStart);
    const replyScope = source.slice(replyScopeStart, replyScopeEnd);
    const replyTerminal = replyScope.indexOf('type: "reply:completed"');
    const latestCompleted = replyScope.indexOf("latestCompletedChatRequestVersion = request.requestVersion;");
    const registration = replyScope.indexOf("replyCompletionAffectActionController.registerGenericCompletion({");
    const controllerOutcome = replyScope.indexOf('if (genericCompletion.status !== "ignored")');
    const terminalPublish = replyScope.indexOf("currentPetPresentationIntent = publishAffectTerminalPresentation(");

    const lifecycleScopeStart = source.indexOf('ipcMain.on("pet:telemetry"');
    const lifecycleScopeEnd = source.indexOf('ipcMain.on("chat:send"', lifecycleScopeStart);
    const lifecycleScope = source.slice(lifecycleScopeStart, lifecycleScopeEnd);
    const typedForwarding = lifecycleScope.indexOf("petActionDispatchCoordinator?.onLifecycle(");
    const genericConsume = lifecycleScope.indexOf("replyCompletionAffectActionController.handleGenericLifecycle({");
    const skippedOutcome = lifecycleScope.indexOf("replyCompletionAffectActionController.consumeGlobalCooldownSkip({");

    const liveSnapshotStart = source.indexOf("function readGenericReplyCompletionLiveSnapshot()");
    const liveSnapshotEnd = source.indexOf("function scheduleReplyCompletionAffectGlobalCooldownRetry", liveSnapshotStart);
    const liveSnapshot = source.slice(liveSnapshotStart, liveSnapshotEnd);
    const controllerRegistration = controllerSource.indexOf("registerGenericCompletion(input, adapters) {");
    const controllerLifecycle = controllerSource.indexOf("handleGenericLifecycle(lifecycle, adapters) {");

    return replyScopeStart >= 0 && replyScopeEnd > replyScopeStart &&
      replyTerminal >= 0 && replyTerminal < latestCompleted &&
      latestCompleted < registration && registration < controllerOutcome &&
      controllerOutcome < terminalPublish &&
      replyScope.includes('createCompanionContextArbitrationInput("reply-completion-action")') &&
      replyScope.includes("dispatch: dispatchGenericReplyCompletionAction") &&
      replyScope.includes("publish: publishPetPresentation") &&
      !replyScope.includes('input.arbitration.reason === "presentation_busy"') &&
      !replyScope.includes('requestPetActionTriggerWithResult("chat_reply_completed")') &&
      !replyScope.includes("publishAffectTerminalPresentation({ kind: \"none\" }") &&
      typedForwarding >= 0 && typedForwarding < genericConsume &&
      genericConsume < skippedOutcome &&
      lifecycleScope.includes("readSnapshot: readGenericReplyCompletionLiveSnapshot") &&
      lifecycleScope.includes("dispatch: dispatchGenericReplyCompletionAction") &&
      liveSnapshot.includes("latestCompletedRequestVersion: latestCompletedChatRequestVersion") &&
      liveSnapshot.includes("activeRequestVersion: activeChatRequestVersion") &&
      liveSnapshot.includes("hasActiveStream: chatEngine?.hasActiveStream() ?? false") &&
      liveSnapshot.includes('createCompanionContextArbitrationInput("reply-completion-action")') &&
      controllerRegistration >= 0 && controllerLifecycle > controllerRegistration &&
      controllerSource.includes("publishAffectTerminalPresentation(") &&
      controllerSource.includes('input.arbitration.reason === "presentation_busy"') &&
      controllerSource.includes('input.activeMainRequest.reason === "chat_reply_waiting"') &&
      controllerSource.includes('input.activeMainRequest.reason === "state_local_model_busy"') &&
      controllerSource.includes("pendingGeneric = null;") &&
      controllerSource.includes("snapshot = adapters.readSnapshot();") &&
      controllerSource.includes("snapshot.latestCompletedRequestVersion !== requestVersion") &&
      controllerSource.includes("snapshot.activeRequestVersion !== null") &&
      controllerSource.includes("snapshot.hasActiveStream") &&
      controllerSource.includes('snapshot.arbitration.decision !== "allow"') &&
      controllerSource.includes('replaceScheduledPurpose("generic_initial_settle"') &&
      controllerSource.includes('replaceScheduledPurpose("affect_cooldown_retry"') &&
      controllerSource.includes("adapters.dispatch()");
  };

  assert.equal(hasGenericOwnershipAndOrdering(appSource, genericControllerSource), true);
  assert.equal(hasGenericOwnershipAndOrdering(
    appSource.replace(
      "const genericDispatchState = petActionDispatchCoordinator?.getState();",
      'if (input.arbitration.reason === "presentation_busy") { pendingGeneric = true; }\n      const genericDispatchState = petActionDispatchCoordinator?.getState();'
    ),
    genericControllerSource
  ), false, "app-inline generic eligibility must fail");
  assert.equal(hasGenericOwnershipAndOrdering(
    appSource.replace(
      "latestCompletedChatRequestVersion = request.requestVersion;",
      ""
    ).replace(
      'if (genericCompletion.status !== "ignored")',
      'latestCompletedChatRequestVersion = request.requestVersion;\n      if (genericCompletion.status !== "ignored")'
    ),
    genericControllerSource
  ), false, "registration before latest-completed update must fail");
  assert.equal(hasGenericOwnershipAndOrdering(
    appSource.replace(
      "replyCompletionAffectActionController.registerGenericCompletion({",
      "removedGenericRegistration({"
    ),
    genericControllerSource
  ), false, "skipped registration delegation must fail");
  assert.equal(hasGenericOwnershipAndOrdering(
    appSource.replace(
      "replyCompletionAffectActionController.registerGenericCompletion({",
      "removedGenericRegistration({"
    ).replace(
      "currentPetPresentationIntent = genericCompletion.terminalIntent;",
      "currentPetPresentationIntent = genericCompletion.terminalIntent;\n        replyCompletionAffectActionController.registerGenericCompletion({});"
    ),
    genericControllerSource
  ), false, "registration after controller outcome handling must fail");
  assert.equal(hasGenericOwnershipAndOrdering(
    appSource.replace(
      "replyCompletionAffectActionController.handleGenericLifecycle({",
      "removedGenericLifecycle({"
    ).replace(
      "const lifecycleResult = typeof actionReason === \"string\"",
      "replyCompletionAffectActionController.handleGenericLifecycle({});\n      const lifecycleResult = typeof actionReason === \"string\""
    ),
    genericControllerSource
  ), false, "consume before typed lifecycle forwarding must fail");
  assert.equal(hasGenericOwnershipAndOrdering(
    appSource.replace(
      "replyCompletionAffectActionController.handleGenericLifecycle({",
      "removedGenericLifecycle({"
    ),
    genericControllerSource
  ), false, "skipped lifecycle delegation must fail");
  assert.equal(hasGenericOwnershipAndOrdering(
    appSource.replace(
      "replyCompletionAffectActionController.handleGenericLifecycle({",
      "removedGenericLifecycle({"
    ).replace(
      "p285AcceptanceScenarioController?.observeRendererActionLifecycle(",
      "replyCompletionAffectActionController.handleGenericLifecycle({});\n      p285AcceptanceScenarioController?.observeRendererActionLifecycle("
    ),
    genericControllerSource
  ), false, "consume after skip handling must fail");
  assert.equal(hasGenericOwnershipAndOrdering(
    appSource.replace(
      "const genericDispatchState = petActionDispatchCoordinator?.getState();",
      'requestPetActionTriggerWithResult("chat_reply_completed");\n      const genericDispatchState = petActionDispatchCoordinator?.getState();'
    ),
    genericControllerSource
  ), false, "app direct dispatch bypass must fail");
  assert.equal(hasGenericOwnershipAndOrdering(
    appSource.replace(
      "const genericDispatchState = petActionDispatchCoordinator?.getState();",
      'publishAffectTerminalPresentation({ kind: "none" });\n      const genericDispatchState = petActionDispatchCoordinator?.getState();'
    ),
    genericControllerSource
  ), false, "app direct terminal publish bypass must fail");
  assert.equal(hasGenericOwnershipAndOrdering(
    appSource,
    genericControllerSource.replaceAll("handleGenericLifecycle", "removedGenericLifecycle")
  ), false, "controller lifecycle owner removal must fail");

  const situation = functionBody("applyAutomaticSituationSnapshot", "cancelPendingModeActionStateTrigger");
  assert.equal(
    (situation.match(/selectPetActionStateForModeChange\(/g) ?? []).length,
    1,
    "mode action selection must happen once per changed snapshot"
  );
  assert.equal(
    (situation.match(/schedulePetModeActionStateTrigger\(/g) ?? []).length,
    1,
    "mode action scheduling must happen at most once per changed snapshot"
  );
  assert.match(situation, /petActionRuntimePolicy\.onDialogueModeChanged/);
  assert.match(situation, /publishPetPresentation\(currentPetPresentationIntent\)/);
  assert.match(situation, /petActionRuntimePolicy\.onPresenceModeChanged/);
  assert.match(situation, /previousPresenceStateId === "sleep" && currentPresenceModeId === "default"/);
  assert.match(situation, /cancelPendingModeActionStateTrigger\(\);\s*const actionState/);
  assert.ok(
    situation.indexOf("cancelPendingModeActionStateTrigger()") <
      situation.indexOf("resolveCompanionContextArbitration("),
    "an automatic mode decision must cancel a stale mode_presence timer first"
  );
  assert.match(situation, /if \(!isSynchronizingCoarseUserState\) \{\s*scheduleIdleProactiveSpeechBubble\(\);/);
  assert.match(situation, /if \(!isSynchronizingCoarseUserState\) \{\s*refreshProactiveBubbleRuntimeGates\(\);/);
});

test("P2-85 preserves the reset/hide/late-focus/reply ordering without a timing delay", () => {
  const handlerStart = appSource.indexOf('ipcMain.on("chat:interaction-active"');
  const handlerEnd = appSource.indexOf('ipcMain.on("pet:adjust-scale"', handlerStart);
  assert.notEqual(handlerStart, -1, "chat interaction handler must exist");
  assert.notEqual(handlerEnd, -1, "chat interaction handler must end before scale handler");
  const handler = appSource.slice(handlerStart, handlerEnd);
  const lateFocusGuard = handler.indexOf("if (isActive && !isChatVisible()) {");
  const focusDispatch = handler.indexOf('sendPetActionTrigger("chat_input_focus")');
  assert.ok(lateFocusGuard >= 0 && lateFocusGuard < focusDispatch);
  assert.match(handler.slice(lateFocusGuard, focusDispatch), /return;/);

  const scenarioStart = scenarioSource.indexOf("function startReplyVisibleGenericOnce");
  const scenarioEnd = scenarioSource.indexOf("function startExplicitGameSinglePresentation", scenarioStart);
  assert.notEqual(scenarioStart, -1, "reply scenario must exist");
  assert.notEqual(scenarioEnd, -1, "reply scenario must precede explicit game scenario");
  const scenario = scenarioSource.slice(scenarioStart, scenarioEnd);
  assert.match(scenario, /adapters\.dispatchAction\("chat_reply_completed"\)/);
  assert.doesNotMatch(scenario, /setTimeout|setImmediate|sleep/);
});

test("P2-85 synchronizes coarse state before one proactive refresh and tick schedule", () => {
  const listenerStart = appSource.indexOf("removeCoarseUserStateListener = coarseUserStateCoordinator.subscribe((state) => {");
  const listenerEnd = appSource.indexOf("removeDesktopContextSnapshotListener =", listenerStart);
  assert.notEqual(listenerStart, -1, "coarse listener must exist");
  assert.notEqual(listenerEnd, -1, "coarse listener must end before desktop subscription");
  const listener = appSource.slice(listenerStart, listenerEnd);

  assert.match(listener, /isSynchronizingCoarseUserState = true;/);
  assert.match(listener, /try \{[\s\S]*automaticSituationCoordinator\?\.updateExplicitGameContext[\s\S]*proactiveBubbleCoordinator\?\.updateCoarseState/);
  assert.match(listener, /finally \{\s*isSynchronizingCoarseUserState = false;\s*scheduleIdleProactiveSpeechBubble\(\);/);
  assert.equal(
    (listener.match(/scheduleIdleProactiveSpeechBubble\(/g) ?? []).length,
    1,
    "coarse listener must schedule proactive refresh and tick once after both updates"
  );
});
