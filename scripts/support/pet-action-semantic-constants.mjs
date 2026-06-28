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
  listen: {
    safeEchoMessage: "刚刚倾听",
    bodyPoolEligible: true,
    strongAccessory: false,
    defaultDurationMs: 1_350
  },
  softSmile: {
    safeEchoMessage: "刚刚微笑",
    bodyPoolEligible: true,
    strongAccessory: false,
    defaultDurationMs: 1_300
  },
  lookAway: {
    safeEchoMessage: "刚刚移开视线",
    bodyPoolEligible: true,
    strongAccessory: false,
    defaultDurationMs: 1_300
  },
  thinking: {
    safeEchoMessage: "刚刚思考",
    bodyPoolEligible: true,
    strongAccessory: false,
    defaultDurationMs: 1_800
  },
  replyThinking: {
    safeEchoMessage: "刚刚轻声思考",
    bodyPoolEligible: true,
    strongAccessory: false,
    defaultDurationMs: 1_250
  },
  playGame: {
    safeEchoMessage: "刚刚玩游戏",
    bodyPoolEligible: true,
    strongAccessory: true,
    defaultDurationMs: 1_700
  },
  gameReady: {
    safeEchoMessage: "刚刚准备游戏",
    bodyPoolEligible: true,
    strongAccessory: true,
    defaultDurationMs: 1_500
  },
  reading: {
    safeEchoMessage: "刚刚读书",
    bodyPoolEligible: true,
    strongAccessory: true,
    defaultDurationMs: 1_900
  },
  readingIdle: {
    safeEchoMessage: "刚刚安静读书",
    bodyPoolEligible: true,
    strongAccessory: true,
    defaultDurationMs: 1_600
  },
  focus: {
    safeEchoMessage: "刚刚专注",
    bodyPoolEligible: true,
    strongAccessory: false,
    defaultDurationMs: 1_700
  },
  workFocus: {
    safeEchoMessage: "刚刚进入专注",
    bodyPoolEligible: true,
    strongAccessory: false,
    defaultDurationMs: 1_600
  },
  doze: {
    safeEchoMessage: "刚刚小憩",
    bodyPoolEligible: true,
    strongAccessory: false,
    defaultDurationMs: 1_450
  },
  edgeGlance: {
    safeEchoMessage: "刚刚看向屏幕内侧",
    bodyPoolEligible: true,
    strongAccessory: false,
    defaultDurationMs: 1_250
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
