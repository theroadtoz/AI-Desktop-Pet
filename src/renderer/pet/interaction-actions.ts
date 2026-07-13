import type { EmotionPresentation } from "../../shared/emotion-presentation";
import type { DialogueModeId } from "../../shared/dialogue-style";
import {
  getPetExpressionPresetExpressionName,
  type PetExpressionPresetId
} from "../../shared/interaction-action-catalog.ts";
import type { PetMotionPresetId } from "../../shared/pet-motion-presets.ts";
import type { PresenceModeId } from "../../shared/presence-mode";

export const PET_INTERACTION_ACTION_TYPES = [
  "appearance",
  "headPat",
  "greeting",
  "listen",
  "curiousTilt",
  "softSmile",
  "quietNod",
  "shySmile",
  "lookAway",
  "thinking",
  "replyThinking",
  "playGame",
  "gameReady",
  "gameCheerLite",
  "reading",
  "readingIdle",
  "readingThink",
  "focus",
  "workFocus",
  "doze",
  "sleepySettle",
  "edgeGlance",
  "flusteredGlance",
  "replySustain"
] as const;

export type PetInteractionActionType = typeof PET_INTERACTION_ACTION_TYPES[number];

export type PetInteractionLookTarget = {
  x: number;
  y: number;
};

export type PetInteractionPoseTarget = {
  bodyAngleX?: number;
  bodyAngleY?: number;
  bodyAngleZ?: number;
  angleZ?: number;
};

export type PetInteractionAction = {
  type: PetInteractionActionType;
  weight: number;
  durationMs: number;
  presentation: EmotionPresentation;
  expressionPresetId?: PetExpressionPresetId;
  expressionName?: string;
  motionPresetId?: PetMotionPresetId;
  accessoryPartIds?: readonly string[];
  lookTarget?: PetInteractionLookTarget;
  poseTarget?: PetInteractionPoseTarget;
};

type TimeoutHandle = ReturnType<typeof setTimeout>;

export type ClickActionScheduler = {
  schedule(): void;
  cancel(): void;
};

export type RapidTouchComboDetector = {
  record(timestampMs: number): boolean;
  reset(): void;
};

type ClickActionSchedulerOptions = {
  delayMs: number;
  trigger(): void;
  setTimeoutFn?: (callback: () => void, delayMs: number) => TimeoutHandle;
  clearTimeoutFn?: (handle: TimeoutHandle) => void;
};

export const PET_INTERACTION_GLOBAL_COOLDOWN_MS = 450;
export const PET_INTERACTION_HEAD_PAT_COOLDOWN_MS = 1_200;
export const PET_INTERACTION_STRONG_ACTION_COOLDOWN_MS = 4_500;
export const PET_WINDOW_SHAKE_LIGHT_FEEDBACK_COOLDOWN_MS = 10_000;
export const PET_RAPID_TOUCH_COMBO_WINDOW_MS = 2_500;
export const PET_RAPID_TOUCH_COMBO_COUNT = 3;

const STRONG_INTERACTION_ACTION_TYPES = new Set<PetInteractionActionType>([
  "playGame",
  "gameReady",
  "gameCheerLite",
  "reading",
  "readingIdle",
  "readingThink"
]);

function useExpressionPreset(expressionPresetId: PetExpressionPresetId): Pick<PetInteractionAction, "expressionPresetId" | "expressionName"> {
  return {
    expressionPresetId,
    expressionName: getPetExpressionPresetExpressionName(expressionPresetId)
  };
}

export type InteractionActionCooldownSkipReason =
  | "active_action"
  | "global_cooldown"
  | "head_pat_cooldown"
  | "same_action_cooldown";

export type WindowShakeLightFeedbackSkipReason =
  | InteractionActionCooldownSkipReason
  | "window_shake_feedback_cooldown";

export type InteractionActionCooldownState = {
  activeType?: PetInteractionActionType | undefined;
  lastActionFinishedAtMs?: number | undefined;
  lastHeadPatFinishedAtMs?: number | undefined;
  strongActionFinishedAtMsByType?: Partial<Record<PetInteractionActionType, number>>;
};

