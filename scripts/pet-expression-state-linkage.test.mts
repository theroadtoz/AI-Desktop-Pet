import assert from "node:assert/strict";
import test from "node:test";
import { DIALOGUE_MODE_VIEWS } from "../src/shared/dialogue-style.ts";
import {
  PET_EXPRESSION_PRESET_CATALOG,
  isPetExpressionPresetId
} from "../src/shared/interaction-action-catalog.ts";
import {
  PET_ACTION_STATE_IDS,
  type PetActionStateId
} from "../src/shared/pet-action-state-machine.ts";
import {
  PET_LAYERED_ACTION_DECISION_CATALOG
} from "../src/shared/pet-layered-action-decision.ts";
import {
  PET_EXPRESSION_STATE_LINKAGE_POLICY_CATALOG,
  PET_EXPRESSION_STATE_LINKAGE_POLICY_IDS,
  getPetExpressionStateLinkagePolicy,
  listPetExpressionStateLinkagePolicies,
  resolvePetExpressionStateLinkage
} from "../src/shared/pet-expression-state-linkage.ts";
import { PRESENCE_MODE_VIEWS } from "../src/shared/presence-mode.ts";

const KNOWN_DIALOGUE_MODE_IDS = new Set(DIALOGUE_MODE_VIEWS.map((mode) => mode.id));
const KNOWN_PRESENCE_MODE_IDS = new Set(PRESENCE_MODE_VIEWS.map((mode) => mode.id));

const POLICY_PRESET_KEYS = [
  "baseExpressionPresetId",
  "microExpressionPresetId",
  "strongExpressionPresetId"
] as const;

function assertSelected(
  stateId: PetActionStateId,
  expectedExpressionPresetId: keyof typeof PET_EXPRESSION_PRESET_CATALOG,
  dialogueModeId: "default" | "work" | "game" | "reading",
  presenceModeId: "default" | "focus" | "quiet" | "sleep"
): void {
  const resolution = resolvePetExpressionStateLinkage({ stateId, dialogueModeId, presenceModeId });

  assert.equal(resolution.status, "selected", stateId);
  assert.equal(resolution.expressionPresetId, expectedExpressionPresetId, stateId);
  assert.equal(isPetExpressionPresetId(resolution.expressionPresetId), true, stateId);
  assert.equal(resolution.durationMs > 0, true, stateId);
  assert.equal(resolution.cooldownMs >= getPetExpressionStateLinkagePolicy(stateId).minimumIntervalMs, true, stateId);
  assert.equal(resolution.restorePolicy, PET_EXPRESSION_PRESET_CATALOG[expectedExpressionPresetId].restorePolicy, stateId);
  assert.equal(resolution.visualRisk, PET_EXPRESSION_PRESET_CATALOG[expectedExpressionPresetId].visualRisk, stateId);
}

test("expression state linkage catalog covers every current action state without extras", () => {
  assert.deepEqual(PET_EXPRESSION_STATE_LINKAGE_POLICY_IDS, PET_ACTION_STATE_IDS);
  assert.deepEqual(Object.keys(PET_EXPRESSION_STATE_LINKAGE_POLICY_CATALOG), [...PET_ACTION_STATE_IDS]);
  assert.deepEqual(
    listPetExpressionStateLinkagePolicies().map((policy) => policy.stateId),
    [...PET_ACTION_STATE_IDS]
  );

  for (const stateId of PET_ACTION_STATE_IDS) {
    assert.equal(getPetExpressionStateLinkagePolicy(stateId).stateId, stateId);
  }
});

