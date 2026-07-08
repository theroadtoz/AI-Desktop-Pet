import assert from "node:assert/strict";
import test from "node:test";
import { DIALOGUE_MODE_VIEWS, type DialogueModeId } from "../src/shared/dialogue-style.ts";
import {
  PET_EXPRESSION_PRESET_CATALOG,
  isPetExpressionPresetId,
  type PetExpressionPresetId
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
import { PRESENCE_MODE_VIEWS, type PresenceModeId } from "../src/shared/presence-mode.ts";

const KNOWN_DIALOGUE_MODE_IDS = new Set(DIALOGUE_MODE_VIEWS.map((mode) => mode.id));
const KNOWN_PRESENCE_MODE_IDS = new Set(PRESENCE_MODE_VIEWS.map((mode) => mode.id));

const POLICY_PRESET_KEYS = [
  "baseExpressionPresetId",
  "microExpressionPresetId",
  "strongExpressionPresetId"
] as const;

type ExpectedExpressionStateLinkageMatrixCase = {
  caseId: string;
  stateId: PetActionStateId;
  dialogueModeId: DialogueModeId;
  presenceModeId: PresenceModeId;
  status: "selected" | "presentation-only";
  expressionPresetId?: PetExpressionPresetId;
};

const EXPRESSION_STATE_LINKAGE_MATRIX = [
  {
    caseId: "default-think-keeps-dark",
    stateId: "think",
    dialogueModeId: "default",
    presenceModeId: "default",
    status: "selected",
    expressionPresetId: "dark"
  },
  {
    caseId: "focus-think-blocks-dark",
    stateId: "think",
    dialogueModeId: "default",
    presenceModeId: "focus",
    status: "presentation-only"
  },
  {
    caseId: "focus-local-model-busy-blocks-dark",
    stateId: "local-model-busy",
    dialogueModeId: "default",
    presenceModeId: "focus",
    status: "presentation-only"
  },
  {
    caseId: "focus-work-keeps-glasses",
    stateId: "work",
    dialogueModeId: "work",
    presenceModeId: "focus",
    status: "selected",
    expressionPresetId: "glasses"
  },
  {
    caseId: "focus-read-keeps-glasses",
    stateId: "read",
    dialogueModeId: "reading",
    presenceModeId: "focus",
    status: "selected",
    expressionPresetId: "glasses"
  },
  {
    caseId: "focus-search-keeps-glasses",
    stateId: "search-cited",
    dialogueModeId: "default",
    presenceModeId: "focus",
    status: "selected",
    expressionPresetId: "glasses"
  },
  {
    caseId: "quiet-listen-is-presentation-only",
    stateId: "listen",
    dialogueModeId: "default",
    presenceModeId: "quiet",
    status: "presentation-only"
  },
  {
    caseId: "sleep-state-is-presentation-only",
    stateId: "sleep",
    dialogueModeId: "default",
    presenceModeId: "sleep",
    status: "presentation-only"
  }
] as const satisfies readonly ExpectedExpressionStateLinkageMatrixCase[];

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

function assertMatrixCase(item: ExpectedExpressionStateLinkageMatrixCase): void {
  const resolution = resolvePetExpressionStateLinkage({
    stateId: item.stateId,
    dialogueModeId: item.dialogueModeId,
    presenceModeId: item.presenceModeId
  });

  assert.equal(resolution.status, item.status, item.caseId);
  if (item.status === "selected") {
    assert.equal(resolution.status, "selected", item.caseId);
    assert.equal(resolution.expressionPresetId, item.expressionPresetId, item.caseId);
    assert.equal(resolution.durationMs > 0, true, item.caseId);
    assert.equal(resolution.visualRisk, PET_EXPRESSION_PRESET_CATALOG[item.expressionPresetId].visualRisk, item.caseId);
    return;
  }

  assert.equal("expressionPresetId" in resolution, false, item.caseId);
  assert.equal(resolution.restorePolicy, "no-expression-change", item.caseId);
  assert.equal(resolution.visualRisk, "none", item.caseId);
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

test("expression state linkage matrix preserves default behavior and focus visual-risk priority", () => {
  for (const item of EXPRESSION_STATE_LINKAGE_MATRIX) {
    assertMatrixCase(item);
  }

  assertSelected("greet", "bow", "default", "default");
  assert.equal(getPetExpressionStateLinkagePolicy("greet").microExpressionPresetId, "gestureMic");
});

test("expression preset catalog keeps high intensity out of focus quiet and sleep", () => {
  for (const [presetId, preset] of Object.entries(PET_EXPRESSION_PRESET_CATALOG)) {
    if (preset.intensity !== "high") {
      continue;
    }

    for (const presenceModeId of ["focus", "quiet", "sleep"] as const) {
      assert.equal(
        preset.allowedPresenceModes.includes(presenceModeId),
        false,
        `${presetId}:${presenceModeId}`
      );
    }
  }
});

test("expression state linkage blocks needs-visual-check presets in focus", () => {
  for (const stateId of PET_ACTION_STATE_IDS) {
    for (const dialogueMode of DIALOGUE_MODE_VIEWS) {
      const resolution = resolvePetExpressionStateLinkage({
        stateId,
        dialogueModeId: dialogueMode.id,
        presenceModeId: "focus"
      });

      if (resolution.status !== "selected") {
        continue;
      }

      assert.notEqual(resolution.visualRisk, "needs-visual-check", `${stateId}:${dialogueMode.id}`);
    }
  }
});

test("expression state linkage never selects medium or high intensity in quiet or sleep", () => {
  for (const stateId of PET_ACTION_STATE_IDS) {
    for (const dialogueMode of DIALOGUE_MODE_VIEWS) {
      for (const presenceModeId of ["quiet", "sleep"] as const) {
        const resolution = resolvePetExpressionStateLinkage({
          stateId,
          dialogueModeId: dialogueMode.id,
          presenceModeId
        });

        if (resolution.status !== "selected") {
          continue;
        }

        assert.equal(
          PET_EXPRESSION_PRESET_CATALOG[resolution.expressionPresetId].intensity,
          "low",
          `${stateId}:${dialogueMode.id}:${presenceModeId}`
        );
      }
    }
  }
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
    resolutions: PET_ACTION_STATE_IDS.flatMap((stateId) => DIALOGUE_MODE_VIEWS.flatMap((dialogueMode) => (
      PRESENCE_MODE_VIEWS.map((presenceMode) => resolvePetExpressionStateLinkage({
        stateId,
        dialogueModeId: dialogueMode.id,
        presenceModeId: presenceMode.id
      }))
    )))
  });
  const forbiddenPatterns = [
    /baseExpressionPresetId/i,
    /microExpressionPresetId/i,
    /strongExpressionPresetId/i,
    /allowedPresenceModes/i,
    /allowedDialogueModes/i,
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
    /expressionPath/i,
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
