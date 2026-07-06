import type { DialogueModeId } from "./dialogue-style.ts";
import {
  PET_EXPRESSION_PRESET_CATALOG,
  PET_INTERACTION_ACTION_CATALOG,
  type PetExpressionPresetId,
  type PetInteractionActionSupportLevel,
  type PetInteractionActionType
} from "./interaction-action-catalog.ts";
import {
  PET_ACTION_STATE_CATALOG,
  PET_ACTION_STATE_IDS,
  getPetActionState,
  getPetActionStateForReason,
  type PetActionStateId,
  type PetActionStateInterruptPolicy,
  type PetActionStateSupportLevel
} from "./pet-action-state-machine.ts";
import type { PetActionTriggerActionType, PetActionTriggerReason } from "./pet-action-trigger.ts";
import { PET_TELEMETRY_ALLOWED_FIELDS } from "./pet-telemetry-contract.ts";
import type { PresenceModeId } from "./presence-mode.ts";

const ALL_DIALOGUE_MODE_IDS = ["default", "work", "game", "reading"] as const satisfies readonly DialogueModeId[];
const ALL_PRESENCE_MODE_IDS = ["default", "focus", "quiet", "sleep"] as const satisfies readonly PresenceModeId[];
const NON_SLEEP_PRESENCE_MODE_IDS = ["default", "focus", "quiet"] as const satisfies readonly PresenceModeId[];

export const PET_LAYERED_ACTION_TELEMETRY_SAFE_FIELDS = [
  "type",
  "reason",
  "durationMs",
  "stateId",
  "modeId",
  "presenceModeId",
  "candidateActionTypes",
  "selectedActionType",
  "activeType",
  "expressionPresetId",
  "motionPresetId",
  "restoredAccessoryPresetId",
  "skipReason"
] as const satisfies readonly (typeof PET_TELEMETRY_ALLOWED_FIELDS[number])[];

export type PetLayeredActionTelemetrySafeField = typeof PET_LAYERED_ACTION_TELEMETRY_SAFE_FIELDS[number];
export type PetLayeredActionMotionPresetFallbackStatus = "expected-safe-skip";
export type PetLayeredActionMotionPresetFallbackReason = "no-semantic-motion-presets";
export type PetLayeredActionExpressionFallbackPolicy =
  | "catalog-suggested-expression-preset"
  | "action-presentation-only";
export type PetLayeredActionPoseAccessoryFallbackPolicy =
  | "existing-action-parameter-composition"
  | "existing-action-accessory-enhanced";
export type PetLayeredActionRestoreTarget =
  | "look-target"
  | "pose-target"
  | "temporary-accessory"
  | "presentation";
export type PetLayeredActionPrivacyRisk = "safe-enum-only";
export type PetLayeredActionRealUiCoverage =
  | "p2-25a-state-machine-real-ui"
  | "p2-25b-edge-half-body-real-ui"
  | "p2-31e2-local-model-busy-real-ui"
  | "p2-31e2-memory-safe-states-real-ui"
  | "p2-8c-interaction-review"
  | "focused-tests-only";

export type PetLayeredActionMotionPresetFallback = {
  status: PetLayeredActionMotionPresetFallbackStatus;
  reason: PetLayeredActionMotionPresetFallbackReason;
  fallbackActionType: PetActionTriggerActionType;
};

export type PetLayeredActionExpressionPresetFallback = {
  policy: PetLayeredActionExpressionFallbackPolicy;
  presetIds: readonly PetExpressionPresetId[];
  restorePolicy: "restore-persistent-expression";
};

export type PetLayeredActionPoseAccessoryFallback = {
  policy: PetLayeredActionPoseAccessoryFallbackPolicy;
  restores: readonly PetLayeredActionRestoreTarget[];
};

export type PetLayeredActionDecision = {
  stateId: PetActionStateId;
  triggerReason: PetActionTriggerReason;
  actionType: PetActionTriggerActionType;
  priority: number;
  minimumIntervalMs: number;
  interruptPolicy: PetActionStateInterruptPolicy;
  supportLevel: PetActionStateSupportLevel;
  safeSummaryLabel: string;
  actionSupportLevel: PetInteractionActionSupportLevel;
  actionDefaultDurationMs: number;
  strongAccessory: boolean;
  allowedPresenceModes: readonly PresenceModeId[];
  allowedDialogueModes: readonly DialogueModeId[];
  motionPresetFallback: PetLayeredActionMotionPresetFallback;
  expressionPresetFallback: PetLayeredActionExpressionPresetFallback;
  poseAccessoryFallback: PetLayeredActionPoseAccessoryFallback;
  telemetrySafeSummaryFields: readonly PetLayeredActionTelemetrySafeField[];
  realUiCoverage: readonly PetLayeredActionRealUiCoverage[];
  privacyRisk: PetLayeredActionPrivacyRisk;
};

