import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  PET_INTERACTION_GLOBAL_COOLDOWN_MS,
  PET_INTERACTION_HEAD_PAT_COOLDOWN_MS,
  PET_INTERACTION_STRONG_ACTION_COOLDOWN_MS,
  PET_WINDOW_SHAKE_LIGHT_FEEDBACK_COOLDOWN_MS,
  PET_RAPID_TOUCH_COMBO_COUNT,
  PET_RAPID_TOUCH_COMBO_WINDOW_MS,
  PET_INTERACTION_ACTIONS,
  PET_INTERACTION_ACTION_TYPES,
  PET_RANDOM_INTERACTION_ACTIONS,
  createClickActionScheduler,
  createRapidTouchComboDetector,
  getInteractionActionCooldownSkipReason,
  getPresenceFilteredPetInteractionActions,
  getRandomPetInteractionActionsForMode,
  getPetInteractionAction,
  getWindowShakeLightFeedbackSkipReason,
  isStrongInteractionAction,
  selectRandomPetInteractionAction
} from "../src/renderer/pet/interaction-actions.ts";
import { createInteractionActionPlayer } from "../src/renderer/pet/interaction-action-player.ts";
import {
  PET_TELEMETRY_ALLOWED_FIELDS,
  parsePetRendererTelemetryEvent,
  type PetTelemetryEventType
} from "../src/shared/pet-telemetry-contract.ts";
import {
  PET_BODY_POOL_ACTION_TYPES,
  PET_EXPRESSION_PRESET_CATALOG,
  PET_INTERACTION_ACTION_CATALOG,
  PET_STRONG_ACCESSORY_ACTION_TYPES,
  PET_WINDOW_SHAKE_SAFE_ECHO_MESSAGE,
  getPetExpressionPresetExpressionName,
  getPetInteractionActionSafeEchoMessage,
  getPetWindowMotionFeedbackSafeEchoMessage
} from "../src/shared/interaction-action-catalog.ts";
import {
  PET_ACTION_STATE_CATALOG as SCRIPT_ACTION_STATE_CATALOG,
  PET_ACTION_STATE_IDS as SCRIPT_ACTION_STATE_IDS,
  PET_BODY_POOL_ACTION_TYPES as SCRIPT_BODY_POOL_ACTION_TYPES,
  PET_EXPRESSION_PRESET_CATALOG as SCRIPT_EXPRESSION_PRESET_CATALOG,
  PET_INTERACTION_ACTION_CATALOG as SCRIPT_INTERACTION_ACTION_CATALOG,
  PET_STRONG_ACCESSORY_ACTION_TYPES as SCRIPT_STRONG_ACCESSORY_ACTION_TYPES,
  PET_WINDOW_SHAKE_SAFE_ECHO_MESSAGE as SCRIPT_WINDOW_SHAKE_SAFE_ECHO_MESSAGE
} from "./support/pet-action-semantic-constants.mjs";
import {
  PET_ACTION_TRIGGER_REASONS,
  getPetActionTriggerActionType
} from "../src/shared/pet-action-trigger.ts";
import {
  PET_ACTION_STATE_CATALOG,
  PET_ACTION_STATE_IDS,
  getPetActionStateForReason
} from "../src/shared/pet-action-state-machine.ts";
import { resolvePetExpressionStateLinkage } from "../src/shared/pet-expression-state-linkage.ts";
import type { EmotionPresentation } from "../src/shared/emotion-presentation.ts";
import type { PetAccessoryPresetId } from "../src/shared/pet-accessory.ts";

type FakePlayerTimer = {
  callback: () => void;
  delayMs: number;
  cleared: boolean;
};

function createFakeInteractionActionPlayer() {
  let nowMs = 1_000;
  let persistent: { presentation: EmotionPresentation; accessoryPresetId: PetAccessoryPresetId } = {
    presentation: { emotion: "neutral", intensity: "low", mode: "neutral" },
    accessoryPresetId: "none"
  };
  const timers: FakePlayerTimer[] = [];
  const calls: string[] = [];
  const telemetry: { type: PetTelemetryEventType; payload: Record<string, unknown> }[] = [];
  const player = createInteractionActionPlayer({
    now: () => nowMs,
    scheduleTimeout: (callback, delayMs) => {
      const timer = { callback, delayMs, cleared: false };
      timers.push(timer);
      return timer as ReturnType<typeof setTimeout>;
    },
    clearScheduledTimeout: (handle) => {
      (handle as unknown as FakePlayerTimer).cleared = true;
    },
    getAction: getPetInteractionAction,
    getCooldownSkipReason: getInteractionActionCooldownSkipReason,
    getWindowShakeLightFeedbackSkipReason,
    isStrongAction: isStrongInteractionAction,
    boostInteraction: (durationMs) => {
      calls.push(`boost:${durationMs ?? "default"}`);
    },
    pauseLook: () => {
      calls.push("pauseLook");
    },
    resumeLook: () => {
      calls.push("resumeLook");
    },
    setLookTarget: (x, y) => {
      calls.push(`setLookTarget:${x}:${y}`);
    },
    resetLookTarget: () => {
      calls.push("resetLookTarget");
    },
    setPoseTarget: (target) => {
      calls.push(`setPoseTarget:${JSON.stringify(target)}`);
    },
    resetPoseTarget: () => {
      calls.push("resetPoseTarget");
    },
    playMotionPreset: (motionPresetId) => {
      calls.push(`playMotionPreset:${motionPresetId}`);
    },
    stopMotion: () => {
      calls.push("stopMotion");
    },
    applyTemporaryPartOpacities: (partIds) => {
      calls.push(`temporaryParts:${partIds.join(",")}`);
    },
    restoreTemporaryPartOpacities: () => {
      calls.push("restoreParts");
    },
    setExpression: (expressionName) => {
      calls.push(`setExpression:${expressionName}`);
    },
    clearExpression: () => {
      calls.push("clearExpression");
    },
    applyPresentation: (presentation, accessoryPresetId) => {
      calls.push(`applyPresentation:${presentation.emotion}:${accessoryPresetId}`);
    },
    getPersistentPresentation: () => persistent,
    reportTelemetry: (type, payload) => {
      telemetry.push({ type, payload });
    }
  });

  return {
    player,
    timers,
    calls,
    telemetry,
    setNow(value: number): void {
      nowMs = value;
    },
    setPersistentAccessory(accessoryPresetId: PetAccessoryPresetId): void {
      persistent = { ...persistent, accessoryPresetId };
    }
  };
}

test("pet interaction action manifest covers the P2-8A action types", () => {
  assert.deepEqual(
    PET_INTERACTION_ACTIONS.map((action) => action.type).sort(),
    [...PET_INTERACTION_ACTION_TYPES].sort()
  );

  for (const action of PET_INTERACTION_ACTIONS) {
    assert.equal(action.weight > 0, true);
    assert.equal(action.durationMs > 0, true);
  }
});

test("pet interaction action catalog covers manifest semantics and safe echoes", () => {
  assert.deepEqual(
    Object.keys(PET_INTERACTION_ACTION_CATALOG).sort(),
    [...PET_INTERACTION_ACTION_TYPES].sort()
  );

  for (const action of PET_INTERACTION_ACTIONS) {
    const semantic = PET_INTERACTION_ACTION_CATALOG[action.type];
    assert.equal(semantic.actionType, action.type);
    assert.equal(semantic.safeEchoMessage.length > 0, true);
    assert.equal(semantic.defaultDurationMs, action.durationMs);
    assert.equal(getPetInteractionActionSafeEchoMessage(action.type), semantic.safeEchoMessage);
  }
});

