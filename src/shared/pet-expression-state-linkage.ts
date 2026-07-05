import type { DialogueModeId } from "./dialogue-style.ts";
import {
  PET_EXPRESSION_PRESET_CATALOG,
  type PetExpressionPresetId,
  type PetExpressionPresetIntensity,
  type PetExpressionPresetRestorePolicy,
  type PetExpressionPresetVisualRisk
} from "./interaction-action-catalog.ts";
import {
  PET_ACTION_STATE_IDS,
  type PetActionStateId,
  type PetActionStateInterruptPolicy
} from "./pet-action-state-machine.ts";
import {
  PET_LAYERED_ACTION_DECISION_CATALOG,
  type PetLayeredActionRealUiCoverage
} from "./pet-layered-action-decision.ts";
import type { PresenceModeId } from "./presence-mode.ts";

export type PetExpressionStateLinkageFallbackPolicy = "presentation-only";
export type PetExpressionStateLinkagePrivacyRisk = "safe-enum-only";
export type PetExpressionStateLinkageStatus = "selected" | "presentation-only" | "blocked";
export type PetExpressionStateLinkageBlockReason =
  | "presence-mode-blocked"
  | "dialogue-mode-blocked";
export type PetExpressionStateLinkageVisualRisk = PetExpressionPresetVisualRisk | "none";
export type PetExpressionStateLinkageRestorePolicy =
  | PetExpressionPresetRestorePolicy
  | "no-expression-change";

type PetExpressionStateLinkagePresetRole =
  | "baseExpressionPresetId"
  | "microExpressionPresetId"
  | "strongExpressionPresetId";

type PetExpressionStateLinkageProfile = {
  baseExpressionPresetId?: PetExpressionPresetId;
  microExpressionPresetId?: PetExpressionPresetId;
  strongExpressionPresetId?: PetExpressionPresetId;
  minDurationMs: number;
  maxDurationMs: number;
  cooldownMs?: number;
};

export type PetExpressionStateLinkagePolicy = {
  stateId: PetActionStateId;
  baseExpressionPresetId?: PetExpressionPresetId;
  microExpressionPresetId?: PetExpressionPresetId;
  strongExpressionPresetId?: PetExpressionPresetId;
  minDurationMs: number;
  maxDurationMs: number;
  minimumIntervalMs: number;
  cooldownMs: number;
  restorePolicy: PetExpressionPresetRestorePolicy;
  allowedPresenceModes: readonly PresenceModeId[];
  allowedDialogueModes: readonly DialogueModeId[];
  interruptPolicy: PetActionStateInterruptPolicy;
  fallbackPolicy: PetExpressionStateLinkageFallbackPolicy;
  visualRisk: PetExpressionStateLinkageVisualRisk;
  realUiCoverage: readonly PetLayeredActionRealUiCoverage[];
  privacyRisk: PetExpressionStateLinkagePrivacyRisk;
};

export type PetExpressionStateLinkageResolveInput = {
  stateId: PetActionStateId;
  dialogueModeId: DialogueModeId;
  presenceModeId: PresenceModeId;
};

export type PetExpressionStateLinkageSelectedResolution = {
  stateId: PetActionStateId;
  status: "selected";
  expressionPresetId: PetExpressionPresetId;
  durationMs: number;
  cooldownMs: number;
  restorePolicy: PetExpressionPresetRestorePolicy;
  visualRisk: PetExpressionPresetVisualRisk;
};

export type PetExpressionStateLinkagePresentationOnlyResolution = {
  stateId: PetActionStateId;
  status: "presentation-only";
  durationMs: number;
  cooldownMs: number;
  restorePolicy: "no-expression-change";
  visualRisk: "none";
};

export type PetExpressionStateLinkageBlockedResolution = {
  stateId: PetActionStateId;
  status: "blocked";
  blockReason: PetExpressionStateLinkageBlockReason;
  durationMs: 0;
  cooldownMs: number;
  restorePolicy: "no-expression-change";
  visualRisk: "none";
};

export type PetExpressionStateLinkageResolution =
  | PetExpressionStateLinkageSelectedResolution
  | PetExpressionStateLinkagePresentationOnlyResolution
  | PetExpressionStateLinkageBlockedResolution;