test("expression state linkage reuses layered action decision boundaries", () => {
  for (const stateId of PET_ACTION_STATE_IDS) {
    const policy = getPetExpressionStateLinkagePolicy(stateId);
    const decision = PET_LAYERED_ACTION_DECISION_CATALOG[stateId];

    assert.deepEqual(policy.allowedPresenceModes, decision.allowedPresenceModes, stateId);
    assert.deepEqual(policy.allowedDialogueModes, decision.allowedDialogueModes, stateId);
    assert.equal(policy.minimumIntervalMs, decision.minimumIntervalMs, stateId);
    assert.equal(policy.cooldownMs >= decision.minimumIntervalMs, true, stateId);
    assert.equal(policy.interruptPolicy, decision.interruptPolicy, stateId);
    assert.deepEqual(policy.realUiCoverage, decision.realUiCoverage, stateId);
    assert.equal(policy.fallbackPolicy, "presentation-only", stateId);
    assert.equal(policy.privacyRisk, "safe-enum-only", stateId);

    for (const presenceModeId of policy.allowedPresenceModes) {
      assert.equal(KNOWN_PRESENCE_MODE_IDS.has(presenceModeId), true, `${stateId}:${presenceModeId}`);
    }

    for (const dialogueModeId of policy.allowedDialogueModes) {
      assert.equal(KNOWN_DIALOGUE_MODE_IDS.has(dialogueModeId), true, `${stateId}:${dialogueModeId}`);
    }
  }
});

test("expression state linkage policies only reference audited preset ids", () => {
  for (const policy of listPetExpressionStateLinkagePolicies()) {
    assert.equal(policy.minDurationMs <= policy.maxDurationMs, true, policy.stateId);
    assert.equal(policy.restorePolicy, "restore-persistent-expression", policy.stateId);

    for (const presetKey of POLICY_PRESET_KEYS) {
      const presetId = policy[presetKey];
      if (presetId === undefined) {
        continue;
      }

      assert.equal(isPetExpressionPresetId(presetId), true, `${policy.stateId}:${presetKey}`);
      assert.equal(Object.hasOwn(PET_EXPRESSION_PRESET_CATALOG, presetId), true, `${policy.stateId}:${presetId}`);
    }
  }
});

test("expression state linkage selects representative safe presets for core modes", () => {
  assertSelected("think", "dark", "default", "default");
  assertSelected("local-model-busy", "dark", "default", "default");
  assertSelected("memory-injected", "happy", "default", "default");
  assertSelected("search-cited", "glasses", "default", "default");
  assertSelected("proactive-bubble-visible", "happy", "default", "default");
  assertSelected("work", "glasses", "work", "focus");
  assertSelected("read", "glasses", "reading", "default");
  assertSelected("game", "gestureGame", "game", "default");
});

test("expression state linkage lowers intensity in quiet and sleep contexts", () => {
  const quietThink = resolvePetExpressionStateLinkage({
    stateId: "think",
    dialogueModeId: "default",
    presenceModeId: "quiet"
  });
  assert.equal(quietThink.status, "presentation-only");
  assert.equal("expressionPresetId" in quietThink, false);
  assert.equal(quietThink.restorePolicy, "no-expression-change");
  assert.equal(quietThink.visualRisk, "none");

  const sleepThink = resolvePetExpressionStateLinkage({
    stateId: "think",
    dialogueModeId: "default",
    presenceModeId: "sleep"
  });
  assert.equal(sleepThink.status, "presentation-only");
  assert.equal("expressionPresetId" in sleepThink, false);

  const sleepState = resolvePetExpressionStateLinkage({
    stateId: "sleep",
    dialogueModeId: "default",
    presenceModeId: "sleep"
  });
  assert.equal(sleepState.status, "presentation-only");
  assert.equal(sleepState.durationMs, 0);
  assert.equal(sleepState.cooldownMs >= getPetExpressionStateLinkagePolicy("sleep").minimumIntervalMs, true);

  const quietGame = resolvePetExpressionStateLinkage({
    stateId: "game",
    dialogueModeId: "game",
    presenceModeId: "quiet"
  });
  assert.equal(quietGame.status, "blocked");
  assert.equal(quietGame.blockReason, "presence-mode-blocked");
  assert.equal("expressionPresetId" in quietGame, false);

  const quietLocalModelBusy = resolvePetExpressionStateLinkage({
    stateId: "local-model-busy",
    dialogueModeId: "default",
    presenceModeId: "quiet"
  });
  assert.equal(quietLocalModelBusy.status, "presentation-only");
  assert.equal("expressionPresetId" in quietLocalModelBusy, false);

  const quietMemoryInjected = resolvePetExpressionStateLinkage({
    stateId: "memory-injected",
    dialogueModeId: "default",
    presenceModeId: "quiet"
  });
  assert.equal(quietMemoryInjected.status, "presentation-only");
  assert.equal("expressionPresetId" in quietMemoryInjected, false);

  const sleepMemoryInjected = resolvePetExpressionStateLinkage({
    stateId: "memory-injected",
    dialogueModeId: "default",
    presenceModeId: "sleep"
  });
  assert.equal(sleepMemoryInjected.status, "blocked");
  assert.equal(sleepMemoryInjected.blockReason, "presence-mode-blocked");

  const memorySkipped = resolvePetExpressionStateLinkage({
    stateId: "memory-skipped",
    dialogueModeId: "default",
    presenceModeId: "default"
  });
  assert.equal(memorySkipped.status, "presentation-only");
  assert.equal(memorySkipped.durationMs, 0);
  assert.equal("expressionPresetId" in memorySkipped, false);

  const quietSearchCited = resolvePetExpressionStateLinkage({
    stateId: "search-cited",
    dialogueModeId: "default",
    presenceModeId: "quiet"
  });
  assert.equal(quietSearchCited.status, "presentation-only");
  assert.equal("expressionPresetId" in quietSearchCited, false);

  const sleepProactiveBubble = resolvePetExpressionStateLinkage({
    stateId: "proactive-bubble-visible",
    dialogueModeId: "default",
    presenceModeId: "sleep"
  });
  assert.equal(sleepProactiveBubble.status, "blocked");
  assert.equal(sleepProactiveBubble.blockReason, "presence-mode-blocked");
});