export type WindowShakeLightFeedbackCooldownState = InteractionActionCooldownState & {
  lastWindowShakeFeedbackStartedAtMs?: number | undefined;
};

export const PET_INTERACTION_ACTIONS: readonly PetInteractionAction[] = [
  {
    type: "appearance",
    weight: 1,
    durationMs: 1_600,
    presentation: { emotion: "surprised", intensity: "high", mode: "emphasis" },
    ...useExpressionPreset("excited"),
    accessoryPartIds: ["Part84"]
  },
  {
    type: "headPat",
    weight: 2,
    durationMs: 1_500,
    presentation: { emotion: "happy", intensity: "high", mode: "emphasis" },
    ...useExpressionPreset("happy")
  },
  {
    type: "greeting",
    weight: 3,
    durationMs: 1_400,
    presentation: { emotion: "happy", intensity: "medium", mode: "micro" }
  },
  {
    type: "listen",
    weight: 3,
    durationMs: 1_350,
    presentation: { emotion: "neutral", intensity: "low", mode: "neutral" },
    lookTarget: { x: 0, y: 0.18 }
  },
  {
    type: "curiousTilt",
    weight: 1.1,
    durationMs: 1_250,
    presentation: { emotion: "neutral", intensity: "low", mode: "neutral" },
    lookTarget: { x: 0.22, y: 0.12 },
    poseTarget: { bodyAngleX: 2, bodyAngleZ: -1, angleZ: 2 }
  },
  {
    type: "softSmile",
    weight: 2,
    durationMs: 1_300,
    presentation: { emotion: "happy", intensity: "low", mode: "micro" }
  },
  {
    type: "quietNod",
    weight: 1.1,
    durationMs: 1_050,
    presentation: { emotion: "neutral", intensity: "low", mode: "neutral" },
    lookTarget: { x: 0, y: 0.08 },
    poseTarget: { bodyAngleY: -1.5, bodyAngleZ: 0.8 }
  },
  {
    type: "shySmile",
    weight: 0.6,
    durationMs: 1_200,
    presentation: { emotion: "happy", intensity: "low", mode: "micro" },
    ...useExpressionPreset("happy"),
    lookTarget: { x: -0.22, y: -0.06 },
    poseTarget: { bodyAngleX: -2.5, bodyAngleZ: 1.5, angleZ: -2 }
  },
  {
    type: "lookAway",
    weight: 1,
    durationMs: 1_300,
    presentation: { emotion: "neutral", intensity: "low", mode: "neutral" },
    lookTarget: { x: -0.45, y: 0.02 }
  },
  {
    type: "thinking",
    weight: 2,
    durationMs: 1_800,
    presentation: { emotion: "confused", intensity: "medium", mode: "micro" }
  },
  {
    type: "replyThinking",
    weight: 2,
    durationMs: 1_250,
    presentation: { emotion: "confused", intensity: "low", mode: "micro" },
    lookTarget: { x: 0.18, y: 0.08 }
  },
  {
    type: "playGame",
    weight: 0.8,
    durationMs: 1_700,
    presentation: { emotion: "surprised", intensity: "medium", mode: "micro" },
    ...useExpressionPreset("gestureGame"),
    accessoryPartIds: ["Part17", "Part21"]
  },
  {
    type: "gameReady",
    weight: 0.8,
    durationMs: 1_500,
    presentation: { emotion: "happy", intensity: "medium", mode: "micro" },
    ...useExpressionPreset("gestureGame"),
    accessoryPartIds: ["Part17", "Part21"],
    lookTarget: { x: 0.12, y: 0.05 }
  },
  {
    type: "gameCheerLite",
    weight: 0.7,
    durationMs: 1_300,
    presentation: { emotion: "happy", intensity: "medium", mode: "micro" },
    ...useExpressionPreset("gestureGame"),
    accessoryPartIds: ["Part17", "Part21"],
    lookTarget: { x: 0.18, y: 0.1 },
    poseTarget: { bodyAngleX: 3, bodyAngleZ: -1.5 }
  },
  {
    type: "reading",
    weight: 0.8,
    durationMs: 1_900,
    presentation: { emotion: "neutral", intensity: "low", mode: "neutral" },
    ...useExpressionPreset("glasses"),
    accessoryPartIds: ["Part53"]
  },
  {
    type: "readingIdle",
    weight: 1,
    durationMs: 1_600,
    presentation: { emotion: "neutral", intensity: "low", mode: "neutral" },
    ...useExpressionPreset("glasses"),
    accessoryPartIds: ["Part53"],
    lookTarget: { x: 0, y: -0.12 }
  },
  {
    type: "readingThink",
    weight: 0.9,
    durationMs: 1_500,
    presentation: { emotion: "neutral", intensity: "low", mode: "neutral" },
    ...useExpressionPreset("glasses"),
    accessoryPartIds: ["Part53"],
    lookTarget: { x: -0.08, y: -0.16 },
    poseTarget: { bodyAngleX: -1.5, bodyAngleZ: 0.8 }
  },
  {
    type: "focus",
    weight: 0.8,
    durationMs: 1_700,
    presentation: { emotion: "neutral", intensity: "low", mode: "neutral" }
  },
  {
    type: "workFocus",
    weight: 1,
    durationMs: 1_600,
    presentation: { emotion: "neutral", intensity: "low", mode: "neutral" },
    lookTarget: { x: 0.05, y: 0.1 }
  },
  {
    type: "doze",
    weight: 0.4,
    durationMs: 1_450,
    presentation: { emotion: "neutral", intensity: "low", mode: "neutral" },
    motionPresetId: "yawn-once",
    lookTarget: { x: 0, y: -0.22 }
  },
  {
    type: "sleepySettle",
    weight: 0.5,
    durationMs: 1_250,
    presentation: { emotion: "neutral", intensity: "low", mode: "neutral" },
    lookTarget: { x: 0, y: -0.25 },
    poseTarget: { bodyAngleY: -2, bodyAngleZ: 0.6 }
  },
  {
    type: "edgeGlance",
    weight: 0.8,
    durationMs: 1_250,
    presentation: { emotion: "neutral", intensity: "low", mode: "neutral" },
    lookTarget: { x: 0.38, y: 0.02 },
    poseTarget: { bodyAngleX: 4, bodyAngleZ: -2 }
  },
  {
    type: "flusteredGlance",
    weight: 0.7,
    durationMs: 1_200,
    presentation: { emotion: "surprised", intensity: "low", mode: "micro" },
    lookTarget: { x: -0.36, y: -0.12 },
    poseTarget: { bodyAngleX: -5, bodyAngleZ: 3, angleZ: -4 }
  },
  {
    type: "replySustain",
    weight: 0.7,
    durationMs: 1_100,
    presentation: { emotion: "neutral", intensity: "low", mode: "neutral" },
    lookTarget: { x: 0.08, y: 0.04 },
    poseTarget: { bodyAngleX: 1.5, bodyAngleZ: -1 }
  }
];