test("pet interaction action catalog owns body pool eligibility and strong accessory markers", () => {
  assert.deepEqual(
    [...PET_BODY_POOL_ACTION_TYPES].sort(),
    [
      "curiousTilt",
      "doze",
      "edgeGlance",
      "flusteredGlance",
      "focus",
      "gameCheerLite",
      "gameReady",
      "greeting",
      "listen",
      "lookAway",
      "playGame",
      "quietNod",
      "reading",
      "readingIdle",
      "readingThink",
      "replySustain",
      "replyThinking",
      "shySmile",
      "sleepySettle",
      "softSmile",
      "thinking",
      "workFocus"
    ].sort()
  );
  assert.equal(PET_INTERACTION_ACTION_CATALOG.appearance.bodyPoolEligible, false);
  assert.equal(PET_INTERACTION_ACTION_CATALOG.headPat.bodyPoolEligible, false);
  assert.deepEqual(
    [...PET_STRONG_ACCESSORY_ACTION_TYPES].sort(),
    ["gameCheerLite", "gameReady", "playGame", "reading", "readingIdle", "readingThink"].sort()
  );
  assert.equal(PET_INTERACTION_ACTION_CATALOG.gameCheerLite.strongAccessory, true);
  assert.equal(PET_INTERACTION_ACTION_CATALOG.gameReady.strongAccessory, true);
  assert.equal(PET_INTERACTION_ACTION_CATALOG.playGame.strongAccessory, true);
  assert.equal(PET_INTERACTION_ACTION_CATALOG.reading.strongAccessory, true);
  assert.equal(PET_INTERACTION_ACTION_CATALOG.readingIdle.strongAccessory, true);
  assert.equal(PET_INTERACTION_ACTION_CATALOG.readingThink.strongAccessory, true);
  assert.equal(PET_INTERACTION_ACTION_CATALOG.greeting.strongAccessory, false);
});

test("expression preset catalog classifies safe expression resources without paths", () => {
  assert.deepEqual(Object.keys(PET_EXPRESSION_PRESET_CATALOG).sort(), [
    "angry",
    "bow",
    "dark",
    "excited",
    "gestureGame",
    "gestureMic",
    "ghost",
    "glasses",
    "happy",
    "hat",
    "sad",
    "staff"
  ].sort());

  assert.equal(PET_EXPRESSION_PRESET_CATALOG.happy.category, "emotion");
  assert.equal(PET_EXPRESSION_PRESET_CATALOG.dark.category, "emotion");
  assert.equal(PET_EXPRESSION_PRESET_CATALOG.glasses.category, "prop-or-appearance");
  assert.equal(PET_EXPRESSION_PRESET_CATALOG.bow.category, "prop-or-appearance");
  assert.equal(PET_EXPRESSION_PRESET_CATALOG.gestureGame.category, "gesture-like");
  assert.equal(PET_EXPRESSION_PRESET_CATALOG.ghost.category, "uncertain-or-needs-visual-check");
  assert.equal(PET_EXPRESSION_PRESET_CATALOG.ghost.visualRisk, "needs-visual-check");
  assert.deepEqual(PET_EXPRESSION_PRESET_CATALOG.glasses.suggestedActionTypes, ["reading", "readingIdle", "readingThink"]);
  assert.deepEqual(PET_EXPRESSION_PRESET_CATALOG.gestureGame.suggestedActionTypes, ["playGame", "gameReady", "gameCheerLite"]);

  for (const [presetId, preset] of Object.entries(PET_EXPRESSION_PRESET_CATALOG)) {
    assert.equal(preset.presetId, presetId);
    assert.equal(getPetExpressionPresetExpressionName(presetId as keyof typeof PET_EXPRESSION_PRESET_CATALOG), preset.expressionName);
    assert.equal(/[/\\]|\.exp3|\.json|resources|model/i.test(preset.expressionName), false);
    assert.equal(preset.allowedPresenceModes.length > 0, true);
    assert.equal(preset.allowedDialogueModes.length > 0, true);
    assert.equal(preset.restorePolicy, "restore-persistent-expression");
    for (const actionType of preset.suggestedActionTypes) {
      assert.equal(PET_INTERACTION_ACTION_TYPES.includes(actionType), true);
    }
  }
});

test("safe echo helpers reject unknown actions and strip window shake payload detail", () => {
  assert.equal(getPetInteractionActionSafeEchoMessage("unknown_action"), null);
  assert.equal(getPetWindowMotionFeedbackSafeEchoMessage("skipped"), null);
  assert.equal(getPetWindowMotionFeedbackSafeEchoMessage("started"), PET_WINDOW_SHAKE_SAFE_ECHO_MESSAGE);
  assert.equal(PET_WINDOW_SHAKE_SAFE_ECHO_MESSAGE, "刚刚被晃了一下");
  assert.equal(/reason|duration|payload|window_shake_feedback/i.test(PET_WINDOW_SHAKE_SAFE_ECHO_MESSAGE), false);
  for (const type of PET_INTERACTION_ACTION_TYPES) {
    const message = getPetInteractionActionSafeEchoMessage(type);
    assert.equal(typeof message, "string");
    assert.equal(/payload|partId|reason|duration|selectedActionType|candidateActionTypes/i.test(message ?? ""), false);
  }
});

test("action trigger reasons map to fixed actions and emit safe started telemetry", () => {
  const expected = {
    chat_opened: "listen",
    chat_input_focus: "listen",
    chat_reply_waiting: "replyThinking",
    pet_edge_settled: "edgeGlance",
    rapid_touch_combo: "flusteredGlance",
    chat_reply_sustain: "replySustain",
    state_idle: "softSmile",
    state_greet: "greeting",
    state_listen: "listen",
    state_think: "replyThinking",
    state_reply_sustain: "replySustain",
    state_sleep: "doze",
    state_work: "workFocus",
    state_game: "gameReady",
    state_read: "readingIdle",
    state_edge: "edgeGlance",
    state_flustered: "flusteredGlance",
    state_local_model_busy: "replyThinking"
  } as const;

  for (const reason of PET_ACTION_TRIGGER_REASONS) {
    const harness = createFakeInteractionActionPlayer();
    const actionType = getPetActionTriggerActionType(reason);

    assert.equal(actionType, expected[reason]);
    assert.equal(harness.player.playAction(getPetInteractionAction(actionType), reason), true);
    assert.deepEqual(harness.telemetry.at(0), {
      type: "pet_interaction_action_started",
      payload: {
        type: actionType,
        reason,
        durationMs: getPetInteractionAction(actionType).durationMs
      }
    });
  }
});

test("state action triggers can emit safe state telemetry without arbitrary payloads", () => {
  const harness = createFakeInteractionActionPlayer();
  const state = getPetActionStateForReason("state_work");
  const action = getPetInteractionAction(state.actionType);

  assert.equal(harness.player.playAction(action, state.triggerReason, {
    stateId: state.stateId,
    modeId: "work",
    presenceModeId: "focus",
    candidateActionTypes: [state.actionType]
  }), true);

  assert.deepEqual(harness.telemetry[0], {
    type: "pet_interaction_action_started",
    payload: {
      type: "workFocus",
      reason: "state_work",
      stateId: "work",
      durationMs: action.durationMs,
      modeId: "work",
      presenceModeId: "focus",
      candidateActionTypes: ["workFocus"],
      selectedActionType: "workFocus"
    }
  });
  assert.deepEqual(parsePetRendererTelemetryEvent(harness.telemetry[0]), harness.telemetry[0]);
});

