import type { DialogueModeId } from "./dialogue-style";
import type { PresenceModeId } from "./presence-mode";

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
  listen: {
    actionType: "listen",
    safeEchoMessage: "刚刚倾听",
    supportLevel: "parameter-composition",
    bodyPoolEligible: true,
    strongAccessory: false,
    startupOnly: false,
    headOnly: false,
    defaultDurationMs: 1_350
  },
  curiousTilt: {
    actionType: "curiousTilt",
    safeEchoMessage: "刚刚好奇地歪了歪头",
    supportLevel: "parameter-composition",
    bodyPoolEligible: true,
    strongAccessory: false,
    startupOnly: false,
    headOnly: false,
    defaultDurationMs: 1_250
  },
  softSmile: {
    actionType: "softSmile",
    safeEchoMessage: "刚刚微笑",
    supportLevel: "parameter-composition",
    bodyPoolEligible: true,
    strongAccessory: false,
    startupOnly: false,
    headOnly: false,
    defaultDurationMs: 1_300
  },
  quietNod: {
    actionType: "quietNod",
    safeEchoMessage: "刚刚轻轻应了一下",
    supportLevel: "parameter-composition",
    bodyPoolEligible: true,
    strongAccessory: false,
    startupOnly: false,
    headOnly: false,
    defaultDurationMs: 1_050
  },
  shySmile: {
    actionType: "shySmile",
    safeEchoMessage: "刚刚浅浅笑了一下",
    supportLevel: "parameter-composition",
    bodyPoolEligible: true,
    strongAccessory: false,
    startupOnly: false,
    headOnly: false,
    defaultDurationMs: 1_200
  },
  lookAway: {
    actionType: "lookAway",
    safeEchoMessage: "刚刚移开视线",
    supportLevel: "parameter-composition",
    bodyPoolEligible: true,
    strongAccessory: false,
    startupOnly: false,
    headOnly: false,
    defaultDurationMs: 1_300
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
  replyThinking: {
    actionType: "replyThinking",
    safeEchoMessage: "刚刚轻声思考",
    supportLevel: "parameter-composition",
    bodyPoolEligible: true,
    strongAccessory: false,
    startupOnly: false,
    headOnly: false,
    defaultDurationMs: 1_250
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
  gameReady: {
    actionType: "gameReady",
    safeEchoMessage: "刚刚准备游戏",
    supportLevel: "accessory-enhanced",
    bodyPoolEligible: true,
    strongAccessory: true,
    startupOnly: false,
    headOnly: false,
    defaultDurationMs: 1_500
  },
  gameCheerLite: {
    actionType: "gameCheerLite",
    safeEchoMessage: "刚刚轻轻庆祝了一下",
    supportLevel: "accessory-enhanced",
    bodyPoolEligible: true,
    strongAccessory: true,
    startupOnly: false,
    headOnly: false,
    defaultDurationMs: 1_300
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
  readingIdle: {
    actionType: "readingIdle",
    safeEchoMessage: "刚刚安静读书",
    supportLevel: "accessory-enhanced",
    bodyPoolEligible: true,
    strongAccessory: true,
    startupOnly: false,
    headOnly: false,
    defaultDurationMs: 1_600
  },
  readingThink: {
    actionType: "readingThink",
    safeEchoMessage: "刚刚低头想了想",
    supportLevel: "accessory-enhanced",
    bodyPoolEligible: true,
    strongAccessory: true,
    startupOnly: false,
    headOnly: false,
    defaultDurationMs: 1_500
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
  },
  workFocus: {
    actionType: "workFocus",
    safeEchoMessage: "刚刚进入专注",
    supportLevel: "parameter-composition",
    bodyPoolEligible: true,
    strongAccessory: false,
    startupOnly: false,
    headOnly: false,
    defaultDurationMs: 1_600
  },
  doze: {
    actionType: "doze",
    safeEchoMessage: "刚刚小憩",
    supportLevel: "parameter-composition",
    bodyPoolEligible: true,
    strongAccessory: false,
    startupOnly: false,
    headOnly: false,
    defaultDurationMs: 1_450
  },
  sleepySettle: {
    actionType: "sleepySettle",
    safeEchoMessage: "刚刚安静地放松下来",
    supportLevel: "parameter-composition",
    bodyPoolEligible: true,
    strongAccessory: false,
    startupOnly: false,
    headOnly: false,
    defaultDurationMs: 1_250
  },
  edgeGlance: {
    actionType: "edgeGlance",
    safeEchoMessage: "刚刚看向屏幕内侧",
    supportLevel: "parameter-composition",
    bodyPoolEligible: true,
    strongAccessory: false,
    startupOnly: false,
    headOnly: false,
    defaultDurationMs: 1_250
  },
  flusteredGlance: {
    actionType: "flusteredGlance",
    safeEchoMessage: "刚刚有点害羞地躲了一下",
    supportLevel: "parameter-composition",
    bodyPoolEligible: true,
    strongAccessory: false,
    startupOnly: false,
    headOnly: false,
    defaultDurationMs: 1_200
  },
  replySustain: {
    actionType: "replySustain",
    safeEchoMessage: "刚刚安静陪着回复",
    supportLevel: "parameter-composition",
    bodyPoolEligible: true,
    strongAccessory: false,
    startupOnly: false,
    headOnly: false,
    defaultDurationMs: 1_100
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

export type PetExpressionPresetCategory =
  | "emotion"
  | "micro-expression"
  | "gesture-like"
  | "prop-or-appearance"
  | "uncertain-or-needs-visual-check";

export type PetExpressionPresetIntensity = "low" | "medium" | "high";
export type PetExpressionPresetVisualRisk = "low" | "medium" | "needs-visual-check";
export type PetExpressionPresetRestorePolicy = "restore-persistent-expression";

export type PetExpressionPresetSemantic = {
  presetId: string;
  expressionName: string;
  category: PetExpressionPresetCategory;
  intensity: PetExpressionPresetIntensity;
  allowedPresenceModes: readonly PresenceModeId[];
  allowedDialogueModes: readonly DialogueModeId[];
  suggestedActionTypes: readonly PetInteractionActionType[];
  visualRisk: PetExpressionPresetVisualRisk;
  restorePolicy: PetExpressionPresetRestorePolicy;
};

export const PET_EXPRESSION_PRESET_CATALOG = {
  dark: {
    presetId: "dark",
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
    presetId: "staff",
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
    presetId: "ghost",
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
    presetId: "angry",
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
    presetId: "hat",
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
    presetId: "sad",
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
    presetId: "bow",
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
    presetId: "glasses",
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
    presetId: "excited",
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
    presetId: "happy",
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
    presetId: "gestureGame",
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
    presetId: "gestureMic",
    expressionName: "gestureMic",
    category: "gesture-like",
    intensity: "medium",
    allowedPresenceModes: ["default"],
    allowedDialogueModes: ["default"],
    suggestedActionTypes: ["greeting"],
    visualRisk: "needs-visual-check",
    restorePolicy: "restore-persistent-expression"
  }
} as const satisfies Record<string, PetExpressionPresetSemantic>;

export type PetExpressionPresetId = keyof typeof PET_EXPRESSION_PRESET_CATALOG;

const PET_EXPRESSION_PRESET_ID_SET = new Set<string>(Object.keys(PET_EXPRESSION_PRESET_CATALOG));

export function isPetExpressionPresetId(value: unknown): value is PetExpressionPresetId {
  return typeof value === "string" && PET_EXPRESSION_PRESET_ID_SET.has(value);
}

export function getPetExpressionPresetExpressionName(presetId: PetExpressionPresetId): string {
  return PET_EXPRESSION_PRESET_CATALOG[presetId].expressionName;
}

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
