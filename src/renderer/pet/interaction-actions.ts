import type { EmotionPresentation } from "../../shared/emotion-presentation";

export const PET_INTERACTION_ACTION_TYPES = [
  "appearance",
  "headPat",
  "greeting",
  "thinking",
  "playGame",
  "reading"
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
    weight: 2,
    durationMs: 1_400,
    presentation: { emotion: "happy", intensity: "medium", mode: "micro" }
  },
  {
    type: "thinking",
    weight: 2,
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
  }
];

export function selectRandomPetInteractionAction(
  random: () => number = Math.random,
  actions: readonly PetInteractionAction[] = PET_INTERACTION_ACTIONS
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