test("state expression linkage drives only safe preset ids into player telemetry", () => {
  const harness = createFakeInteractionActionPlayer();
  const state = getPetActionStateForReason("state_work");
  const action = getPetInteractionAction(state.actionType);
  const expressionLinkage = resolvePetExpressionStateLinkage({
    stateId: state.stateId,
    dialogueModeId: "work",
    presenceModeId: "focus"
  });

  assert.equal(expressionLinkage.status, "selected");
  assert.equal(expressionLinkage.expressionPresetId, "glasses");
  assert.equal(harness.player.playAction(action, state.triggerReason, {
    stateId: state.stateId,
    modeId: "work",
    presenceModeId: "focus",
    expressionPresetId: expressionLinkage.expressionPresetId,
    candidateActionTypes: [state.actionType]
  }), true);

  assert.equal(harness.calls.includes("setExpression:glasses"), true);
  assert.deepEqual(harness.telemetry[0], {
    type: "pet_interaction_action_started",
    payload: {
      type: "workFocus",
      reason: "state_work",
      stateId: "work",
      durationMs: action.durationMs,
      modeId: "work",
      presenceModeId: "focus",
      expressionPresetId: "glasses",
      candidateActionTypes: ["workFocus"],
      selectedActionType: "workFocus"
    }
  });
  assert.equal("expressionName" in harness.telemetry[0]?.payload, false);
  assert.deepEqual(parsePetRendererTelemetryEvent(harness.telemetry[0]), harness.telemetry[0]);
});

test("local model busy linkage drives dark preset through safe state telemetry", () => {
  const harness = createFakeInteractionActionPlayer();
  const state = getPetActionStateForReason("state_local_model_busy");
  const action = getPetInteractionAction(state.actionType);
  const expressionLinkage = resolvePetExpressionStateLinkage({
    stateId: state.stateId,
    dialogueModeId: "default",
    presenceModeId: "default"
  });

  assert.equal(expressionLinkage.status, "selected");
  assert.equal(expressionLinkage.expressionPresetId, "dark");
  assert.equal(harness.player.playAction(action, state.triggerReason, {
    stateId: state.stateId,
    modeId: "default",
    presenceModeId: "default",
    expressionPresetId: expressionLinkage.expressionPresetId,
    candidateActionTypes: [state.actionType]
  }), true);

  assert.equal(harness.calls.includes("setExpression:dark"), true);
  assert.deepEqual(harness.telemetry[0], {
    type: "pet_interaction_action_started",
    payload: {
      type: "replyThinking",
      reason: "state_local_model_busy",
      stateId: "local-model-busy",
      durationMs: action.durationMs,
      modeId: "default",
      presenceModeId: "default",
      expressionPresetId: "dark",
      candidateActionTypes: ["replyThinking"],
      selectedActionType: "replyThinking"
    }
  });
  assert.equal("expressionName" in harness.telemetry[0]?.payload, false);
  assert.deepEqual(parsePetRendererTelemetryEvent(harness.telemetry[0]), harness.telemetry[0]);
});

test("main pet activity echo delegates safe messages to the shared catalog helpers", async () => {
  const source = await readFile(new URL("../src/main/app.ts", import.meta.url), "utf8");
  const createEchoStart = source.indexOf("function createPetActivityEcho");
  const createEchoEnd = source.indexOf("function startPerformanceHeartbeat", createEchoStart);
  const createEchoSource = source.slice(createEchoStart, createEchoEnd);

  assert.notEqual(createEchoStart, -1);
  assert.match(createEchoSource, /getPetInteractionActionSafeEchoMessage\(payload\.type\)/);
  assert.match(createEchoSource, /getPetWindowMotionFeedbackSafeEchoMessage\(payload\.result\)/);
  assert.match(createEchoSource, /return message \? \{ message \} : null/);
  assert.doesNotMatch(createEchoSource, /case "headPat"|case "playGame"|刚刚摸头|刚刚玩游戏|durationMs|reason/);
});

test("real UI script action constants stay aligned with the shared catalog", () => {
  assert.deepEqual(
    Object.keys(SCRIPT_INTERACTION_ACTION_CATALOG).sort(),
    Object.keys(PET_INTERACTION_ACTION_CATALOG).sort()
  );
  assert.deepEqual([...SCRIPT_ACTION_STATE_IDS].sort(), [...PET_ACTION_STATE_IDS].sort());
  assert.deepEqual([...SCRIPT_BODY_POOL_ACTION_TYPES].sort(), [...PET_BODY_POOL_ACTION_TYPES].sort());
  assert.deepEqual([...SCRIPT_STRONG_ACCESSORY_ACTION_TYPES].sort(), [...PET_STRONG_ACCESSORY_ACTION_TYPES].sort());
  assert.deepEqual(Object.keys(SCRIPT_EXPRESSION_PRESET_CATALOG).sort(), Object.keys(PET_EXPRESSION_PRESET_CATALOG).sort());
  assert.equal(SCRIPT_WINDOW_SHAKE_SAFE_ECHO_MESSAGE, PET_WINDOW_SHAKE_SAFE_ECHO_MESSAGE);

  for (const stateId of PET_ACTION_STATE_IDS) {
    assert.equal(
      SCRIPT_ACTION_STATE_CATALOG[stateId]?.triggerReason,
      PET_ACTION_STATE_CATALOG[stateId].triggerReason
    );
    assert.equal(
      SCRIPT_ACTION_STATE_CATALOG[stateId]?.actionType,
      PET_ACTION_STATE_CATALOG[stateId].actionType
    );
    assert.equal(
      SCRIPT_ACTION_STATE_CATALOG[stateId]?.safeSummaryLabel,
      PET_ACTION_STATE_CATALOG[stateId].safeSummaryLabel
    );
  }

  for (const type of PET_INTERACTION_ACTION_TYPES) {
    assert.equal(
      SCRIPT_INTERACTION_ACTION_CATALOG[type]?.safeEchoMessage,
      PET_INTERACTION_ACTION_CATALOG[type].safeEchoMessage
    );
    assert.equal(
      SCRIPT_INTERACTION_ACTION_CATALOG[type]?.defaultDurationMs,
      PET_INTERACTION_ACTION_CATALOG[type].defaultDurationMs
    );
  }

  for (const presetId of Object.keys(PET_EXPRESSION_PRESET_CATALOG)) {
    const preset = PET_EXPRESSION_PRESET_CATALOG[presetId as keyof typeof PET_EXPRESSION_PRESET_CATALOG];
    const scriptPreset = SCRIPT_EXPRESSION_PRESET_CATALOG[presetId];

    assert.equal(scriptPreset?.expressionName, preset.expressionName);
    assert.equal(scriptPreset?.category, preset.category);
    assert.equal(scriptPreset?.intensity, preset.intensity);
    assert.deepEqual(scriptPreset?.allowedPresenceModes, [...preset.allowedPresenceModes]);
    assert.deepEqual(scriptPreset?.allowedDialogueModes, [...preset.allowedDialogueModes]);
    assert.deepEqual(scriptPreset?.suggestedActionTypes, [...preset.suggestedActionTypes]);
    assert.equal(scriptPreset?.visualRisk, preset.visualRisk);
    assert.equal(scriptPreset?.restorePolicy, preset.restorePolicy);
  }
});

