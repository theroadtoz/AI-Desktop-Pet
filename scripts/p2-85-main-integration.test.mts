import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const appSource = readFileSync(join(repoRoot, "src/main/app.ts"), "utf8");

function functionBody(name: string, nextName: string): string {
  const start = appSource.indexOf(`function ${name}`);
  const end = appSource.indexOf(`function ${nextName}`, start);
  assert.notEqual(start, -1, `${name} must exist`);
  assert.notEqual(end, -1, `${nextName} must follow ${name}`);
  return appSource.slice(start, end);
}

test("P2-85 reply action resolution selects one intent before dispatch", () => {
  assert.match(appSource, /resolveCompanionContextArbitration/);

  const resolver = functionBody("resolveDialogueReplyActionReason", "syncAutomaticPresenceLifecycle");
  assert.match(resolver, /createCompanionContextArbitrationInput\("affect-action"\)/);
  assert.match(resolver, /createCompanionContextArbitrationInput\("reply-completion-action"\)/);
  assert.doesNotMatch(resolver, /requestPetActionTriggerWithResult|sendPetActionTrigger/);
  assert.match(resolver, /resolution\?\.action/);
  assert.match(resolver, /return resolution\.action\.reason/);
  assert.match(resolver, /return replyDecision\.decision === "allow" \? "chat_reply_completed" : null/);

  const completionStart = appSource.indexOf("const shouldRequestReplyWarmSettle =");
  const completionEnd = appSource.indexOf('logTelemetry("chat_stream_completed"', completionStart);
  const completion = appSource.slice(completionStart, completionEnd);
  assert.equal(
    (completion.match(/requestPetActionTriggerWithResult\(/g) ?? []).length,
    1,
    "reply completion must dispatch at most once"
  );
  assert.doesNotMatch(completion, /if \(!affectActionRequested\)/);
  assert.match(completion, /dialogueReplyActionReason === affectPresentation\?\.action\?\.reason/);
  assert.match(completion, /attempt\.coordinatorAttempted/);
});

test("P2-85 keeps chat-visible generic reply behavior while affect remains policy-gated", () => {
  const input = functionBody("createCompanionContextArbitrationInput", "resolveDialogueReplyActionReason");
  assert.match(input, /petRoleSnapshot\.chatOpen \|\| isChatVisible\(\)/);
  assert.match(input, /activeChatRequestVersion !== null \|\| Boolean\(chatEngine\?\.hasActiveStream\(\)\)/);

  const resolver = functionBody("resolveDialogueReplyActionReason", "syncAutomaticPresenceLifecycle");
  assert.match(resolver, /createCompanionContextArbitrationInput\("affect-action"\)/);
  assert.match(resolver, /createCompanionContextArbitrationInput\("reply-completion-action"\)/);
});

test("P2-85 affect band keeps low concern and disabled affect at default", () => {
  const affectBand = functionBody("getCompanionContextAffectBand", "createCompanionContextArbitrationInput");
  assert.match(affectBand, /if \(!currentDialogueAffectSettings\.enabled \|\| !affect\) return "default";/);
  assert.match(
    affectBand,
    /if \(affect\.intensity !== "low" && \(\s*affect\.state === "concerned" \|\| affect\.state === "serious"\s*\)\) \{\s*return "focused";/
  );
});

test("P2-85 ignores a late chat focus activation after the chat window is hidden", () => {
  const handlerStart = appSource.indexOf('ipcMain.on("chat:interaction-active"');
  const handlerEnd = appSource.indexOf('ipcMain.on("pet:adjust-scale"', handlerStart);
  assert.notEqual(handlerStart, -1, "chat interaction handler must exist");
  assert.notEqual(handlerEnd, -1, "chat interaction handler must end before scale handler");
  const handler = appSource.slice(handlerStart, handlerEnd);

  const hiddenGuard = 'if (isActive && !isChatVisible()) {';
  const guardStart = handler.indexOf(hiddenGuard);
  const focusDispatch = handler.indexOf('sendPetActionTrigger("chat_input_focus")');
  assert.notEqual(guardStart, -1, "hidden chat focus must have a guard");
  assert.ok(guardStart < focusDispatch, "hidden chat focus must be rejected before dispatch");
  assert.match(
    handler.slice(guardStart, focusDispatch),
    /isChatInteractionActive = false;[\s\S]*return;/,
    "late hidden focus must leave interaction inactive and return"
  );
  assert.match(
    handler,
    /if \(isActive\) \{[\s\S]*sendPetActionTrigger\("chat_input_focus"\);[\s\S]*\} else \{\s*scheduleIdleProactiveSpeechBubble\(\);/,
    "a normal false event must keep its existing cleanup path"
  );
});

test("P2-85 applies explicit-game automatic action suppression through the policy", () => {
  const situation = functionBody("applyAutomaticSituationSnapshot", "cancelPendingModeActionStateTrigger");
  assert.match(
    situation,
    /createCompanionContextArbitrationInput\("automatic-mode-action", snapshot\.conversationSource\)/
  );
  assert.match(situation, /automaticActionDecision\.decision === "allow"/);
  assert.equal(
    (situation.match(/schedulePetModeActionStateTrigger\(/g) ?? []).length,
    1,
    "automatic snapshots must still schedule no more than one action"
  );
});

test("P2-85 wires proactive candidate context gates to channels and settings", () => {
  const coordinatorOptions = appSource.slice(
    appSource.indexOf("proactiveBubbleCoordinator = createProactiveBubbleCoordinator({"),
    appSource.indexOf("proactiveBubbleCoordinator.updateSettings", appSource.indexOf("proactiveBubbleCoordinator = createProactiveBubbleCoordinator({"))
  );
  assert.match(coordinatorOptions, /resolveContextGate\(candidateId: ProactiveBubbleCandidateId\)/);
  assert.match(coordinatorOptions, /"proactive-source"/);
  assert.match(coordinatorOptions, /"proactive-silence"/);
  assert.match(coordinatorOptions, /"proactive-environment"/);
  assert.match(coordinatorOptions, /memorySourceBubbles/);
  assert.match(coordinatorOptions, /searchSourceBubbles/);
  assert.match(coordinatorOptions, /explicitGameContextEnabled/);
  assert.match(coordinatorOptions, /musicEnabled/);
  assert.match(coordinatorOptions, /basicEnabled/);
  assert.match(coordinatorOptions, /createCompanionContextArbitrationInput\(channel\)/);
  assert.match(coordinatorOptions, /relevantSourceEnabled,/);
  assert.match(coordinatorOptions, /environmentEnabled/);
});

test("P2-45 safe-active arbitration input overrides engagement only for the acceptance fixture", () => {
  const input = functionBody("createCompanionContextArbitrationInput", "resolveDialogueReplyActionReason");
  assert.match(
    input,
    /engagement: isP245AcceptanceSafeActive \? "allowed" : coarseState\?\.engagement \?\? "unknown"/
  );
  assert.match(input, /coarseState = coarseUserStateCoordinator\?\.getState\(\)/);
  assert.match(input, /dialogueMode: currentDialogueModeId/);
  assert.match(input, /presentationBusy: petActionDispatchCoordinator\?\.getState\(\)\.busy \?\? false/);
});
