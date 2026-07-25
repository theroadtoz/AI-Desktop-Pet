import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { resolveCompanionContextArbitration } = require(
  "../dist/main/services/companion-context/companion-context-arbitration-policy.js"
) as typeof import("../src/main/services/companion-context/companion-context-arbitration-policy");

function input(
  update: Partial<import("../src/main/services/companion-context/companion-context-arbitration-policy").CompanionContextArbitrationInput> = {}
) {
  return {
    channel: "proactive-source",
    lifecycle: "ready",
    interaction: "idle",
    engagement: "allowed",
    dialogueMode: "default",
    dialogueSource: "default",
    presenceMode: "default",
    affectBand: "default",
    presentationBusy: false,
    proactiveCadence: "normal",
    affectEnabled: true,
    relevantSourceEnabled: true,
    environmentEnabled: true,
    ...update
  } as const;
}

test("hard lifecycle gates are terminal and never replayed", () => {
  for (const [lifecycle, reason] of [
    ["unavailable", "lifecycle_unavailable"],
    ["system-locked", "lifecycle_system_locked"],
    ["suspended", "lifecycle_suspended"],
    ["sleep", "lifecycle_sleep"]
  ] as const) {
    assert.deepEqual(resolveCompanionContextArbitration(input({ lifecycle })), {
      decision: "suppress", reason, replay: "never", actionIntent: "none", priority: 0
    });
  }
});

test("chat suppresses only affect action while reply completion stays eligible", () => {
  assert.equal(
    resolveCompanionContextArbitration(input({ channel: "affect-action", interaction: "chat-visible" })).decision,
    "suppress"
  );
  assert.deepEqual(
    resolveCompanionContextArbitration(input({ channel: "reply-completion-action", interaction: "chat-visible" })),
    { decision: "allow", reason: "allowed", replay: "never", actionIntent: "reply-completion-action", priority: 30 }
  );
});

test("reply actions and affect actions never defer", () => {
  for (const channel of ["affect-action", "reply-completion-action"] as const) {
    const decision = resolveCompanionContextArbitration(input({ channel, interaction: "model-busy" }));
    assert.equal(decision.decision, "suppress");
    assert.equal(decision.replay, "never");
  }
});

test("generic reply completion is suppressed during dialogue or presence focus and never deferred", () => {
  for (const focusedContext of [
    { dialogueMode: "work" as const },
    { dialogueMode: "reading" as const },
    { presenceMode: "focus" as const }
  ]) {
    assert.deepEqual(
      resolveCompanionContextArbitration(input({
        channel: "reply-completion-action",
        interaction: "chat-visible",
        ...focusedContext
      })),
      {
        decision: "suppress",
        reason: "focus_suppressed",
        replay: "never",
        actionIntent: "none",
        priority: 0
      }
    );
  }
});

test("explicit user game leaves automatic presentation to the proactive candidate", () => {
  assert.deepEqual(
    resolveCompanionContextArbitration(input({
      channel: "automatic-mode-action", dialogueMode: "game", dialogueSource: "user-explicit"
    })),
    { decision: "suppress", reason: "explicit_game_proactive_owns_presentation", replay: "never", actionIntent: "none", priority: 0 }
  );
});

test("proactive off does not affect normal automatic mode action", () => {
  assert.equal(
    resolveCompanionContextArbitration(input({ channel: "proactive-environment", proactiveCadence: "off" })).reason,
    "proactive_off"
  );
  assert.equal(
    resolveCompanionContextArbitration(input({ channel: "automatic-mode-action", proactiveCadence: "off" })).decision,
    "allow"
  );
});

test("proactive source can reuse the one-shot close path for chat-visible or model-busy", () => {
  assert.deepEqual(
    resolveCompanionContextArbitration(input({ channel: "proactive-source", interaction: "chat-visible" })),
    { decision: "defer", reason: "chat_visible", replay: "existing-single-chat-close", actionIntent: "none", priority: 0 }
  );
  assert.deepEqual(
    resolveCompanionContextArbitration(input({ channel: "proactive-source", interaction: "model-busy" })),
    { decision: "defer", reason: "model_busy", replay: "existing-single-chat-close", actionIntent: "none", priority: 0 }
  );
});

test("model-busy suppresses every non-source proactive and action channel", () => {
  for (const channel of [
    "proactive-environment",
    "proactive-silence",
    "automatic-mode-action",
    "affect-action",
    "reply-completion-action"
  ] as const) {
    const decision = resolveCompanionContextArbitration(input({ channel, interaction: "model-busy" }));
    assert.equal(decision.decision, "suppress");
    assert.equal(decision.reason, "model_busy");
    assert.equal(decision.replay, "never");
  }
});

test("source blocked interaction defer outranks presentation busy without weakening other busy gates", () => {
  for (const [interaction, reason] of [
    ["model-busy", "model_busy"],
    ["chat-visible", "chat_visible"],
    ["user-active", "user_active"]
  ] as const) {
    assert.deepEqual(
      resolveCompanionContextArbitration(input({
        channel: "proactive-source",
        interaction,
        presentationBusy: true
      })),
      {
        decision: "defer",
        reason,
        replay: "existing-single-chat-close",
        actionIntent: "none",
        priority: 0
      }
    );
  }

  assert.deepEqual(
    resolveCompanionContextArbitration(input({
      channel: "proactive-source",
      interaction: "idle",
      presentationBusy: true
    })),
    {
      decision: "suppress",
      reason: "presentation_busy",
      replay: "never",
      actionIntent: "none",
      priority: 0
    }
  );

  for (const channel of [
    "proactive-environment",
    "proactive-silence",
    "automatic-mode-action",
    "affect-action",
    "reply-completion-action"
  ] as const) {
    for (const interaction of ["model-busy", "chat-visible", "user-active"] as const) {
      const decision = resolveCompanionContextArbitration(input({
        channel,
        interaction,
        presentationBusy: true
      }));
      assert.equal(decision.decision, "suppress");
      assert.equal(decision.reason, "presentation_busy");
      assert.equal(decision.replay, "never");
    }
  }
});

test("enabled affect band only suppresses environment or silence candidates and never creates one", () => {
  assert.equal(
    resolveCompanionContextArbitration(input({ channel: "proactive-environment", affectBand: "focused" })).decision,
    "suppress"
  );
  assert.equal(
    resolveCompanionContextArbitration(input({ channel: "proactive-silence", affectBand: "focused" })).decision,
    "suppress"
  );
  assert.equal(
    resolveCompanionContextArbitration(input({ channel: "proactive-source", affectBand: "focused" })).decision,
    "allow"
  );
});

test("disabled affect never suppresses focused proactive environment or silence candidates", () => {
  for (const channel of ["proactive-environment", "proactive-silence"] as const) {
    assert.deepEqual(
      resolveCompanionContextArbitration(input({
        channel,
        affectEnabled: false,
        affectBand: "focused"
      })),
      {
        decision: "allow",
        reason: "allowed",
        replay: "never",
        actionIntent: "none",
        priority: 0
      }
    );
  }
});