export const PET_RANDOM_INTERACTION_ACTIONS: readonly PetInteractionAction[] = PET_INTERACTION_ACTIONS.filter((action) => (
  action.type !== "appearance" && action.type !== "headPat"
));

const MODE_RANDOM_INTERACTION_ACTION_WEIGHTS: Readonly<Record<DialogueModeId, Readonly<Partial<Record<PetInteractionActionType, number>>>>> = {
  default: {
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
  },
  work: {
    greeting: 1.5,
    listen: 3,
    curiousTilt: 1.8,
    softSmile: 1,
    quietNod: 1.8,
    shySmile: 0.3,
    lookAway: 0.8,
    thinking: 3,
    replyThinking: 3.5,
    playGame: 0.2,
    gameReady: 0.2,
    gameCheerLite: 0.1,
    reading: 0.8,
    readingIdle: 1.2,
    readingThink: 1.5,
    focus: 2.5,
    workFocus: 4,
    doze: 0.2,
    sleepySettle: 0.3,
    edgeGlance: 0.6,
    flusteredGlance: 0.4,
    replySustain: 2.2
  },
  game: {
    greeting: 2,
    listen: 1.5,
    curiousTilt: 0.8,
    softSmile: 2,
    quietNod: 0.6,
    shySmile: 0.8,
    lookAway: 0.8,
    thinking: 1,
    replyThinking: 0.8,
    playGame: 3,
    gameReady: 4,
    gameCheerLite: 2.4,
    reading: 0.2,
    readingIdle: 0.3,
    readingThink: 0.2,
    focus: 0,
    workFocus: 0,
    doze: 0,
    sleepySettle: 0,
    edgeGlance: 0.5,
    flusteredGlance: 1.2,
    replySustain: 0.4
  },
  reading: {
    greeting: 1.2,
    listen: 2,
    curiousTilt: 1.2,
    softSmile: 1.2,
    quietNod: 1.4,
    shySmile: 0.3,
    lookAway: 0.8,
    thinking: 1.5,
    replyThinking: 1.8,
    playGame: 0.2,
    gameReady: 0.2,
    gameCheerLite: 0.1,
    reading: 3,
    readingIdle: 4,
    readingThink: 3.2,
    focus: 1.5,
    workFocus: 1.2,
    doze: 0.3,
    sleepySettle: 0.4,
    edgeGlance: 0.5,
    flusteredGlance: 0.4,
    replySustain: 1.2
  }
};

