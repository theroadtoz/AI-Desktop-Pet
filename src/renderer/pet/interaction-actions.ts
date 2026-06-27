import type { EmotionPresentation } from "../../shared/emotion-presentation";
import type { DialogueModeId } from "../../shared/dialogue-style";
import type { PresenceModeId } from "../../shared/presence-mode";

export const PET_INTERACTION_ACTION_TYPES = [
  "appearance",
  "headPat",
  "greeting",
  "thinking",
  "playGame",
  "reading",
  "focus"
] as const;

export type PetInteractionActionType = typeof PET_INTERACTION_ACTION_TYPES[number];

export type PetInteractionAction = {
  type: PetInteractionActionType;
  weight: number;
  durationMs: number;
  presentation: EmotionPresentation;
  expressionName?: string;
  accessoryPartIds?: readonly string[];
};

type TimeoutHandle = ReturnType<typeof setTimeout>;

export type ClickActionScheduler = {
  schedule(): void;
  cancel(): void;
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

const STRONG_INTERACTION_ACTION_TYPES = new Set<PetInteractionActionType>(["playGame", "reading"]);

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
    expressionName: "excited",
    accessoryPartIds: ["Part84"]
  },
  {
    type: "headPat",
    weight: 2,
    durationMs: 1_500,
    presentation: { emotion: "happy", intensity: "high", mode: "emphasis" },
    expressionName: "happy"
  },
  {
    type: "greeting",
    weight: 4,
    durationMs: 1_400,
    presentation: { emotion: "happy", intensity: "medium", mode: "micro" }
  },
  {
    type: "thinking",
    weight: 3,
    durationMs: 1_800,
    presentation: { emotion: "confused", intensity: "medium", mode: "micro" }
  },
  {
    type: "playGame",
    weight: 1,
    durationMs: 1_700,
    presentation: { emotion: "surprised", intensity: "medium", mode: "micro" },
    expressionName: "gestureGame",
    accessoryPartIds: ["Part17", "Part21"]
  },
  {
    type: "reading",
    weight: 1,
    durationMs: 1_900,
    presentation: { emotion: "neutral", intensity: "low", mode: "neutral" },
    expressionName: "glasses",
    accessoryPartIds: ["Part53"]
  },
  {
    type: "focus",
    weight: 0.5,
    durationMs: 1_700,
    presentation: { emotion: "neutral", intensity: "low", mode: "neutral" }
  }
];

export const PET_RANDOM_INTERACTION_ACTIONS: readonly PetInteractionAction[] = PET_INTERACTION_ACTIONS.filter((action) => (
  action.type !== "appearance" && action.type !== "headPat"
));

const MODE_RANDOM_INTERACTION_ACTION_WEIGHTS: Readonly<Record<DialogueModeId, Readonly<Partial<Record<PetInteractionActionType, number>>>>> = {
  default: {
    greeting: 4,
    thinking: 3,
    playGame: 1,
    reading: 1,
    focus: 0.5
  },
  work: {
    greeting: 2,
    thinking: 4,
    playGame: 0.5,
    reading: 1,
    focus: 3
  },
  game: {
    greeting: 3,
    thinking: 1,
    playGame: 4,
    reading: 0.5,
    focus: 0
  },
  reading: {
    greeting: 2,
    thinking: 2,
    playGame: 0.5,
    reading: 4,
    focus: 1
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
      if (action.type === "playGame") {
        return { ...action, weight: 0 };
      }

      if (action.type === "reading" || action.type === "focus" || action.type === "thinking") {
        return { ...action, weight: Math.max(action.weight, 1) };
      }

      return action;
    });
  }

  const allowedTypes = presenceModeId === "quiet"
    ? new Set<PetInteractionActionType>(["greeting", "thinking", "focus"])
    : new Set<PetInteractionActionType>(["thinking", "focus"]);

  return actions
    .filter((action) => allowedTypes.has(action.type))
    .map((action) => ({
      ...action,
      weight: action.type === "focus" || action.type === "thinking"
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