type PetLayeredActionDecisionPolicy = {
  allowedPresenceModes: readonly PresenceModeId[];
  allowedDialogueModes: readonly DialogueModeId[];
  realUiCoverage: readonly PetLayeredActionRealUiCoverage[];
};

const PET_LAYERED_ACTION_DECISION_POLICY_BY_STATE = {
  idle: {
    allowedPresenceModes: NON_SLEEP_PRESENCE_MODE_IDS,
    allowedDialogueModes: ALL_DIALOGUE_MODE_IDS,
    realUiCoverage: ["p2-25a-state-machine-real-ui"]
  },
  greet: {
    allowedPresenceModes: NON_SLEEP_PRESENCE_MODE_IDS,
    allowedDialogueModes: ALL_DIALOGUE_MODE_IDS,
    realUiCoverage: ["focused-tests-only"]
  },
  listen: {
    allowedPresenceModes: NON_SLEEP_PRESENCE_MODE_IDS,
    allowedDialogueModes: ALL_DIALOGUE_MODE_IDS,
    realUiCoverage: ["p2-25a-state-machine-real-ui"]
  },
  think: {
    allowedPresenceModes: ALL_PRESENCE_MODE_IDS,
    allowedDialogueModes: ALL_DIALOGUE_MODE_IDS,
    realUiCoverage: ["p2-25a-state-machine-real-ui"]
  },
  "reply-sustain": {
    allowedPresenceModes: ALL_PRESENCE_MODE_IDS,
    allowedDialogueModes: ALL_DIALOGUE_MODE_IDS,
    realUiCoverage: ["p2-8c-interaction-review"]
  },
  sleep: {
    allowedPresenceModes: ["sleep"],
    allowedDialogueModes: ALL_DIALOGUE_MODE_IDS,
    realUiCoverage: ["p2-25a-state-machine-real-ui"]
  },
  work: {
    allowedPresenceModes: NON_SLEEP_PRESENCE_MODE_IDS,
    allowedDialogueModes: ["work"],
    realUiCoverage: ["p2-25a-state-machine-real-ui"]
  },
  game: {
    allowedPresenceModes: ["default"],
    allowedDialogueModes: ["game"],
    realUiCoverage: ["p2-25a-state-machine-real-ui"]
  },
  read: {
    allowedPresenceModes: NON_SLEEP_PRESENCE_MODE_IDS,
    allowedDialogueModes: ["reading"],
    realUiCoverage: ["p2-25a-state-machine-real-ui"]
  },
  edge: {
    allowedPresenceModes: NON_SLEEP_PRESENCE_MODE_IDS,
    allowedDialogueModes: ALL_DIALOGUE_MODE_IDS,
    realUiCoverage: ["p2-25b-edge-half-body-real-ui"]
  },
  flustered: {
    allowedPresenceModes: NON_SLEEP_PRESENCE_MODE_IDS,
    allowedDialogueModes: ALL_DIALOGUE_MODE_IDS,
    realUiCoverage: ["p2-8c-interaction-review"]
  },
  "local-model-busy": {
    allowedPresenceModes: ALL_PRESENCE_MODE_IDS,
    allowedDialogueModes: ALL_DIALOGUE_MODE_IDS,
    realUiCoverage: ["p2-31e2-local-model-busy-real-ui"]
  },
  "memory-injected": {
    allowedPresenceModes: NON_SLEEP_PRESENCE_MODE_IDS,
    allowedDialogueModes: ALL_DIALOGUE_MODE_IDS,
    realUiCoverage: ["p2-31e2-memory-safe-states-real-ui"]
  },
  "memory-skipped": {
    allowedPresenceModes: NON_SLEEP_PRESENCE_MODE_IDS,
    allowedDialogueModes: ALL_DIALOGUE_MODE_IDS,
    realUiCoverage: ["p2-31e2-memory-safe-states-real-ui"]
  }
} as const satisfies Readonly<Record<PetActionStateId, PetLayeredActionDecisionPolicy>>;

