import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  emotionIntensities,
  emotionTags,
  selectEmotionPresentation,
  type EmotionPresentation
} from "../src/shared/emotion.ts";
import {
  affectDialogueIntensities,
  affectDialogueStates,
  canStartAttentionMicroCue,
  canStartAttentionMicroCueSafely,
  getEmotionPresentationReachability,
  getXitaPresentationReachability,
  isAttentionMicroCueRolloutEnabled,
  resolveAffectTerminalPresentationIntent,
  selectAffectPresentationCrosswalk
} from "../src/main/services/affect/affect-presentation-crosswalk.ts";
import { resolveAffectDialoguePresentation } from "../src/main/services/affect/affect-dialogue-presentation-resolver.ts";
import { createXitaAffectCoordinator } from "../src/main/services/affect/xita-affect-coordinator.ts";
import { AFFECT_CONFIDENCE_LEVELS, USER_AFFECT_KINDS } from "../src/shared/companion-affect.ts";
import {
  INITIAL_PET_ROLE_SNAPSHOT,
  reducePetRoleState
} from "../src/shared/pet-role-state.ts";

const neutral: EmotionPresentation = { emotion: "neutral", intensity: "low", mode: "neutral" };

test("P2-91B exhaustively characterizes all 18 EmotionTag presentations", () => {
  const rows = emotionTags.flatMap((emotion) => emotionIntensities.map((intensity) => ({
    emotion,
    intensity,
    presentation: selectEmotionPresentation({ emotion, intensity })
  })));

  assert.equal(rows.length, 18);
  for (const row of rows) {
    const expectedMode = row.emotion === "neutral"
      ? "neutral"
      : row.intensity === "high" && row.emotion !== "confused"
        ? "emphasis"
        : "micro";
    assert.equal(row.presentation.mode, expectedMode, `${row.emotion}/${row.intensity}`);
    assert.match(
      getEmotionPresentationReachability(row.emotion, row.intensity),
      /^(?:reachable|intentional-fallback)$/
    );
  }
});

test("P2-91B exhaustively characterizes all 24 XitaAffect presentations", () => {
  const expectedReachability = {
    calm: ["reachable", "reachable", "intentional-fallback"],
    happy: ["reachable", "reachable", "intentional-fallback"],
    concerned: ["reachable", "reachable", "intentional-fallback"],
    serious: ["reachable", "reachable", "intentional-fallback"],
    curious: ["intentional-fallback", "intentional-fallback", "intentional-fallback"],
    playful: ["intentional-fallback", "intentional-fallback", "intentional-fallback"],
    embarrassed: ["intentional-fallback", "intentional-fallback", "intentional-fallback"],
    sleepy: ["environment-conditional", "environment-conditional", "intentional-fallback"]
  } as const;
  const rows = affectDialogueStates.flatMap((state) => affectDialogueIntensities.map((intensity) => ({
    state,
    intensity,
    resolution: resolveAffectDialoguePresentation({ state, intensity })
  })));

  assert.equal(rows.length, 24);
  for (const row of rows) {
    const { state, intensity, resolution } = row;
    assert.equal(
      getXitaPresentationReachability(state, intensity),
      expectedReachability[state][affectDialogueIntensities.indexOf(intensity)],
      `${state}/${intensity} reachability`
    );
    if (intensity === "high") {
      assert.equal(resolution.replyAction, "suppressed", `${state}/${intensity}`);
      assert.equal(resolution.action, null, `${state}/${intensity}`);
      continue;
    }

    if (state === "calm") {
      assert.equal(resolution.replyAction, "generic", `${state}/${intensity}`);
    } else if (state === "happy") {
      assert.equal(resolution.expression.emotion, "happy", `${state}/${intensity}`);
      assert.equal(resolution.action?.reason ?? null, intensity === "medium" ? "state_idle" : null);
    } else if (state === "concerned") {
      assert.equal(resolution.action?.reason, "state_listen", `${state}/${intensity}`);
    } else if (state === "serious") {
      assert.equal(resolution.action?.reason, "state_think", `${state}/${intensity}`);
    } else {
      assert.deepEqual(resolution, { expression: neutral, action: null, replyAction: "suppressed" });
    }
  }
});