export function getRandomPetInteractionActionsForMode(modeId: DialogueModeId): readonly PetInteractionAction[] {
  const weights = MODE_RANDOM_INTERACTION_ACTION_WEIGHTS[modeId];

  return PET_RANDOM_INTERACTION_ACTIONS.map((action) => ({
    ...action,
    weight: weights[action.type] ?? action.weight
  }));
}

export function getPresenceFilteredPetInteractionActions(
  actions: readonly PetInteractionAction[],
  presenceModeId: PresenceModeId
): readonly PetInteractionAction[] {
  if (presenceModeId === "default") {
    return actions;
  }

  if (presenceModeId === "focus") {
    return actions.map((action) => {
      if (action.type === "playGame" || action.type === "gameReady" || action.type === "gameCheerLite") {
        return { ...action, weight: 0 };
      }

      if (
        action.type === "reading" ||
        action.type === "readingIdle" ||
        action.type === "readingThink" ||
        action.type === "focus" ||
        action.type === "workFocus" ||
        action.type === "curiousTilt" ||
        action.type === "quietNod" ||
        action.type === "thinking" ||
        action.type === "replyThinking" ||
        action.type === "replySustain" ||
        action.type === "listen"
      ) {
        return { ...action, weight: Math.max(action.weight, 1) };
      }

      return action;
    });
  }

  const allowedTypes = presenceModeId === "quiet"
    ? new Set<PetInteractionActionType>([
      "greeting",
      "listen",
      "curiousTilt",
      "softSmile",
      "quietNod",
      "shySmile",
      "lookAway",
      "thinking",
      "replyThinking",
      "focus",
      "workFocus",
      "doze",
      "sleepySettle",
      "edgeGlance",
      "flusteredGlance",
      "replySustain"
    ])
    : new Set<PetInteractionActionType>(["thinking", "replyThinking", "replySustain", "focus", "workFocus", "doze", "sleepySettle"]);

  return actions
    .filter((action) => allowedTypes.has(action.type))
    .map((action) => ({
      ...action,
      weight: action.type === "focus" ||
      action.type === "workFocus" ||
      action.type === "quietNod" ||
      action.type === "sleepySettle" ||
      action.type === "thinking" ||
        action.type === "replyThinking" ||
        action.type === "replySustain" ||
        action.type === "doze"
        ? Math.max(action.weight, 1)
        : action.weight
    }));
}

export function isStrongInteractionAction(type: PetInteractionActionType): boolean {
  return STRONG_INTERACTION_ACTION_TYPES.has(type);
}

function isWithinCooldown(nowMs: number, lastFinishedAtMs: number | undefined, cooldownMs: number): boolean {
  return lastFinishedAtMs !== undefined && nowMs - lastFinishedAtMs < cooldownMs;
}