test("pet interaction action manifest includes audited expression and accessory candidates", () => {
  const byType = new Map(PET_INTERACTION_ACTIONS.map((action) => [action.type, action]));
  const expectedExpressionPresets = {
    appearance: "excited",
    headPat: "happy",
    shySmile: "happy",
    playGame: "gestureGame",
    gameReady: "gestureGame",
    gameCheerLite: "gestureGame",
    reading: "glasses",
    readingIdle: "glasses",
    readingThink: "glasses"
  } as const;

  assert.equal(byType.get("greeting")?.expressionName, undefined);
  assert.equal(byType.get("listen")?.expressionName, undefined);
  assert.deepEqual(byType.get("listen")?.lookTarget, { x: 0, y: 0.18 });
  assert.equal(byType.get("curiousTilt")?.expressionName, undefined);
  assert.deepEqual(byType.get("curiousTilt")?.lookTarget, { x: 0.22, y: 0.12 });
  assert.deepEqual(byType.get("curiousTilt")?.poseTarget, { bodyAngleX: 2, bodyAngleZ: -1, angleZ: 2 });
  assert.equal(byType.get("softSmile")?.presentation.emotion, "happy");
  assert.equal(byType.get("quietNod")?.expressionName, undefined);
  assert.deepEqual(byType.get("quietNod")?.lookTarget, { x: 0, y: 0.08 });
  assert.deepEqual(byType.get("quietNod")?.poseTarget, { bodyAngleY: -1.5, bodyAngleZ: 0.8 });
  assert.equal(byType.get("shySmile")?.expressionName, "happy");
  assert.deepEqual(byType.get("shySmile")?.lookTarget, { x: -0.22, y: -0.06 });
  assert.deepEqual(byType.get("shySmile")?.poseTarget, { bodyAngleX: -2.5, bodyAngleZ: 1.5, angleZ: -2 });
  assert.equal(byType.get("lookAway")?.expressionName, undefined);
  assert.deepEqual(byType.get("lookAway")?.lookTarget, { x: -0.45, y: 0.02 });
  assert.equal(byType.get("thinking")?.expressionName, undefined);
  assert.equal(byType.get("replyThinking")?.expressionName, undefined);
  assert.deepEqual(byType.get("replyThinking")?.lookTarget, { x: 0.18, y: 0.08 });
  assert.equal(byType.get("focus")?.expressionName, undefined);
  assert.equal(byType.get("focus")?.accessoryPartIds, undefined);
  assert.equal(byType.get("workFocus")?.expressionName, undefined);
  assert.deepEqual(byType.get("workFocus")?.lookTarget, { x: 0.05, y: 0.1 });
  assert.deepEqual(byType.get("doze")?.lookTarget, { x: 0, y: -0.22 });
  assert.deepEqual(byType.get("edgeGlance")?.lookTarget, { x: 0.38, y: 0.02 });
  assert.deepEqual(byType.get("edgeGlance")?.poseTarget, { bodyAngleX: 4, bodyAngleZ: -2 });
  assert.equal(byType.get("flusteredGlance")?.presentation.emotion, "surprised");
  assert.deepEqual(byType.get("flusteredGlance")?.lookTarget, { x: -0.36, y: -0.12 });
  assert.deepEqual(byType.get("flusteredGlance")?.poseTarget, { bodyAngleX: -5, bodyAngleZ: 3, angleZ: -4 });
  assert.equal(byType.get("replySustain")?.presentation.intensity, "low");
  assert.deepEqual(byType.get("replySustain")?.lookTarget, { x: 0.08, y: 0.04 });
  assert.deepEqual(byType.get("replySustain")?.poseTarget, { bodyAngleX: 1.5, bodyAngleZ: -1 });
  assert.equal(byType.get("reading")?.expressionName, "glasses");
  assert.deepEqual(byType.get("reading")?.accessoryPartIds, ["Part53"]);
  assert.equal(byType.get("readingIdle")?.expressionName, "glasses");
  assert.deepEqual(byType.get("readingIdle")?.accessoryPartIds, ["Part53"]);
  assert.equal(byType.get("playGame")?.expressionName, "gestureGame");
  assert.deepEqual(byType.get("playGame")?.accessoryPartIds, ["Part17", "Part21"]);
  assert.equal(byType.get("gameReady")?.expressionName, "gestureGame");
  assert.deepEqual(byType.get("gameReady")?.accessoryPartIds, ["Part17", "Part21"]);
  assert.equal(byType.get("gameCheerLite")?.expressionName, "gestureGame");
  assert.deepEqual(byType.get("gameCheerLite")?.accessoryPartIds, ["Part17", "Part21"]);
  assert.deepEqual(byType.get("gameCheerLite")?.poseTarget, { bodyAngleX: 3, bodyAngleZ: -1.5 });
  assert.equal(byType.get("readingThink")?.expressionName, "glasses");
  assert.deepEqual(byType.get("readingThink")?.accessoryPartIds, ["Part53"]);
  assert.deepEqual(byType.get("readingThink")?.lookTarget, { x: -0.08, y: -0.16 });
  assert.equal(byType.get("sleepySettle")?.expressionName, undefined);
  assert.deepEqual(byType.get("sleepySettle")?.lookTarget, { x: 0, y: -0.25 });

  for (const [type, expressionPresetId] of Object.entries(expectedExpressionPresets)) {
    const action = byType.get(type as keyof typeof expectedExpressionPresets);

    assert.equal(action?.expressionPresetId, expressionPresetId);
    assert.equal(action?.expressionName, getPetExpressionPresetExpressionName(expressionPresetId));
  }

  for (const action of PET_INTERACTION_ACTIONS) {
    if (action.expressionName) {
      assert.equal(action.expressionPresetId !== undefined, true);
      continue;
    }

    assert.equal(action.expressionPresetId, undefined);
  }
});

test("ordinary random interaction pool excludes startup and head-only actions", () => {
  assert.deepEqual(
    PET_RANDOM_INTERACTION_ACTIONS.map((action) => action.type).sort(),
    [
      "curiousTilt",
      "doze",
      "edgeGlance",
      "flusteredGlance",
      "focus",
      "gameCheerLite",
      "gameReady",
      "greeting",
      "listen",
      "lookAway",
      "playGame",
      "quietNod",
      "reading",
      "readingIdle",
      "readingThink",
      "replySustain",
      "replyThinking",
      "shySmile",
      "sleepySettle",
      "softSmile",
      "thinking",
      "workFocus"
    ].sort()
  );
  assert.equal(selectRandomPetInteractionAction(() => 0).type, "greeting");
  assert.equal(selectRandomPetInteractionAction(() => 0.2).type, "listen");
  assert.equal(selectRandomPetInteractionAction(() => 0.255).type, "curiousTilt");
  assert.equal(selectRandomPetInteractionAction(() => 0.315).type, "softSmile");
  assert.equal(selectRandomPetInteractionAction(() => 0.375).type, "quietNod");
  assert.equal(selectRandomPetInteractionAction(() => 0.41).type, "shySmile");
  assert.equal(selectRandomPetInteractionAction(() => 0.44).type, "lookAway");
  assert.equal(selectRandomPetInteractionAction(() => 0.5).type, "thinking");
  assert.equal(selectRandomPetInteractionAction(() => 0.58).type, "replyThinking");
  assert.equal(selectRandomPetInteractionAction(() => 0.63).type, "playGame");
  assert.equal(selectRandomPetInteractionAction(() => 0.662).type, "gameReady");
  assert.equal(selectRandomPetInteractionAction(() => 0.691).type, "gameCheerLite");
  assert.equal(selectRandomPetInteractionAction(() => 0.72).type, "reading");
  assert.equal(selectRandomPetInteractionAction(() => 0.755).type, "readingIdle");
  assert.equal(selectRandomPetInteractionAction(() => 0.792).type, "readingThink");
  assert.equal(selectRandomPetInteractionAction(() => 0.825).type, "focus");
  assert.equal(selectRandomPetInteractionAction(() => 0.86).type, "workFocus");
  assert.equal(selectRandomPetInteractionAction(() => 0.887).type, "doze");
  assert.equal(selectRandomPetInteractionAction(() => 0.905).type, "sleepySettle");
  assert.equal(selectRandomPetInteractionAction(() => 0.93).type, "edgeGlance");
  assert.equal(selectRandomPetInteractionAction(() => 0.96).type, "flusteredGlance");
  assert.equal(selectRandomPetInteractionAction(() => 0.999).type, "replySustain");
  assert.equal(getPetInteractionAction("appearance").type, "appearance");
  assert.equal(getPetInteractionAction("headPat").type, "headPat");
});