test("P2-91B exhaustively characterizes all 21 UserAffect explicit crosswalk cells", () => {
  const expectedState = {
    unknown: "calm",
    calm: "calm",
    positive: "happy",
    excited: "happy",
    low: "concerned",
    tense: "serious",
    tired: "concerned"
  } as const;
  const rows = USER_AFFECT_KINDS.flatMap((kind) => AFFECT_CONFIDENCE_LEVELS.map((confidence) => {
    const coordinator = createXitaAffectCoordinator({ now: () => 1_000 });
    return {
      kind,
      confidence,
      snapshot: coordinator.applyUserAffect({ kind, confidence, source: "explicit-text", observedAtMs: 1_000 })
    };
  }));

  assert.equal(rows.length, 21);
  for (const { kind, confidence, snapshot } of rows) {
    assert.equal(snapshot.state, expectedState[kind], `${kind}/${confidence}`);
    assert.equal(
      snapshot.intensity,
      kind === "unknown" || kind === "calm" ? "low" : confidence,
      `${kind}/${confidence}`
    );
  }
  assert.equal(rows.some((row) => row.kind === "tired" && row.snapshot.state === "sleepy"), false);
});

test("P2-91B sleepy presentation requires environment sleep eligibility", () => {
  for (const intensity of ["low", "medium"] as const) {
    assert.deepEqual(
      resolveAffectDialoguePresentation({ state: "sleepy", intensity, isSleepEligible: true }),
      { expression: neutral, action: { reason: "state_sleep" }, replyAction: "affect" }
    );
    assert.deepEqual(
      resolveAffectDialoguePresentation({ state: "sleepy", intensity, isSleepEligible: false }),
      { expression: neutral, action: null, replyAction: "suppressed" }
    );
  }
  assert.equal(
    resolveAffectDialoguePresentation({ state: "sleepy", intensity: "high", isSleepEligible: true }).action,
    null
  );
});

test("P2-91B selects exactly one primary presentation with action then EmotionTag then Xita priority", () => {
  const emotion: EmotionPresentation = { emotion: "sad", intensity: "medium", mode: "micro" };
  const xita = resolveAffectDialoguePresentation({ state: "happy", intensity: "low" });

  const action = selectAffectPresentationCrosswalk({
    acceptedAction: { reason: "state_listen" },
    emotion,
    xita
  });
  assert.deepEqual(action, { kind: "action", reason: "state_listen" });
  assert.equal("expression" in action, false);

  const tagged = selectAffectPresentationCrosswalk({ acceptedAction: null, emotion, xita });
  assert.deepEqual(tagged, { kind: "expression", source: "emotion-tag", expression: emotion });

  const fallback = selectAffectPresentationCrosswalk({ acceptedAction: null, emotion: neutral, xita });
  assert.deepEqual(fallback, { kind: "expression", source: "xita-affect", expression: xita.expression });
  assert.deepEqual(
    selectAffectPresentationCrosswalk({ acceptedAction: null, actionPending: true, emotion, xita }),
    { kind: "none" }
  );
});