const DEFAULT_RESTORE_TARGETS = [
  "look-target",
  "pose-target",
  "temporary-accessory",
  "presentation"
] as const satisfies readonly PetLayeredActionRestoreTarget[];

function findExpressionPresetFallbackIds(actionType: PetActionTriggerActionType): readonly PetExpressionPresetId[] {
  return Object.entries(PET_EXPRESSION_PRESET_CATALOG)
    .filter(([, preset]) => (
      (preset.suggestedActionTypes as readonly PetInteractionActionType[]).includes(actionType as PetInteractionActionType)
    ))
    .map(([presetId]) => presetId as PetExpressionPresetId);
}

function createExpressionPresetFallback(actionType: PetActionTriggerActionType): PetLayeredActionExpressionPresetFallback {
  const presetIds = findExpressionPresetFallbackIds(actionType);

  return {
    policy: presetIds.length > 0 ? "catalog-suggested-expression-preset" : "action-presentation-only",
    presetIds,
    restorePolicy: "restore-persistent-expression"
  };
}

function createMotionPresetFallback(actionType: PetActionTriggerActionType): PetLayeredActionMotionPresetFallback {
  return {
    status: "expected-safe-skip",
    reason: "no-semantic-motion-presets",
    fallbackActionType: actionType
  };
}

function createPoseAccessoryFallback(actionSupportLevel: PetInteractionActionSupportLevel): PetLayeredActionPoseAccessoryFallback {
  return {
    policy: actionSupportLevel === "accessory-enhanced"
      ? "existing-action-accessory-enhanced"
      : "existing-action-parameter-composition",
    restores: DEFAULT_RESTORE_TARGETS
  };
}

function createPetLayeredActionDecision(stateId: PetActionStateId): PetLayeredActionDecision {
  const state = getPetActionState(stateId);
  const actionSemantic = PET_INTERACTION_ACTION_CATALOG[state.actionType];
  const policy = PET_LAYERED_ACTION_DECISION_POLICY_BY_STATE[stateId];

  return Object.freeze({
    stateId: state.stateId,
    triggerReason: state.triggerReason,
    actionType: state.actionType,
    priority: state.priority,
    minimumIntervalMs: state.minimumIntervalMs,
    interruptPolicy: state.interruptPolicy,
    supportLevel: state.supportLevel,
    safeSummaryLabel: state.safeSummaryLabel,
    actionSupportLevel: actionSemantic.supportLevel,
    actionDefaultDurationMs: actionSemantic.defaultDurationMs,
    strongAccessory: actionSemantic.strongAccessory,
    allowedPresenceModes: policy.allowedPresenceModes,
    allowedDialogueModes: policy.allowedDialogueModes,
    motionPresetFallback: createMotionPresetFallback(state.actionType),
    expressionPresetFallback: createExpressionPresetFallback(state.actionType),
    poseAccessoryFallback: createPoseAccessoryFallback(actionSemantic.supportLevel),
    telemetrySafeSummaryFields: PET_LAYERED_ACTION_TELEMETRY_SAFE_FIELDS,
    realUiCoverage: policy.realUiCoverage,
    privacyRisk: "safe-enum-only"
  });
}

function createPetLayeredActionDecisionCatalog(): Readonly<Record<PetActionStateId, PetLayeredActionDecision>> {
  return Object.freeze(Object.fromEntries(
    PET_ACTION_STATE_IDS.map((stateId) => [stateId, createPetLayeredActionDecision(stateId)])
  )) as Readonly<Record<PetActionStateId, PetLayeredActionDecision>>;
}

export const PET_LAYERED_ACTION_DECISION_IDS = PET_ACTION_STATE_IDS;

export const PET_LAYERED_ACTION_DECISION_CATALOG = createPetLayeredActionDecisionCatalog();

export function getPetLayeredActionDecision(stateId: PetActionStateId): PetLayeredActionDecision {
  return PET_LAYERED_ACTION_DECISION_CATALOG[stateId];
}

export function getPetLayeredActionDecisionForReason(reason: PetActionTriggerReason): PetLayeredActionDecision {
  return getPetLayeredActionDecision(getPetActionStateForReason(reason).stateId);
}

export function listPetLayeredActionDecisions(): readonly PetLayeredActionDecision[] {
  return PET_ACTION_STATE_IDS.map((stateId) => getPetLayeredActionDecision(stateId));
}