test("dialogue modes adjust ordinary body action weights without changing the default pool", () => {
  function weightsFor(modeId: "default" | "work" | "game" | "reading") {
    return Object.fromEntries(getRandomPetInteractionActionsForMode(modeId).map((action) => [action.type, action.weight]));
  }

  assert.deepEqual(weightsFor("default"), {
    greeting: 3,
    listen: 3,
    curiousTilt: 1.1,
    softSmile: 2,
    quietNod: 1.1,
    shySmile: 0.6,
    lookAway: 1,
    thinking: 2,
    replyThinking: 2,
    playGame: 0.8,
    gameReady: 0.8,
    gameCheerLite: 0.7,
    reading: 0.8,
    readingIdle: 1,
    readingThink: 0.9,
    focus: 0.8,
    workFocus: 1,
    doze: 0.4,
    sleepySettle: 0.5,
    edgeGlance: 0.8,
    flusteredGlance: 0.7,
    replySustain: 0.7
  });
  assert.deepEqual(
    getRandomPetInteractionActionsForMode("default").map((action) => action.type).sort(),
    [
      "curiousTilt",
      "doze",
      "edgeGlance",
      "flusteredGlance",
      "focus",
      "gameCheerLite",
      "gameReady",
      "greeting",
      "listen",
      "lookAway",
      "playGame",
      "quietNod",
      "reading",
      "readingIdle",
      "readingThink",
      "replySustain",
      "replyThinking",
      "shySmile",
      "sleepySettle",
      "softSmile",
      "thinking",
      "workFocus"
    ].sort()
  );
  assert.equal(weightsFor("game").gameReady, 4);
  assert.equal(weightsFor("game").playGame, 3);
  assert.equal(weightsFor("game").gameCheerLite, 2.4);
  assert.equal(weightsFor("game").focus, 0);
  assert.equal(weightsFor("game").workFocus, 0);
  assert.equal(weightsFor("reading").readingIdle, 4);
  assert.equal(weightsFor("reading").reading, 3);
  assert.equal(weightsFor("reading").readingThink, 3.2);
  assert.equal(weightsFor("reading").focus, 1.5);
  assert.equal(weightsFor("work").replyThinking, 3.5);
  assert.equal(weightsFor("work").workFocus, 4);
  assert.equal(weightsFor("work").curiousTilt, 1.8);
  assert.equal(weightsFor("work").quietNod, 1.8);
  assert.equal(weightsFor("work").playGame, 0.2);
  assert.equal(getRandomPetInteractionActionsForMode("game").some((action) => action.type === "appearance" || action.type === "headPat"), false);
});

test("dialogue mode body action selection follows mode weights", () => {
  assert.equal(selectRandomPetInteractionAction(() => 0.6, getRandomPetInteractionActionsForMode("default")).type, "replyThinking");
  assert.equal(selectRandomPetInteractionAction(() => 0.55, getRandomPetInteractionActionsForMode("game")).type, "playGame");
  assert.equal(selectRandomPetInteractionAction(() => 0.75, getRandomPetInteractionActionsForMode("game")).type, "gameReady");
  assert.equal(selectRandomPetInteractionAction(() => 0.84, getRandomPetInteractionActionsForMode("game")).type, "gameCheerLite");
  assert.equal(selectRandomPetInteractionAction(() => 0.48, getRandomPetInteractionActionsForMode("reading")).type, "reading");
  assert.equal(selectRandomPetInteractionAction(() => 0.64, getRandomPetInteractionActionsForMode("reading")).type, "readingIdle");
  assert.equal(selectRandomPetInteractionAction(() => 0.74, getRandomPetInteractionActionsForMode("reading")).type, "readingThink");
  assert.equal(selectRandomPetInteractionAction(() => 0.8, getRandomPetInteractionActionsForMode("work")).type, "workFocus");
  assert.notEqual(selectRandomPetInteractionAction(() => 0.68, getRandomPetInteractionActionsForMode("work")).type, "playGame");
});

test("presence modes filter ordinary body actions without changing default or headPat", () => {
  const defaultActions = getRandomPetInteractionActionsForMode("default");
  const focusActions = getPresenceFilteredPetInteractionActions(defaultActions, "focus");
  const quietActions = getPresenceFilteredPetInteractionActions(defaultActions, "quiet");
  const sleepActions = getPresenceFilteredPetInteractionActions(defaultActions, "sleep");

  assert.deepEqual(getPresenceFilteredPetInteractionActions(defaultActions, "default"), defaultActions);
  assert.equal(focusActions.find((action) => action.type === "playGame")?.weight, 0);
  assert.equal(focusActions.find((action) => action.type === "gameReady")?.weight, 0);
  assert.equal(focusActions.find((action) => action.type === "thinking")?.weight, 2);
  assert.equal(focusActions.find((action) => action.type === "workFocus")?.weight, 1);
  assert.deepEqual(
    quietActions.map((action) => action.type).sort(),
    [
      "curiousTilt",
      "doze",
      "edgeGlance",
      "flusteredGlance",
      "focus",
      "greeting",
      "listen",
      "lookAway",
      "quietNod",
      "replySustain",
      "replyThinking",
      "shySmile",
      "sleepySettle",
      "softSmile",
      "thinking",
      "workFocus"
    ].sort()
  );
  assert.deepEqual(
    sleepActions.map((action) => action.type).sort(),
    ["doze", "focus", "replySustain", "replyThinking", "sleepySettle", "thinking", "workFocus"].sort()
  );
  assert.equal(quietActions.some((action) => isStrongInteractionAction(action.type)), false);
  assert.equal(sleepActions.some((action) => isStrongInteractionAction(action.type)), false);
  assert.equal(getPetInteractionAction("headPat").type, "headPat");
});

test("presence filtered selection avoids strong accessory actions in quiet and sleep", () => {
  const quietActions = getPresenceFilteredPetInteractionActions(getRandomPetInteractionActionsForMode("game"), "quiet");
  const sleepActions = getPresenceFilteredPetInteractionActions(getRandomPetInteractionActionsForMode("reading"), "sleep");

  for (const sample of [0, 0.25, 0.5, 0.75, 0.999]) {
    assert.equal(isStrongInteractionAction(selectRandomPetInteractionAction(() => sample, quietActions).type), false);
    assert.equal(isStrongInteractionAction(selectRandomPetInteractionAction(() => sample, sleepActions).type), false);
  }
});

test("pet interaction action selection follows manifest weights", () => {
  const actions = [
    {
      type: "appearance",
      weight: 1,
      durationMs: 100,
      presentation: { emotion: "neutral", intensity: "low", mode: "neutral" }
    },
    {
      type: "headPat",
      weight: 3,
      durationMs: 100,
      presentation: { emotion: "happy", intensity: "medium", mode: "micro" }
    }
  ] as const;

  assert.equal(selectRandomPetInteractionAction(() => 0, actions).type, "appearance");
  assert.equal(selectRandomPetInteractionAction(() => 0.249, actions).type, "appearance");
  assert.equal(selectRandomPetInteractionAction(() => 0.25, actions).type, "headPat");
  assert.equal(selectRandomPetInteractionAction(() => 0.999, actions).type, "headPat");
});

test("pet interaction action selection rejects invalid manifests", () => {
  assert.throws(() => selectRandomPetInteractionAction(() => 0, []), /manifest is empty/);
  assert.throws(
    () => selectRandomPetInteractionAction(() => 0, [{
      type: "appearance",
      weight: 0,
      durationMs: 100,
      presentation: { emotion: "neutral", intensity: "low", mode: "neutral" }
    }]),
    /no selectable weight/
  );
});