const PET_EXPRESSION_STATE_LINKAGE_PROFILE_BY_STATE = {
  idle: {
    baseExpressionPresetId: "happy",
    minDurationMs: 900,
    maxDurationMs: 1_300
  },
  greet: {
    baseExpressionPresetId: "bow",
    microExpressionPresetId: "gestureMic",
    minDurationMs: 900,
    maxDurationMs: 1_400
  },
  listen: {
    microExpressionPresetId: "happy",
    minDurationMs: 800,
    maxDurationMs: 1_200
  },
  think: {
    baseExpressionPresetId: "dark",
    minDurationMs: 900,
    maxDurationMs: 1_500
  },
  "reply-sustain": {
    microExpressionPresetId: "happy",
    minDurationMs: 900,
    maxDurationMs: 1_200
  },
  sleep: {
    minDurationMs: 0,
    maxDurationMs: 0
  },
  work: {
    baseExpressionPresetId: "glasses",
    minDurationMs: 1_000,
    maxDurationMs: 1_600
  },
  game: {
    baseExpressionPresetId: "gestureGame",
    strongExpressionPresetId: "excited",
    minDurationMs: 1_100,
    maxDurationMs: 1_500,
    cooldownMs: 2_200
  },
  read: {
    baseExpressionPresetId: "glasses",
    microExpressionPresetId: "dark",
    minDurationMs: 1_000,
    maxDurationMs: 1_600
  },
  edge: {
    minDurationMs: 0,
    maxDurationMs: 0
  },
  flustered: {
    baseExpressionPresetId: "happy",
    minDurationMs: 900,
    maxDurationMs: 1_200,
    cooldownMs: 1_800
  },
  "local-model-busy": {
    baseExpressionPresetId: "dark",
    minDurationMs: 900,
    maxDurationMs: 1_400
  }
} as const satisfies Readonly<Record<PetActionStateId, PetExpressionStateLinkageProfile>>;

const PRESET_ROLES = [
  "baseExpressionPresetId",
  "microExpressionPresetId",
  "strongExpressionPresetId"
] as const satisfies readonly PetExpressionStateLinkagePresetRole[];

const VISUAL_RISK_ORDER: Readonly<Record<PetExpressionStateLinkageVisualRisk, number>> = {
  none: 0,
  low: 1,
  medium: 2,
  "needs-visual-check": 3
};

export const PET_EXPRESSION_STATE_LINKAGE_POLICY_IDS = PET_ACTION_STATE_IDS;

function clampDurationMs(durationMs: number, minDurationMs: number, maxDurationMs: number): number {
  return Math.min(maxDurationMs, Math.max(minDurationMs, durationMs));
}

function allowsMode<T extends string>(values: readonly T[], value: T): boolean {
  return values.includes(value);
}

function allowsPresenceIntensity(presenceModeId: PresenceModeId, intensity: PetExpressionPresetIntensity): boolean {
  return presenceModeId === "quiet" || presenceModeId === "sleep"
    ? intensity === "low"
    : true;
}

function getPolicyPresetIds(profile: PetExpressionStateLinkageProfile): readonly PetExpressionPresetId[] {
  return PRESET_ROLES
    .map((role) => profile[role])
    .filter((presetId): presetId is PetExpressionPresetId => presetId !== undefined);
}

function getPolicyVisualRisk(profile: PetExpressionStateLinkageProfile): PetExpressionStateLinkageVisualRisk {
  return getPolicyPresetIds(profile)
    .map((presetId) => PET_EXPRESSION_PRESET_CATALOG[presetId].visualRisk)
    .reduce<PetExpressionStateLinkageVisualRisk>((highestRisk, visualRisk) => (
      VISUAL_RISK_ORDER[visualRisk] > VISUAL_RISK_ORDER[highestRisk] ? visualRisk : highestRisk
    ), "none");
}

function createPetExpressionStateLinkagePolicy(stateId: PetActionStateId): PetExpressionStateLinkagePolicy {
  const profile: PetExpressionStateLinkageProfile = PET_EXPRESSION_STATE_LINKAGE_PROFILE_BY_STATE[stateId];
  const decision = PET_LAYERED_ACTION_DECISION_CATALOG[stateId];

  return Object.freeze({
    stateId,
    ...(profile.baseExpressionPresetId !== undefined
      ? { baseExpressionPresetId: profile.baseExpressionPresetId }
      : {}),
    ...(profile.microExpressionPresetId !== undefined
      ? { microExpressionPresetId: profile.microExpressionPresetId }
      : {}),
    ...(profile.strongExpressionPresetId !== undefined
      ? { strongExpressionPresetId: profile.strongExpressionPresetId }
      : {}),
    minDurationMs: profile.minDurationMs,
    maxDurationMs: profile.maxDurationMs,
    minimumIntervalMs: decision.minimumIntervalMs,
    cooldownMs: Math.max(profile.cooldownMs ?? decision.minimumIntervalMs, decision.minimumIntervalMs),
    restorePolicy: "restore-persistent-expression",
    allowedPresenceModes: decision.allowedPresenceModes,
    allowedDialogueModes: decision.allowedDialogueModes,
    interruptPolicy: decision.interruptPolicy,
    fallbackPolicy: "presentation-only",
    visualRisk: getPolicyVisualRisk(profile),
    realUiCoverage: decision.realUiCoverage,
    privacyRisk: "safe-enum-only"
  });
}

