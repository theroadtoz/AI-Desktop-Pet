import assert from "node:assert/strict";
import test from "node:test";
import { DIALOGUE_MODE_VIEWS } from "../src/shared/dialogue-style.ts";
import {
  PET_EXPRESSION_PRESET_CATALOG,
  PET_INTERACTION_ACTION_CATALOG
} from "../src/shared/interaction-action-catalog.ts";
import {
  PET_LAYERED_ACTION_DECISION_CATALOG,
  PET_LAYERED_ACTION_DECISION_IDS,
  PET_LAYERED_ACTION_TELEMETRY_SAFE_FIELDS,
  getPetLayeredActionDecision,
  getPetLayeredActionDecisionForReason,
  listPetLayeredActionDecisions
} from "../src/shared/pet-layered-action-decision.ts";
import {
  PET_ACTION_STATE_CATALOG,
  PET_ACTION_STATE_IDS,
  getPetActionStateForReason
} from "../src/shared/pet-action-state-machine.ts";
import { PET_ACTION_TRIGGER_REASONS } from "../src/shared/pet-action-trigger.ts";
import { APPROVED_MOTION_PRESETS } from "../src/shared/approved-motion-presets.ts";
import { PET_MOTION_PRESET_IDS } from "../src/shared/pet-motion-presets.ts";
import { PET_TELEMETRY_ALLOWED_FIELDS } from "../src/shared/pet-telemetry-contract.ts";
import { PRESENCE_MODE_VIEWS } from "../src/shared/presence-mode.ts";

const KNOWN_DIALOGUE_MODE_IDS = new Set(DIALOGUE_MODE_VIEWS.map((mode) => mode.id));
const KNOWN_PRESENCE_MODE_IDS = new Set(PRESENCE_MODE_VIEWS.map((mode) => mode.id));
const KNOWN_EXPRESSION_PRESET_IDS = new Set(Object.keys(PET_EXPRESSION_PRESET_CATALOG));
const TELEMETRY_ALLOWED_FIELD_SET = new Set(PET_TELEMETRY_ALLOWED_FIELDS);

test("layered action decision catalog covers every current action state without extra runtime states", () => {
  assert.deepEqual(PET_LAYERED_ACTION_DECISION_IDS, PET_ACTION_STATE_IDS);
  assert.deepEqual(Object.keys(PET_LAYERED_ACTION_DECISION_CATALOG), [...PET_ACTION_STATE_IDS]);
  assert.deepEqual(
    listPetLayeredActionDecisions().map((decision) => decision.stateId),
    [...PET_ACTION_STATE_IDS]
  );

  for (const stateId of PET_ACTION_STATE_IDS) {
    assert.equal(getPetLayeredActionDecision(stateId).stateId, stateId);
  }
});

test("layered action decisions mirror the state catalog and fixed action catalog", () => {
  for (const stateId of PET_ACTION_STATE_IDS) {
    const state = PET_ACTION_STATE_CATALOG[stateId];
    const decision = getPetLayeredActionDecision(stateId);
    const actionSemantic = PET_INTERACTION_ACTION_CATALOG[state.actionType];

    assert.equal(decision.triggerReason, state.triggerReason);
    assert.equal(decision.actionType, state.actionType);
    assert.equal(decision.priority, state.priority);
    assert.equal(decision.minimumIntervalMs, state.minimumIntervalMs);
    assert.equal(decision.interruptPolicy, state.interruptPolicy);
    assert.equal(decision.supportLevel, state.supportLevel);
    assert.equal(decision.safeSummaryLabel, state.safeSummaryLabel);
    assert.equal(decision.actionSupportLevel, actionSemantic.supportLevel);
    assert.equal(decision.actionDefaultDurationMs, actionSemantic.defaultDurationMs);
    assert.equal(decision.strongAccessory, actionSemantic.strongAccessory);
  }
});

test("layered action lookup preserves legacy trigger reason compatibility", () => {
  for (const reason of PET_ACTION_TRIGGER_REASONS) {
    const state = getPetActionStateForReason(reason);
    const decision = getPetLayeredActionDecisionForReason(reason);

    assert.equal(decision.stateId, state.stateId);
    assert.equal(decision.actionType, state.actionType);
    assert.equal(decision.triggerReason, state.triggerReason);
  }
});

