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
  curiousTilt: {
    safeEchoMessage: "刚刚好奇地歪了歪头",
    bodyPoolEligible: true,
    strongAccessory: false,
    defaultDurationMs: 1_250
  },
  softSmile: {
    safeEchoMessage: "刚刚微笑",
    bodyPoolEligible: true,
    strongAccessory: false,
    defaultDurationMs: 1_300
  },
  quietNod: {
    safeEchoMessage: "刚刚轻轻应了一下",
    bodyPoolEligible: true,
    strongAccessory: false,
    defaultDurationMs: 1_050
  },
  shySmile: {
    safeEchoMessage: "刚刚浅浅笑了一下",
    bodyPoolEligible: true,
    strongAccessory: false,
    defaultDurationMs: 1_200
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
  gameCheerLite: {
    safeEchoMessage: "刚刚轻轻庆祝了一下",
    bodyPoolEligible: true,
    strongAccessory: true,
    defaultDurationMs: 1_300
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
  readingThink: {
    safeEchoMessage: "刚刚低头想了想",
    bodyPoolEligible: true,
    strongAccessory: true,
    defaultDurationMs: 1_500
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
  sleepySettle: {
    safeEchoMessage: "刚刚安静地放松下来",
    bodyPoolEligible: true,
    strongAccessory: false,
    defaultDurationMs: 1_250
  },
  edgeGlance: {
    safeEchoMessage: "刚刚看向屏幕内侧",
    bodyPoolEligible: true,
    strongAccessory: false,
    defaultDurationMs: 1_250
  },
  flusteredGlance: {
    safeEchoMessage: "刚刚有点害羞地躲了一下",
    bodyPoolEligible: true,
    strongAccessory: false,
    defaultDurationMs: 1_200
  },
  replySustain: {
    safeEchoMessage: "刚刚安静陪着回复",
    bodyPoolEligible: true,
    strongAccessory: false,
    defaultDurationMs: 1_100
  }
};

export const PET_INTERACTION_ACTION_TYPES = Object.keys(PET_INTERACTION_ACTION_CATALOG);
export const PET_BODY_POOL_ACTION_TYPES = PET_INTERACTION_ACTION_TYPES.filter((type) => (
  PET_INTERACTION_ACTION_CATALOG[type].bodyPoolEligible
));
export const PET_STRONG_ACCESSORY_ACTION_TYPES = PET_INTERACTION_ACTION_TYPES.filter((type) => (
  PET_INTERACTION_ACTION_CATALOG[type].strongAccessory
));

export const PET_EXPRESSION_PRESET_CATALOG = {
  dark: {
    expressionName: "dark",
    category: "emotion",
    intensity: "medium",
    allowedPresenceModes: ["default", "focus"],
    allowedDialogueModes: ["default", "work", "reading"],
    suggestedActionTypes: ["thinking", "replyThinking"],
    visualRisk: "needs-visual-check",
    restorePolicy: "restore-persistent-expression"
  },
  staff: {
    expressionName: "staff",
    category: "prop-or-appearance",
    intensity: "high",
    allowedPresenceModes: ["default"],
    allowedDialogueModes: ["default"],
    suggestedActionTypes: ["appearance"],
    visualRisk: "medium",
    restorePolicy: "restore-persistent-expression"
  },
  ghost: {
    expressionName: "ghost",
    category: "uncertain-or-needs-visual-check",
    intensity: "high",
    allowedPresenceModes: ["default"],
    allowedDialogueModes: ["default"],
    suggestedActionTypes: [],
    visualRisk: "needs-visual-check",
    restorePolicy: "restore-persistent-expression"
  },
  angry: {
    expressionName: "angry",
    category: "emotion",
    intensity: "high",
    allowedPresenceModes: ["default"],
    allowedDialogueModes: ["default"],
    suggestedActionTypes: [],
    visualRisk: "medium",
    restorePolicy: "restore-persistent-expression"
  },
  hat: {
    expressionName: "hat",
    category: "prop-or-appearance",
    intensity: "medium",
    allowedPresenceModes: ["default"],
    allowedDialogueModes: ["default"],
    suggestedActionTypes: [],
    visualRisk: "medium",
    restorePolicy: "restore-persistent-expression"
  },
  sad: {
    expressionName: "sad",
    category: "emotion",
    intensity: "high",
    allowedPresenceModes: ["default"],
    allowedDialogueModes: ["default"],
    suggestedActionTypes: [],
    visualRisk: "medium",
    restorePolicy: "restore-persistent-expression"
  },
  bow: {
    expressionName: "bow",
    category: "prop-or-appearance",
    intensity: "medium",
    allowedPresenceModes: ["default"],
    allowedDialogueModes: ["default"],
    suggestedActionTypes: ["greeting"],
    visualRisk: "needs-visual-check",
    restorePolicy: "restore-persistent-expression"
  },
  glasses: {
    expressionName: "glasses",
    category: "prop-or-appearance",
    intensity: "low",
    allowedPresenceModes: ["default", "focus"],
    allowedDialogueModes: ["default", "work", "reading"],
    suggestedActionTypes: ["reading", "readingIdle", "readingThink"],
    visualRisk: "medium",
    restorePolicy: "restore-persistent-expression"
  },
  excited: {
    expressionName: "excited",
    category: "emotion",
    intensity: "high",
    allowedPresenceModes: ["default"],
    allowedDialogueModes: ["default", "game"],
    suggestedActionTypes: ["appearance"],
    visualRisk: "medium",
    restorePolicy: "restore-persistent-expression"
  },
  happy: {
    expressionName: "happy",
    category: "emotion",
    intensity: "medium",
    allowedPresenceModes: ["default", "focus"],
    allowedDialogueModes: ["default", "work", "game", "reading"],
    suggestedActionTypes: ["headPat", "softSmile", "shySmile"],
    visualRisk: "medium",
    restorePolicy: "restore-persistent-expression"
  },
  gestureGame: {
    expressionName: "gestureGame",
    category: "gesture-like",
    intensity: "medium",
    allowedPresenceModes: ["default"],
    allowedDialogueModes: ["game"],
    suggestedActionTypes: ["playGame", "gameReady", "gameCheerLite"],
    visualRisk: "needs-visual-check",
    restorePolicy: "restore-persistent-expression"
  },
  gestureMic: {
    expressionName: "gestureMic",
    category: "gesture-like",
    intensity: "medium",
    allowedPresenceModes: ["default"],
    allowedDialogueModes: ["default"],
    suggestedActionTypes: ["greeting"],
    visualRisk: "needs-visual-check",
    restorePolicy: "restore-persistent-expression"
  }
};

export const PET_EXPRESSION_PRESET_IDS = Object.keys(PET_EXPRESSION_PRESET_CATALOG);

export const PET_ACTION_STATE_CATALOG = {
  idle: {
    triggerReason: "state_idle",
    actionType: "softSmile",
    safeSummaryLabel: "idle soft smile"
  },
  greet: {
    triggerReason: "state_greet",
    actionType: "greeting",
    safeSummaryLabel: "greeting"
  },
  listen: {
    triggerReason: "state_listen",
    actionType: "listen",
    safeSummaryLabel: "listen"
  },
  think: {
    triggerReason: "state_think",
    actionType: "replyThinking",
    safeSummaryLabel: "thinking"
  },
  "reply-sustain": {
    triggerReason: "state_reply_sustain",
    actionType: "replySustain",
    safeSummaryLabel: "reply sustain"
  },
  sleep: {
    triggerReason: "state_sleep",
    actionType: "doze",
    safeSummaryLabel: "sleep doze"
  },
  work: {
    triggerReason: "state_work",
    actionType: "workFocus",
    safeSummaryLabel: "work focus"
  },
  game: {
    triggerReason: "state_game",
    actionType: "gameReady",
    safeSummaryLabel: "game ready"
  },
  read: {
    triggerReason: "state_read",
    actionType: "readingIdle",
    safeSummaryLabel: "reading idle"
  },
  edge: {
    triggerReason: "state_edge",
    actionType: "edgeGlance",
    safeSummaryLabel: "edge glance"
  },
  flustered: {
    triggerReason: "state_flustered",
    actionType: "flusteredGlance",
    safeSummaryLabel: "flustered glance"
  },
  "local-model-busy": {
    triggerReason: "state_local_model_busy",
    actionType: "replyThinking",
    safeSummaryLabel: "local model busy"
  }
};

export const PET_ACTION_STATE_IDS = Object.keys(PET_ACTION_STATE_CATALOG);

export const PET_WINDOW_SHAKE_FEEDBACK_REASON = "window_shake_feedback";
export const PET_WINDOW_SHAKE_SAFE_ECHO_MESSAGE = "刚刚被晃了一下";

export function getPetInteractionActionSafeEchoMessage(type) {
  return PET_INTERACTION_ACTION_CATALOG[type]?.safeEchoMessage ?? null;
}