function createPetExpressionStateLinkagePolicyCatalog(): Readonly<Record<PetActionStateId, PetExpressionStateLinkagePolicy>> {
  return Object.freeze(Object.fromEntries(
    PET_ACTION_STATE_IDS.map((stateId) => [stateId, createPetExpressionStateLinkagePolicy(stateId)])
  )) as Readonly<Record<PetActionStateId, PetExpressionStateLinkagePolicy>>;
}

function createPresentationOnlyResolution(policy: PetExpressionStateLinkagePolicy): PetExpressionStateLinkagePresentationOnlyResolution {
  return {
    stateId: policy.stateId,
    status: "presentation-only",
    durationMs: clampDurationMs(0, policy.minDurationMs, policy.maxDurationMs),
    cooldownMs: policy.cooldownMs,
    restorePolicy: "no-expression-change",
    visualRisk: "none"
  };
}

function createBlockedResolution(
  policy: PetExpressionStateLinkagePolicy,
  blockReason: PetExpressionStateLinkageBlockReason
): PetExpressionStateLinkageBlockedResolution {
  return {
    stateId: policy.stateId,
    status: "blocked",
    blockReason,
    durationMs: 0,
    cooldownMs: policy.cooldownMs,
    restorePolicy: "no-expression-change",
    visualRisk: "none"
  };
}

function selectExpressionPresetId(
  policy: PetExpressionStateLinkagePolicy,
  dialogueModeId: DialogueModeId,
  presenceModeId: PresenceModeId
): PetExpressionPresetId | null {
  for (const role of PRESET_ROLES) {
    const presetId = policy[role];
    if (presetId === undefined) {
      continue;
    }

    const preset = PET_EXPRESSION_PRESET_CATALOG[presetId];
    if (
      allowsMode(preset.allowedDialogueModes, dialogueModeId) &&
      allowsMode(preset.allowedPresenceModes, presenceModeId) &&
      allowsPresenceIntensity(presenceModeId, preset.intensity)
    ) {
      return presetId;
    }
  }

  return null;
}

export const PET_EXPRESSION_STATE_LINKAGE_POLICY_CATALOG = createPetExpressionStateLinkagePolicyCatalog();

export function getPetExpressionStateLinkagePolicy(stateId: PetActionStateId): PetExpressionStateLinkagePolicy {
  return PET_EXPRESSION_STATE_LINKAGE_POLICY_CATALOG[stateId];
}

export function listPetExpressionStateLinkagePolicies(): readonly PetExpressionStateLinkagePolicy[] {
  return PET_ACTION_STATE_IDS.map((stateId) => getPetExpressionStateLinkagePolicy(stateId));
}

export function resolvePetExpressionStateLinkage({
  stateId,
  dialogueModeId,
  presenceModeId
}: PetExpressionStateLinkageResolveInput): PetExpressionStateLinkageResolution {
  const policy = getPetExpressionStateLinkagePolicy(stateId);
  if (!allowsMode(policy.allowedPresenceModes, presenceModeId)) {
    return createBlockedResolution(policy, "presence-mode-blocked");
  }

  if (!allowsMode(policy.allowedDialogueModes, dialogueModeId)) {
    return createBlockedResolution(policy, "dialogue-mode-blocked");
  }

  const expressionPresetId = selectExpressionPresetId(policy, dialogueModeId, presenceModeId);
  if (expressionPresetId === null) {
    return createPresentationOnlyResolution(policy);
  }

  const preset = PET_EXPRESSION_PRESET_CATALOG[expressionPresetId];
  const decision = PET_LAYERED_ACTION_DECISION_CATALOG[stateId];

  return {
    stateId,
    status: "selected",
    expressionPresetId,
    durationMs: clampDurationMs(decision.actionDefaultDurationMs, policy.minDurationMs, policy.maxDurationMs),
    cooldownMs: policy.cooldownMs,
    restorePolicy: preset.restorePolicy,
    visualRisk: preset.visualRisk
  };
}