test("layered action decisions declare presence and dialogue boundaries as safe enums", () => {
  for (const decision of listPetLayeredActionDecisions()) {
    assert.equal(decision.allowedPresenceModes.length > 0, true, decision.stateId);
    assert.equal(decision.allowedDialogueModes.length > 0, true, decision.stateId);

    for (const presenceModeId of decision.allowedPresenceModes) {
      assert.equal(KNOWN_PRESENCE_MODE_IDS.has(presenceModeId), true, `${decision.stateId}:${presenceModeId}`);
    }

    for (const dialogueModeId of decision.allowedDialogueModes) {
      assert.equal(KNOWN_DIALOGUE_MODE_IDS.has(dialogueModeId), true, `${decision.stateId}:${dialogueModeId}`);
    }
  }

  assert.deepEqual(getPetLayeredActionDecision("sleep").allowedPresenceModes, ["sleep"]);
  assert.deepEqual(getPetLayeredActionDecision("game").allowedPresenceModes, ["default"]);
  assert.deepEqual(getPetLayeredActionDecision("work").allowedDialogueModes, ["work"]);
  assert.deepEqual(getPetLayeredActionDecision("game").allowedDialogueModes, ["game"]);
  assert.deepEqual(getPetLayeredActionDecision("read").allowedDialogueModes, ["reading"]);
  assert.deepEqual(getPetLayeredActionDecision("memory-injected").allowedPresenceModes, ["default", "focus", "quiet"]);
  assert.deepEqual(getPetLayeredActionDecision("memory-skipped").allowedPresenceModes, ["default", "focus", "quiet"]);
  assert.deepEqual(getPetLayeredActionDecision("search-cited").allowedPresenceModes, ["default", "focus", "quiet"]);
  assert.deepEqual(getPetLayeredActionDecision("proactive-bubble-visible").allowedPresenceModes, ["default", "focus", "quiet"]);
  assert.deepEqual(getPetLayeredActionDecision("memory-injected").allowedDialogueModes, ["default", "work", "game", "reading"]);
  assert.deepEqual(getPetLayeredActionDecision("memory-skipped").allowedDialogueModes, ["default", "work", "game", "reading"]);
  assert.deepEqual(getPetLayeredActionDecision("search-cited").allowedDialogueModes, ["default", "work", "game", "reading"]);
  assert.deepEqual(getPetLayeredActionDecision("proactive-bubble-visible").allowedDialogueModes, ["default", "work", "game", "reading"]);
});

test("layered action decisions retain their fallback metadata beside the approved motion catalog", () => {
  const approvedPresetIds = APPROVED_MOTION_PRESETS.map((preset) => preset.id);
  assert.deepEqual(PET_MOTION_PRESET_IDS, approvedPresetIds);
  assert.equal(new Set(PET_MOTION_PRESET_IDS).size, PET_MOTION_PRESET_IDS.length);

  for (const decision of listPetLayeredActionDecisions()) {
    assert.deepEqual(decision.motionPresetFallback, {
      status: "expected-safe-skip",
      reason: "no-semantic-motion-presets",
      fallbackActionType: decision.actionType
    });
  }
});

test("layered action expression fallback only references audited preset ids", () => {
  for (const decision of listPetLayeredActionDecisions()) {
    const fallback = decision.expressionPresetFallback;

    assert.equal(fallback.restorePolicy, "restore-persistent-expression");
    assert.equal(
      fallback.policy,
      fallback.presetIds.length > 0 ? "catalog-suggested-expression-preset" : "action-presentation-only"
    );

    for (const presetId of fallback.presetIds) {
      assert.equal(KNOWN_EXPRESSION_PRESET_IDS.has(presetId), true, `${decision.stateId}:${presetId}`);
      assert.equal(
        PET_EXPRESSION_PRESET_CATALOG[presetId].suggestedActionTypes.includes(decision.actionType),
        true,
        `${presetId} should suggest ${decision.actionType}`
      );
    }
  }

  assert.deepEqual(getPetLayeredActionDecision("game").expressionPresetFallback.presetIds, ["gestureGame"]);
  assert.deepEqual(getPetLayeredActionDecision("read").expressionPresetFallback.presetIds, ["glasses"]);
  assert.deepEqual(getPetLayeredActionDecision("memory-injected").expressionPresetFallback.presetIds, []);
  assert.deepEqual(getPetLayeredActionDecision("memory-skipped").expressionPresetFallback.presetIds, []);
  assert.deepEqual(getPetLayeredActionDecision("search-cited").expressionPresetFallback.presetIds, ["glasses"]);
  assert.deepEqual(getPetLayeredActionDecision("proactive-bubble-visible").expressionPresetFallback.presetIds, ["happy"]);
});

test("layered action telemetry summary only uses the pet telemetry allowlist", () => {
  for (const field of PET_LAYERED_ACTION_TELEMETRY_SAFE_FIELDS) {
    assert.equal(TELEMETRY_ALLOWED_FIELD_SET.has(field), true, field);
  }

  for (const decision of listPetLayeredActionDecisions()) {
    assert.deepEqual(decision.telemetrySafeSummaryFields, PET_LAYERED_ACTION_TELEMETRY_SAFE_FIELDS);
    for (const field of decision.telemetrySafeSummaryFields) {
      assert.equal(TELEMETRY_ALLOWED_FIELD_SET.has(field), true, `${decision.stateId}:${field}`);
    }
  }
});

test("layered action catalog stores only safe enums and summaries, never raw resources or private text", () => {
  const serialized = JSON.stringify(PET_LAYERED_ACTION_DECISION_CATALOG);
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

  for (const decision of listPetLayeredActionDecisions()) {
    assert.equal(decision.privacyRisk, "safe-enum-only");
    assert.equal(decision.realUiCoverage.length > 0, true, decision.stateId);
    assert.equal(decision.poseAccessoryFallback.restores.includes("temporary-accessory"), true);
  }
  assert.deepEqual(getPetLayeredActionDecision("memory-injected").realUiCoverage, ["p2-31e2-memory-safe-states-real-ui"]);
  assert.deepEqual(getPetLayeredActionDecision("memory-skipped").realUiCoverage, ["p2-31e2-memory-safe-states-real-ui"]);
  assert.deepEqual(getPetLayeredActionDecision("search-cited").realUiCoverage, ["p2-31e2-search-proactive-safe-states-real-ui"]);
  assert.deepEqual(getPetLayeredActionDecision("proactive-bubble-visible").realUiCoverage, [
    "p2-31e2-search-proactive-safe-states-real-ui",
    "p2-49-history-summary-action-expression-real-ui"
  ]);
});