test("pet interaction action cooldown rules skip dense or repeated clicks", () => {
  const headPat = getPetInteractionAction("headPat");
  const greeting = getPetInteractionAction("greeting");
  const playGame = getPetInteractionAction("playGame");
  const gameReady = getPetInteractionAction("gameReady");
  const reading = getPetInteractionAction("reading");
  const readingIdle = getPetInteractionAction("readingIdle");

  assert.equal(isStrongInteractionAction("playGame"), true);
  assert.equal(isStrongInteractionAction("gameReady"), true);
  assert.equal(isStrongInteractionAction("reading"), true);
  assert.equal(isStrongInteractionAction("readingIdle"), true);
  assert.equal(isStrongInteractionAction("greeting"), false);
  assert.equal(
    getInteractionActionCooldownSkipReason(greeting, 1_000, { activeType: "thinking" }),
    "active_action"
  );
  assert.equal(
    getInteractionActionCooldownSkipReason(greeting, 1_000, {
      lastActionFinishedAtMs: 1_000 - PET_INTERACTION_GLOBAL_COOLDOWN_MS + 1
    }),
    "global_cooldown"
  );
  assert.equal(
    getInteractionActionCooldownSkipReason(headPat, 2_000, {
      lastHeadPatFinishedAtMs: 2_000 - PET_INTERACTION_HEAD_PAT_COOLDOWN_MS + 1
    }),
    "head_pat_cooldown"
  );
  assert.equal(
    getInteractionActionCooldownSkipReason(playGame, 5_000, {
      strongActionFinishedAtMsByType: {
        playGame: 5_000 - PET_INTERACTION_STRONG_ACTION_COOLDOWN_MS + 1,
        reading: 5_000 - PET_INTERACTION_STRONG_ACTION_COOLDOWN_MS + 1,
        gameReady: 5_000 - PET_INTERACTION_STRONG_ACTION_COOLDOWN_MS + 1,
        readingIdle: 5_000 - PET_INTERACTION_STRONG_ACTION_COOLDOWN_MS + 1
      }
    }),
    "same_action_cooldown"
  );
  assert.equal(
    getInteractionActionCooldownSkipReason(gameReady, 5_000, {
      strongActionFinishedAtMsByType: {
        gameReady: 5_000 - PET_INTERACTION_STRONG_ACTION_COOLDOWN_MS + 1
      }
    }),
    "same_action_cooldown"
  );
  assert.equal(
    getInteractionActionCooldownSkipReason(readingIdle, 5_000, {
      strongActionFinishedAtMsByType: {
        readingIdle: 5_000 - PET_INTERACTION_STRONG_ACTION_COOLDOWN_MS + 1
      }
    }),
    "same_action_cooldown"
  );
  assert.equal(
    getInteractionActionCooldownSkipReason(reading, 5_000, {
      strongActionFinishedAtMsByType: {
        playGame: 5_000 - PET_INTERACTION_STRONG_ACTION_COOLDOWN_MS + 1
      }
    }),
    null
  );
});

test("window shake light feedback reuses thinking with active and independent cooldown guards", () => {
  const thinking = getPetInteractionAction("thinking");

  assert.equal(thinking.presentation.emotion, "confused");
  assert.equal(thinking.expressionName, undefined);
  assert.equal(thinking.accessoryPartIds, undefined);
  assert.equal(
    getWindowShakeLightFeedbackSkipReason(thinking, 1_000, { activeType: "headPat" }),
    "active_action"
  );
  assert.equal(
    getWindowShakeLightFeedbackSkipReason(thinking, 2_000, {
      lastActionFinishedAtMs: 2_000 - PET_INTERACTION_GLOBAL_COOLDOWN_MS + 1
    }),
    "global_cooldown"
  );
  assert.equal(
    getWindowShakeLightFeedbackSkipReason(thinking, 20_000, {
      lastWindowShakeFeedbackStartedAtMs: 20_000 - PET_WINDOW_SHAKE_LIGHT_FEEDBACK_COOLDOWN_MS + 1
    }),
    "window_shake_feedback_cooldown"
  );
  assert.equal(
    getWindowShakeLightFeedbackSkipReason(thinking, 20_000, {
      lastWindowShakeFeedbackStartedAtMs: 20_000 - PET_WINDOW_SHAKE_LIGHT_FEEDBACK_COOLDOWN_MS
    }),
    null
  );
});

test("interaction action player owns start, finish, restore, and finished telemetry", () => {
  const harness = createFakeInteractionActionPlayer();
  const reading = getPetInteractionAction("reading");

  assert.equal(harness.player.playAction(reading, "click_body", {
    modeId: "reading",
    candidateActionTypes: ["greeting", "thinking", "reading"]
  }), true);
  assert.equal(harness.player.isActive(), true);
  assert.equal(harness.player.getActiveActionType(), "reading");
  assert.deepEqual(harness.calls, [
    `boost:${reading.durationMs + 250}`,
    "pauseLook",
    "resetLookTarget",
    "temporaryParts:Part53",
    "setExpression:glasses"
  ]);
  assert.equal(harness.timers.length, 1);
  assert.equal(harness.timers[0]?.delayMs, reading.durationMs);
  assert.deepEqual(harness.telemetry[0], {
    type: "pet_interaction_action_started",
    payload: {
      type: "reading",
      reason: "click_body",
      durationMs: reading.durationMs,
      modeId: "reading",
      candidateActionTypes: ["greeting", "thinking", "reading"],
      selectedActionType: "reading"
    }
  });

  harness.setPersistentAccessory("glasses");
  harness.setNow(1_000 + reading.durationMs);
  harness.timers[0]?.callback();

  assert.equal(harness.player.isActive(), false);
  assert.deepEqual(harness.calls.slice(5), [
    "restoreParts",
    "clearExpression",
    "resetLookTarget",
    "resumeLook",
    "applyPresentation:neutral:glasses"
  ]);
  assert.deepEqual(harness.telemetry[1], {
    type: "pet_interaction_action_finished",
    payload: {
      type: "reading",
      reason: "click_body",
      restoredAccessoryPresetId: "glasses"
    }
  });
});

test("interaction action player applies manifest look targets and restores them on finish", () => {
  const harness = createFakeInteractionActionPlayer();
  const lookAway = getPetInteractionAction("lookAway");

  assert.equal(harness.player.playAction(lookAway, "click_body", {
    modeId: "default",
    candidateActionTypes: ["listen", "lookAway", "softSmile"]
  }), true);
  assert.deepEqual(harness.calls, [
    `boost:${lookAway.durationMs + 250}`,
    "resumeLook",
    "setLookTarget:-0.45:0.02",
    "temporaryParts:",
    "applyPresentation:neutral:none"
  ]);

  harness.setNow(1_000 + lookAway.durationMs);
  harness.timers[0]?.callback();

  assert.deepEqual(harness.calls.slice(5), [
    "restoreParts",
    "clearExpression",
    "resetLookTarget",
    "resumeLook",
    "applyPresentation:neutral:none"
  ]);
});

test("interaction action player applies manifest pose targets and restores them on finish", () => {
  const harness = createFakeInteractionActionPlayer();
  const edgeGlance = getPetInteractionAction("edgeGlance");

  assert.equal(harness.player.playAction(edgeGlance, "pet_edge_settled"), true);
  assert.deepEqual(harness.calls, [
    `boost:${edgeGlance.durationMs + 250}`,
    "resumeLook",
    "setLookTarget:0.38:0.02",
    "setPoseTarget:{\"bodyAngleX\":4,\"bodyAngleZ\":-2}",
    "temporaryParts:",
    "applyPresentation:neutral:none"
  ]);

  harness.setNow(1_000 + edgeGlance.durationMs);
  harness.timers[0]?.callback();

  assert.deepEqual(harness.calls.slice(6), [
    "restoreParts",
    "clearExpression",
    "resetLookTarget",
    "resetPoseTarget",
    "resumeLook",
    "applyPresentation:neutral:none"
  ]);
});

