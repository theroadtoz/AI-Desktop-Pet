export const PET_INTERACTION_ACTION_CATALOG = {
  appearance: {
    safeEchoMessage: "刚刚打招呼",
    bodyPoolEligible: false,
    strongAccessory: false,
    defaultDurationMs: 1_600
  },
  headPat: {
    safeEchoMessage: "刚刚摸头",
    bodyPoolEligible: false,
    strongAccessory: false,
    defaultDurationMs: 1_500
  },
  greeting: {
    safeEchoMessage: "刚刚打招呼",
    bodyPoolEligible: true,
    strongAccessory: false,
    defaultDurationMs: 1_400
  },
  thinking: {
    safeEchoMessage: "刚刚思考",
    bodyPoolEligible: true,
    strongAccessory: false,
    defaultDurationMs: 1_800
  },
  playGame: {
    safeEchoMessage: "刚刚玩游戏",
    bodyPoolEligible: true,
    strongAccessory: true,
    defaultDurationMs: 1_700
  },
  reading: {
    safeEchoMessage: "刚刚读书",
    bodyPoolEligible: true,
    strongAccessory: true,
    defaultDurationMs: 1_900
  },
  focus: {
    safeEchoMessage: "刚刚专注",
    bodyPoolEligible: true,
    strongAccessory: false,
    defaultDurationMs: 1_700
  }
};

export const PET_INTERACTION_ACTION_TYPES = Object.keys(PET_INTERACTION_ACTION_CATALOG);
export const PET_BODY_POOL_ACTION_TYPES = PET_INTERACTION_ACTION_TYPES.filter((type) => (
  PET_INTERACTION_ACTION_CATALOG[type].bodyPoolEligible
));
export const PET_STRONG_ACCESSORY_ACTION_TYPES = PET_INTERACTION_ACTION_TYPES.filter((type) => (
  PET_INTERACTION_ACTION_CATALOG[type].strongAccessory
));

export const PET_WINDOW_SHAKE_FEEDBACK_REASON = "window_shake_feedback";
export const PET_WINDOW_SHAKE_SAFE_ECHO_MESSAGE = "刚刚被晃了一下";

export function getPetInteractionActionSafeEchoMessage(type) {
  return PET_INTERACTION_ACTION_CATALOG[type]?.safeEchoMessage ?? null;
}