test("P2-91B production accepts or defers action before crosswalk then persists one terminal intent", () => {
  const app = readFileSync("src/main/app.ts", "utf8");
  const start = app.indexOf("const replyExpression = selectEmotionPresentation(result)");
  const end = app.indexOf('logTelemetry("chat_stream_completed"', start);
  const completion = app.slice(start, end);
  const terminalIndex = completion.indexOf('transitionPetRole({\n        type: "reply:completed"');
  const actionReasonIndex = completion.indexOf("resolveDialogueReplyActionReason(");
  const actionAttemptIndex = completion.indexOf("requestPetActionTriggerWithResult(dialogueReplyActionReason)");
  const crosswalkIndex = completion.indexOf("selectAffectPresentationCrosswalk({");
  const terminalPublishIndex = completion.indexOf("publishAffectTerminalPresentation(");

  assert.ok(terminalIndex >= 0);
  assert.match(completion.slice(terminalIndex, actionReasonIndex), /publish: false/);
  assert.ok(actionReasonIndex > terminalIndex);
  assert.ok(actionAttemptIndex > actionReasonIndex);
  assert.ok(crosswalkIndex > actionAttemptIndex);
  assert.ok(terminalPublishIndex > crosswalkIndex);
  assert.match(completion, /acceptedAction: acceptedActionReason \? \{ reason: acceptedActionReason \} : null/);
  assert.match(completion, /actionPending: deferredActionPending/);
  assert.match(
    completion,
    /currentPetPresentationIntent = publishAffectTerminalPresentation\([\s\S]*publishPetPresentation/
  );
});

test("P2-91B accepted rejected and deferred outcomes converge renderer persistence on the terminal role", () => {
  const started = reducePetRoleState(INITIAL_PET_ROLE_SNAPSHOT, { type: "chat:opened" });
  const thinking = reducePetRoleState(started.snapshot, { type: "request:started", requestVersion: 91 });
  const replying = reducePetRoleState(thinking.snapshot, { type: "reply:delta", requestVersion: 91 });
  const emotion: EmotionPresentation = { emotion: "happy", intensity: "medium", mode: "micro" };
  const terminal = reducePetRoleState(replying.snapshot, {
    type: "reply:completed",
    requestVersion: 91,
    expression: emotion
  });
  assert.equal(replying.intent.state, "replying");
  assert.equal(replying.intent.requestVersion, 91);
  assert.equal(terminal.intent.state, "listening");
  assert.equal(terminal.intent.requestVersion, null);

  const applyToRenderer = (
    intent: typeof terminal.intent,
    actionActive: boolean,
    acceptedMainPresentationCount: number
  ) => ({
    persistent: intent,
    visibleAfterApply: actionActive ? replying.intent.expression : intent.expression,
    acceptedMainPresentationCount: acceptedMainPresentationCount +
      Number(!actionActive && intent.expression.mode !== "neutral")
  });

  const acceptedPlan = selectAffectPresentationCrosswalk({
    acceptedAction: { reason: "state_listen" },
    emotion,
    xita: null
  });
  const acceptedTerminal = resolveAffectTerminalPresentationIntent(acceptedPlan, terminal.intent);
  assert.equal(acceptedTerminal.expression.mode, "neutral");
  assert.equal(acceptedTerminal.state, "listening");
  assert.equal(acceptedTerminal.requestVersion, null);
  const acceptedRenderer = applyToRenderer(acceptedTerminal, true, 1);
  assert.equal(acceptedRenderer.acceptedMainPresentationCount, 1);
  assert.equal(acceptedRenderer.persistent.requestVersion, null);
  assert.equal(acceptedRenderer.persistent.state, "listening");
  assert.deepEqual(acceptedRenderer.persistent.expression, acceptedTerminal.expression);

  const deferredPlan = selectAffectPresentationCrosswalk({
    acceptedAction: null,
    actionPending: true,
    emotion,
    xita: null
  });
  const deferredTerminal = resolveAffectTerminalPresentationIntent(deferredPlan, terminal.intent);
  assert.equal(deferredTerminal.expression.mode, "neutral");
  assert.equal(deferredTerminal.state, "listening");
  assert.equal(deferredTerminal.requestVersion, null);
  const deferredRenderer = applyToRenderer(deferredTerminal, true, 0);
  assert.equal(deferredRenderer.acceptedMainPresentationCount, 0);
  assert.equal(deferredRenderer.persistent.requestVersion, null);
  assert.equal(deferredRenderer.persistent.state, "listening");
  assert.equal(deferredRenderer.persistent.expression.mode, "neutral");

  const rejectedPlan = selectAffectPresentationCrosswalk({
    acceptedAction: null,
    emotion,
    xita: null
  });
  const rejectedTerminal = resolveAffectTerminalPresentationIntent(rejectedPlan, terminal.intent);
  assert.deepEqual(rejectedTerminal.expression, emotion);
  assert.equal(rejectedTerminal.state, "listening");
  assert.equal(rejectedTerminal.requestVersion, null);
  const rejectedRenderer = applyToRenderer(rejectedTerminal, false, 0);
  assert.equal(rejectedRenderer.acceptedMainPresentationCount, 1);
  assert.equal(rejectedRenderer.persistent.requestVersion, null);
  assert.equal(rejectedRenderer.persistent.state, "listening");
  assert.deepEqual(rejectedRenderer.visibleAfterApply, emotion);
});

test("P2-91B cue rollout is default-on and illegal values fail closed", () => {
  assert.equal(isAttentionMicroCueRolloutEnabled(undefined), true);
  assert.equal(isAttentionMicroCueRolloutEnabled("1"), true);
  assert.equal(isAttentionMicroCueRolloutEnabled("0"), false);
  for (const value of ["", "true", "yes", "2"]) {
    assert.equal(isAttentionMicroCueRolloutEnabled(value), false, value);
  }
});

test("P2-91B cue requires every main-side readiness and ownership gate", () => {
  const ready = {
    rolloutEnabled: true,
    affectEnabled: true,
    petReady: true,
    petVisible: true,
    presentationBusy: false
  } as const;
  assert.equal(canStartAttentionMicroCue(ready), true);
  for (const key of Object.keys(ready) as Array<keyof typeof ready>) {
    const blockedValue = key === "presentationBusy";
    assert.equal(canStartAttentionMicroCue({ ...ready, [key]: blockedValue }), false, key);
  }
});

test("P2-91B cue gate fails closed when any main-side dependency getter throws", () => {
  assert.equal(canStartAttentionMicroCueSafely(() => { throw new Error("getter failed"); }), false);
  assert.equal(canStartAttentionMicroCueSafely(() => ({
    rolloutEnabled: true,
    affectEnabled: true,
    petReady: true,
    petVisible: true,
    presentationBusy: false
  })), true);
});