export function getInteractionActionCooldownSkipReason(
  action: PetInteractionAction,
  nowMs: number,
  state: InteractionActionCooldownState
): InteractionActionCooldownSkipReason | null {
  if (state.activeType) {
    return "active_action";
  }

  if (action.type === "headPat" && isWithinCooldown(nowMs, state.lastHeadPatFinishedAtMs, PET_INTERACTION_HEAD_PAT_COOLDOWN_MS)) {
    return "head_pat_cooldown";
  }

  if (
    isStrongInteractionAction(action.type) &&
    isWithinCooldown(
      nowMs,
      state.strongActionFinishedAtMsByType?.[action.type],
      PET_INTERACTION_STRONG_ACTION_COOLDOWN_MS
    )
  ) {
    return "same_action_cooldown";
  }

  if (isWithinCooldown(nowMs, state.lastActionFinishedAtMs, PET_INTERACTION_GLOBAL_COOLDOWN_MS)) {
    return "global_cooldown";
  }

  return null;
}

export function getWindowShakeLightFeedbackSkipReason(
  action: PetInteractionAction,
  nowMs: number,
  state: WindowShakeLightFeedbackCooldownState
): WindowShakeLightFeedbackSkipReason | null {
  const interactionSkipReason = getInteractionActionCooldownSkipReason(action, nowMs, state);

  if (interactionSkipReason) {
    return interactionSkipReason;
  }

  if (isWithinCooldown(
    nowMs,
    state.lastWindowShakeFeedbackStartedAtMs,
    PET_WINDOW_SHAKE_LIGHT_FEEDBACK_COOLDOWN_MS
  )) {
    return "window_shake_feedback_cooldown";
  }

  return null;
}

export function getPetInteractionAction(type: PetInteractionActionType): PetInteractionAction {
  const action = PET_INTERACTION_ACTIONS.find((candidate) => candidate.type === type);

  if (!action) {
    throw new Error(`pet interaction action not found: ${type}`);
  }

  return action;
}

export function selectRandomPetInteractionAction(
  random: () => number = Math.random,
  actions: readonly PetInteractionAction[] = PET_RANDOM_INTERACTION_ACTIONS
): PetInteractionAction {
  if (actions.length === 0) {
    throw new Error("pet interaction action manifest is empty");
  }

  const totalWeight = actions.reduce((total, action) => total + Math.max(0, action.weight), 0);

  if (totalWeight <= 0) {
    throw new Error("pet interaction action manifest has no selectable weight");
  }

  let cursor = Math.min(Math.max(random(), 0), 0.999_999) * totalWeight;

  for (const action of actions) {
    cursor -= Math.max(0, action.weight);

    if (cursor < 0) {
      return action;
    }
  }

  const fallback = actions[actions.length - 1];

  if (!fallback) {
    throw new Error("pet interaction action manifest is empty");
  }

  return fallback;
}

export function createClickActionScheduler({
  delayMs,
  trigger,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout
}: ClickActionSchedulerOptions): ClickActionScheduler {
  let pendingTimer: TimeoutHandle | null = null;

  function cancel(): void {
    if (pendingTimer === null) {
      return;
    }

    clearTimeoutFn(pendingTimer);
    pendingTimer = null;
  }

  return {
    schedule(): void {
      cancel();
      pendingTimer = setTimeoutFn(() => {
        pendingTimer = null;
        trigger();
      }, delayMs);
    },
    cancel
  };
}

export function createRapidTouchComboDetector({
  windowMs = PET_RAPID_TOUCH_COMBO_WINDOW_MS,
  count = PET_RAPID_TOUCH_COMBO_COUNT
}: {
  windowMs?: number;
  count?: number;
} = {}): RapidTouchComboDetector {
  let timestamps: number[] = [];

  return {
    record(timestampMs: number): boolean {
      if (!Number.isFinite(timestampMs)) {
        return false;
      }

      timestamps = timestamps.filter((timestamp) => timestampMs - timestamp <= windowMs);
      timestamps.push(timestampMs);

      if (timestamps.length < count) {
        return false;
      }

      timestamps = [];
      return true;
    },
    reset(): void {
      timestamps = [];
    }
  };
}