test("interaction action player routes motion preset ids without raw motion paths", () => {
  const harness = createFakeInteractionActionPlayer();
  const motionAction = {
    ...getPetInteractionAction("thinking"),
    motionPresetId: "future-wave"
  };

  assert.equal(harness.player.playAction(motionAction, "click_body"), true);
  assert.deepEqual(harness.calls, [
    `boost:${motionAction.durationMs + 250}`,
    "pauseLook",
    "resetLookTarget",
    "playMotionPreset:future-wave",
    "temporaryParts:",
    "applyPresentation:confused:none"
  ]);

  harness.setNow(1_000 + motionAction.durationMs);
  harness.timers[0]?.callback();

  assert.deepEqual(harness.calls.slice(6), [
    "restoreParts",
    "stopMotion",
    "clearExpression",
    "resetLookTarget",
    "resumeLook",
    "applyPresentation:neutral:none"
  ]);
});

test("interaction action player prevents stacking and reports active action skips", () => {
  const harness = createFakeInteractionActionPlayer();
  const thinking = getPetInteractionAction("thinking");

  assert.equal(harness.player.playAction(thinking, "click_body"), true);
  assert.equal(harness.player.playAction(getPetInteractionAction("headPat"), "click_head"), false);

  assert.deepEqual(harness.telemetry[1], {
    type: "pet_interaction_action_skipped",
    payload: {
      type: "headPat",
      reason: "click_head",
      skipReason: "active_action",
      activeType: "thinking"
    }
  });
});

test("interaction action player keeps global, headPat, and strong accessory cooldowns", () => {
  const globalHarness = createFakeInteractionActionPlayer();
  const greeting = getPetInteractionAction("greeting");
  assert.equal(globalHarness.player.playAction(greeting, "click_body"), true);
  globalHarness.setNow(1_000 + greeting.durationMs);
  globalHarness.timers[0]?.callback();
  globalHarness.setNow(1_000 + greeting.durationMs + PET_INTERACTION_GLOBAL_COOLDOWN_MS - 1);
  assert.equal(globalHarness.player.playAction(getPetInteractionAction("thinking"), "click_body"), false);
  assert.equal(globalHarness.telemetry.at(-1)?.payload.skipReason, "global_cooldown");

  const headHarness = createFakeInteractionActionPlayer();
  const headPat = getPetInteractionAction("headPat");
  assert.equal(headHarness.player.playAction(headPat, "click_head"), true);
  headHarness.setNow(1_000 + headPat.durationMs);
  headHarness.timers[0]?.callback();
  headHarness.setNow(1_000 + headPat.durationMs + PET_INTERACTION_HEAD_PAT_COOLDOWN_MS - 1);
  assert.equal(headHarness.player.playAction(headPat, "click_head"), false);
  assert.equal(headHarness.telemetry.at(-1)?.payload.skipReason, "head_pat_cooldown");

  const strongHarness = createFakeInteractionActionPlayer();
  const playGame = getPetInteractionAction("playGame");
  assert.equal(strongHarness.player.playAction(playGame, "click_body"), true);
  strongHarness.setNow(1_000 + playGame.durationMs);
  strongHarness.timers[0]?.callback();
  strongHarness.setNow(1_000 + playGame.durationMs + PET_INTERACTION_GLOBAL_COOLDOWN_MS + 1);
  assert.equal(strongHarness.player.playAction(playGame, "click_body"), false);
  assert.equal(strongHarness.telemetry.at(-1)?.payload.skipReason, "same_action_cooldown");
});

test("interaction action player owns window shake feedback lifecycle and cooldown telemetry", () => {
  const harness = createFakeInteractionActionPlayer();
  const thinking = getPetInteractionAction("thinking");

  assert.equal(harness.player.playWindowShakeLightFeedback(), true);
  assert.deepEqual(harness.telemetry.map((event) => event.type), [
    "pet_interaction_action_started",
    "pet_window_motion_feedback"
  ]);
  assert.deepEqual(harness.telemetry[0]?.payload, {
    type: "thinking",
    reason: "window_shake_feedback",
    durationMs: thinking.durationMs
  });
  assert.deepEqual(harness.telemetry[1]?.payload, {
    eventType: "window_shake_candidate",
    reason: "window_shake_feedback",
    feedbackType: "shake_light_feedback",
    result: "started",
    cooldownState: "available",
    durationMs: thinking.durationMs
  });

  harness.setNow(1_000 + thinking.durationMs);
  harness.timers[0]?.callback();
  harness.setNow(1_000 + PET_WINDOW_SHAKE_LIGHT_FEEDBACK_COOLDOWN_MS - 1);

  assert.equal(harness.player.playWindowShakeLightFeedback(), false);
  assert.deepEqual(harness.telemetry.at(-1), {
    type: "pet_window_motion_feedback",
    payload: {
      eventType: "window_shake_candidate",
      reason: "window_shake_feedback",
      feedbackType: "shake_light_feedback",
      result: "skipped",
      skipReason: "window_shake_feedback_cooldown",
      cooldownState: "cooling_down",
      durationMs: thinking.durationMs
    }
  });
});

test("interaction action player only emits renderer telemetry contract fields", () => {
  const harness = createFakeInteractionActionPlayer();
  const reading = getPetInteractionAction("reading");
  const allowedFields = new Set(PET_TELEMETRY_ALLOWED_FIELDS);

  harness.player.playAction(reading, "click_body", {
    modeId: "reading",
    candidateActionTypes: ["greeting", "thinking", "reading"]
  });
  harness.player.playAction(getPetInteractionAction("headPat"), "click_head");
  harness.setPersistentAccessory("glasses");
  harness.setNow(1_000 + reading.durationMs);
  harness.timers[0]?.callback();
  harness.setNow(1_000 + PET_WINDOW_SHAKE_LIGHT_FEEDBACK_COOLDOWN_MS - 1);
  harness.player.playWindowShakeLightFeedback();

  assert.equal(harness.telemetry.length, 5);
  for (const event of harness.telemetry) {
    assert.notEqual(parsePetRendererTelemetryEvent(event), null);
    for (const key of Object.keys(event.payload)) {
      assert.equal(allowedFields.has(key as typeof PET_TELEMETRY_ALLOWED_FIELDS[number]), true, key);
    }
    assert.deepEqual(Object.keys(event.payload).filter((key) => (
      /prompt|message|content|api|key|body|path|url/i.test(key)
    )), []);
  }
});

test("click action scheduler delays clicks and lets double click cancel the action", () => {
  type FakeTimer = {
    callback: () => void;
    delayMs: number;
    cleared: boolean;
  };

  const timers: FakeTimer[] = [];
  let triggered = 0;
  const scheduler = createClickActionScheduler({
    delayMs: 220,
    trigger: () => {
      triggered += 1;
    },
    setTimeoutFn: (callback, delayMs) => {
      const timer = { callback, delayMs, cleared: false };
      timers.push(timer);
      return timer as ReturnType<typeof setTimeout>;
    },
    clearTimeoutFn: (handle) => {
      (handle as unknown as FakeTimer).cleared = true;
    }
  });

  scheduler.schedule();
  assert.equal(timers.length, 1);
  assert.equal(timers[0]?.delayMs, 220);

  scheduler.cancel();
  assert.equal(timers[0]?.cleared, true);
  assert.equal(triggered, 0);

  scheduler.schedule();
  const activeTimer = timers[1];
  assert.equal(activeTimer?.cleared, false);
  activeTimer?.callback();
  assert.equal(triggered, 1);
});

