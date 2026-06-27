export type PetInteractionActionSupportLevel =
  | "parameter-composition"
  | "accessory-enhanced";

export type PetInteractionActionSemantic = {
  actionType: string;
  safeEchoMessage: string;
  supportLevel: PetInteractionActionSupportLevel;
  bodyPoolEligible: boolean;
  strongAccessory: boolean;
  startupOnly: boolean;
  headOnly: boolean;
  defaultDurationMs: number;
};

export const PET_INTERACTION_ACTION_CATALOG = {
  appearance: {
    actionType: "appearance",
    safeEchoMessage: "刚刚打招呼",
    supportLevel: "accessory-enhanced",
    bodyPoolEligible: false,
    strongAccessory: false,
    startupOnly: true,
    headOnly: false,
    defaultDurationMs: 1_600
  },
  headPat: {
    actionType: "headPat",
    safeEchoMessage: "刚刚摸头",
    supportLevel: "parameter-composition",
    bodyPoolEligible: false,
    strongAccessory: false,
    startupOnly: false,
    headOnly: true,
    defaultDurationMs: 1_500
  },
  greeting: {
    actionType: "greeting",
    safeEchoMessage: "刚刚打招呼",
    supportLevel: "parameter-composition",
    bodyPoolEligible: true,
    strongAccessory: false,
    startupOnly: false,
    headOnly: false,
    defaultDurationMs: 1_400
  },
  thinking: {
    actionType: "thinking",
    safeEchoMessage: "刚刚思考",
    supportLevel: "parameter-composition",
    bodyPoolEligible: true,
    strongAccessory: false,
    startupOnly: false,
    headOnly: false,
    defaultDurationMs: 1_800
  },
  playGame: {
    actionType: "playGame",
    safeEchoMessage: "刚刚玩游戏",
    supportLevel: "accessory-enhanced",
    bodyPoolEligible: true,
    strongAccessory: true,
    startupOnly: false,
    headOnly: false,
    defaultDurationMs: 1_700
  },
  reading: {
    actionType: "reading",
    safeEchoMessage: "刚刚读书",
    supportLevel: "accessory-enhanced",
    bodyPoolEligible: true,
    strongAccessory: true,
    startupOnly: false,
    headOnly: false,
    defaultDurationMs: 1_900
  },
  focus: {
    actionType: "focus",
    safeEchoMessage: "刚刚专注",
    supportLevel: "parameter-composition",
    bodyPoolEligible: true,
    strongAccessory: false,
    startupOnly: false,
    headOnly: false,
    defaultDurationMs: 1_700
  }
} as const satisfies Record<string, PetInteractionActionSemantic>;

export type PetInteractionActionType = keyof typeof PET_INTERACTION_ACTION_CATALOG;

export const PET_INTERACTION_ACTION_TYPES = Object.keys(PET_INTERACTION_ACTION_CATALOG) as PetInteractionActionType[];

export const PET_BODY_POOL_ACTION_TYPES = PET_INTERACTION_ACTION_TYPES.filter((type) => (
  PET_INTERACTION_ACTION_CATALOG[type].bodyPoolEligible
));

export const PET_STRONG_ACCESSORY_ACTION_TYPES = PET_INTERACTION_ACTION_TYPES.filter((type) => (
  PET_INTERACTION_ACTION_CATALOG[type].strongAccessory
));

export const PET_WINDOW_SHAKE_FEEDBACK_REASON = "window_shake_feedback";
export const PET_WINDOW_SHAKE_FEEDBACK_COOLDOWN_SKIP_REASON = "window_shake_feedback_cooldown";
export const PET_WINDOW_SHAKE_SAFE_ECHO_MESSAGE = "刚刚被晃了一下";

const PET_INTERACTION_ACTION_TYPE_SET = new Set<string>(PET_INTERACTION_ACTION_TYPES);

export function isPetInteractionActionType(value: unknown): value is PetInteractionActionType {
  return typeof value === "string" && PET_INTERACTION_ACTION_TYPE_SET.has(value);
}

export function getPetInteractionActionSemantic(type: PetInteractionActionType): PetInteractionActionSemantic {
  return PET_INTERACTION_ACTION_CATALOG[type];
}

export function getPetInteractionActionSafeEchoMessage(type: unknown): string | null {
  return isPetInteractionActionType(type)
    ? PET_INTERACTION_ACTION_CATALOG[type].safeEchoMessage
    : null;
}

export function getPetWindowMotionFeedbackSafeEchoMessage(result: unknown): string | null {
  return result === "started" ? PET_WINDOW_SHAKE_SAFE_ECHO_MESSAGE : null;
}