test("expression state linkage blocks state and dialogue mismatches before selecting a preset", () => {
  const gameInDefaultDialogue = resolvePetExpressionStateLinkage({
    stateId: "game",
    dialogueModeId: "default",
    presenceModeId: "default"
  });

  assert.equal(gameInDefaultDialogue.status, "blocked");
  assert.equal(gameInDefaultDialogue.blockReason, "dialogue-mode-blocked");
  assert.equal(gameInDefaultDialogue.durationMs, 0);
  assert.equal(gameInDefaultDialogue.restorePolicy, "no-expression-change");
  assert.equal(gameInDefaultDialogue.visualRisk, "none");
});

test("expression state linkage resolver summary never returns raw policy internals", () => {
  const resolution = resolvePetExpressionStateLinkage({
    stateId: "read",
    dialogueModeId: "reading",
    presenceModeId: "default"
  });

  assert.equal("baseExpressionPresetId" in resolution, false);
  assert.equal("microExpressionPresetId" in resolution, false);
  assert.equal("strongExpressionPresetId" in resolution, false);
  assert.equal("allowedPresenceModes" in resolution, false);
  assert.equal("allowedDialogueModes" in resolution, false);
});

test("expression state linkage serialized output contains no forbidden raw fields", () => {
  const serialized = JSON.stringify({
    policies: PET_EXPRESSION_STATE_LINKAGE_POLICY_CATALOG,
    resolutions: PET_ACTION_STATE_IDS.map((stateId) => resolvePetExpressionStateLinkage({
      stateId,
      dialogueModeId: "default",
      presenceModeId: stateId === "sleep" ? "sleep" : "default"
    }))
  });
  const forbiddenPatterns = [
    /\.motion3\.json/i,
    /\.exp3\.json/i,
    /[A-Za-z]:[\\/]/,
    /https?:\/\//i,
    /apiKey/i,
    /token/i,
    /systemPrompt/i,
    /providerRequestBody/i,
    /factCardBody/i,
    /prompt/i,
    /messages/i,
    /content/i,
    /payload/i,
    /expressionName/i,
    /partId/i,
    /resourcePath/i,
    /windowBounds/i,
    /request/i,
    /response/i
  ];

  for (const pattern of forbiddenPatterns) {
    assert.doesNotMatch(serialized, pattern);
  }
});