test("rapid touch combo detector triggers once for dense touches and then resets", () => {
  const detector = createRapidTouchComboDetector();

  assert.equal(PET_RAPID_TOUCH_COMBO_COUNT, 3);
  assert.equal(PET_RAPID_TOUCH_COMBO_WINDOW_MS, 2_500);
  assert.equal(detector.record(1_000), false);
  assert.equal(detector.record(2_000), false);
  assert.equal(detector.record(3_300), true);
  assert.equal(detector.record(3_400), false);
  assert.equal(detector.record(6_100), false);
  assert.equal(detector.record(6_200), false);
  assert.equal(detector.record(6_300), true);
  detector.reset();
  assert.equal(detector.record(Number.NaN), false);
  assert.equal(detector.record(7_000), false);
});

test("pet pointermove no longer drives the Live2D look target", async () => {
  const source = await readFile(new URL("../src/renderer/pet/main.ts", import.meta.url), "utf8");
  const pointerMoveStart = source.indexOf('canvas.addEventListener("pointermove"');
  const pointerDownStart = source.indexOf('canvas.addEventListener("pointerdown"');

  assert.notEqual(pointerMoveStart, -1);
  assert.notEqual(pointerDownStart, -1);

  const pointerMoveHandler = source.slice(pointerMoveStart, pointerDownStart);

  assert.equal(pointerMoveHandler.includes("setLookTarget"), false);
});

test("pet pointer clicks route head and body actions without changing drag or double-click guards", async () => {
  const source = await readFile(new URL("../src/renderer/pet/main.ts", import.meta.url), "utf8");
  const playerSource = await readFile(new URL("../src/renderer/pet/interaction-action-player.ts", import.meta.url), "utf8");

  assert.match(source, /name: "head"/);
  assert.match(source, /name: "body"/);
  assert.match(source, /getPetInteractionAction\("headPat"\)/);
  assert.match(source, /getRandomPetInteractionActionsForMode\(currentDialogueModeId\)/);
  assert.match(source, /createInteractionActionPlayer/);
  assert.match(source, /interactionActionPlayer\.playAction/);
  assert.match(source, /getCooldownSkipReason: getInteractionActionCooldownSkipReason/);
  assert.match(playerSource, /getCooldownSkipReason/);
  assert.match(playerSource, /skipReason/);
  assert.match(source, /candidateActionTypes/);
  assert.match(playerSource, /selectedActionType/);
  assert.match(source, /modeId/);
  assert.match(source, /scheduleClickInteractionAction\(hitArea\)/);
  assert.match(source, /rapidTouchComboDetector\.record/);
  assert.match(source, /getPetActionStateForReason\("rapid_touch_combo"\)/);
  assert.match(source, /getPetInteractionAction\(rapidTouchState\.actionType\)/);
  assert.match(source, /"rapid_touch_combo"/);
  assert.match(source, /!pointerDown \|\| pointerDown\.pointerId !== event\.pointerId/);
  assert.match(source, /!wasDragging && hitArea/);
  assert.match(source, /cancelClickInteractionAction\(\)/);
});

test("window shake feedback IPC uses a fixed safe enum and dedicated reason", async () => {
  const petPreload = await readFile(new URL("../src/preload/pet-preload.ts", import.meta.url), "utf8");
  const appSource = await readFile(new URL("../src/main/app.ts", import.meta.url), "utf8");
  const rendererSource = await readFile(new URL("../src/renderer/pet/main.ts", import.meta.url), "utf8");
  const playerSource = await readFile(new URL("../src/renderer/pet/interaction-action-player.ts", import.meta.url), "utf8");

  assert.match(appSource, /candidate\.eventType === "window_shake_candidate"/);
  assert.match(appSource, /window\.webContents\.send\("pet:window-motion-feedback",\s*{\s*type: "shake_light_feedback"\s*}\)/s);
  assert.match(appSource, /"pet_window_motion_feedback"/);
  assert.match(petPreload, /isPetWindowMotionFeedback/);
  assert.match(petPreload, /type === "shake_light_feedback"/);
  const feedbackPreloadStart = petPreload.indexOf("onWindowMotionFeedback(handler)");
  const feedbackPreloadEnd = petPreload.indexOf("openChat()", feedbackPreloadStart);
  const feedbackPreload = petPreload.slice(feedbackPreloadStart, feedbackPreloadEnd);
  assert.doesNotMatch(feedbackPreload, /expressionName|partIds|durationMs|\.motion|motion:/);
  assert.match(rendererSource, /onWindowMotionFeedback/);
  assert.match(rendererSource, /interactionActionPlayer\.playWindowShakeLightFeedback\(\)/);
  assert.match(rendererSource, /getAction: getPetInteractionAction/);
  assert.match(playerSource, /getAction\("thinking"\)/);
  assert.match(playerSource, /"window_shake_feedback"/);
  assert.match(playerSource, /getWindowShakeLightFeedbackSkipReason/);
  assert.doesNotMatch(rendererSource, /feedback\.(expression|motion|part|duration|resource)/);
});

test("pet renderer reads dialogue mode without owning mode writes", async () => {
  const petPreload = await readFile(new URL("../src/preload/pet-preload.ts", import.meta.url), "utf8");
  const appSource = await readFile(new URL("../src/main/app.ts", import.meta.url), "utf8");

  assert.match(petPreload, /getDialogueMode/);
  assert.match(petPreload, /onDialogueModeChanged/);
  assert.doesNotMatch(petPreload, /dialogueMode:set/);
  assert.match(appSource, /!isChatSender\(event\) && !isPetSender\(event\)/);
  assert.match(appSource, /notifyPetDialogueModeChanged\(currentDialogueModeId\)/);
});

test("pet renderer reads presence mode without owning mode writes", async () => {
  const petPreload = await readFile(new URL("../src/preload/pet-preload.ts", import.meta.url), "utf8");
  const appSource = await readFile(new URL("../src/main/app.ts", import.meta.url), "utf8");
  const rendererSource = await readFile(new URL("../src/renderer/pet/main.ts", import.meta.url), "utf8");

  assert.match(petPreload, /getPresenceMode/);
  assert.match(petPreload, /onPresenceModeChanged/);
  assert.doesNotMatch(petPreload, /presenceMode:set/);
  assert.match(appSource, /!isChatSender\(event\) && !isPetSender\(event\)/);
  assert.match(appSource, /notifyPetPresenceModeChanged\(currentPresenceModeId\)/);
  assert.match(rendererSource, /getPresenceFilteredPetInteractionActions/);
  assert.match(rendererSource, /presenceModeId: currentPresenceModeId/);
});

test("renderer telemetry sanitizer delegates to the shared pet telemetry contract", async () => {
  const source = await readFile(new URL("../src/main/app.ts", import.meta.url), "utf8");

  assert.match(source, /parsePetRendererTelemetryEvent/);
  assert.match(source, /sanitizePetTelemetryEvent/);
  assert.doesNotMatch(source, /function sanitizeRendererTelemetry/);
});

test("pet startup appearance waits for a visible Live2D frame and only plays once per renderer lifecycle", async () => {
  const source = await readFile(new URL("../src/renderer/pet/main.ts", import.meta.url), "utf8");

  assert.match(source, /let hasPlayedStartupAppearance = false/);
  assert.match(source, /waitForNextLive2DFrameSample\(\)/);
  assert.match(source, /!hasPlayedStartupAppearance && sample && sample\.nonTransparentPixels > 0/);
  assert.match(source, /interactionActionPlayer\.playAction\(getPetInteractionAction\("appearance"\), "startup_first_visible_frame"\)/);
});
