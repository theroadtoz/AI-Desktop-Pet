import { DIALOGUE_MODE_VIEWS, type DialogueModeId } from "./dialogue-style.ts";
import {
  PET_ACTION_STATE_IDS,
  type PetActionStateId
} from "./pet-action-state-machine.ts";
import { getPetLayeredActionDecision } from "./pet-layered-action-decision.ts";
import {
  PROACTIVE_SPEECH_BUBBLE_REASONS,
  type ProactiveSpeechBubbleReason
} from "./proactive-speech-bubble.ts";
import { PRESENCE_MODE_VIEWS, type PresenceModeId } from "./presence-mode.ts";

export type DailyCompanionSignalKind =
  | "chat-reply"
  | "long-chat-compression"
  | "memory-injection"
  | "memory-consolidation"
  | "sensitive-skip"
  | "search-citation"
  | "proactive-bubble";

export type DailyStateCadenceTier = "immediate" | "ambient" | "low-frequency";
export type DailyStateInterruptPolicy = "normal" | "low-interruption" | "suppressed";
export type DailyStateRealUiCoverage =
  | "p2-30-daily-companion-contextual-rhythm"
  | "p2-31d-layered-action-matrix"
  | "p2-31e2-expression-state-future-safe-states"
  | "p2-34-companion-presence-idle-mode-cadence"
  | "p2-48-history-summary-proactive-bubble-safety"
  | "focused-tests-only";
export type DailyStatePrivacyRisk = "safe-enum-only";

export type LowFrequencyCompanionEventId =
  | "idle-presence-check"
  | "mode-presence-echo"
  | "context-settle"
  | "history-summary-pulse"
  | "memory-safe-pulse"
  | "search-citation-pulse";

export type DailyStateOrchestrationRule = {
  ruleId: string;
  dialogueModeId: DialogueModeId;
  presenceModeId: PresenceModeId;
  allowedActionStateIds: readonly PetActionStateId[];
  allowedBubbleReasons: readonly ProactiveSpeechBubbleReason[];
  dailySignalKinds: readonly DailyCompanionSignalKind[];
  lowFrequencyEventIds: readonly LowFrequencyCompanionEventId[];
  cadenceTier: DailyStateCadenceTier;
  interruptPolicy: DailyStateInterruptPolicy;
  safeSummaryLabel: string;
  realUiCoverage: readonly DailyStateRealUiCoverage[];
  privacyRisk: DailyStatePrivacyRisk;
};

export type LowFrequencyCompanionEvent = {
  eventId: LowFrequencyCompanionEventId;
  bubbleReason: ProactiveSpeechBubbleReason;
  actionStateId: PetActionStateId;
  minimumIntervalMs: number;
  allowedPresenceModes: readonly PresenceModeId[];
  allowedDialogueModes: readonly DialogueModeId[];
  cadenceTier: "low-frequency";
  interruptPolicy: Exclude<DailyStateInterruptPolicy, "suppressed">;
  safeSummaryLabel: string;
  realUiCoverage: readonly DailyStateRealUiCoverage[];
  privacyRisk: DailyStatePrivacyRisk;
};

export type LowFrequencyCompanionEventSelectionInput = {
  dialogueModeId: DialogueModeId;
  presenceModeId: PresenceModeId;
  tick: number;
  elapsedSinceLastEventMs?: number | undefined;
  allowedEventIds?: readonly LowFrequencyCompanionEventId[] | undefined;
};

const ALL_DIALOGUE_MODE_IDS = DIALOGUE_MODE_VIEWS.map((mode) => mode.id);
const NON_SLEEP_PRESENCE_MODE_IDS = PRESENCE_MODE_VIEWS
  .map((mode) => mode.id)
  .filter((modeId) => modeId !== "sleep");
const LOW_INTERRUPTION_PRESENCE_MODE_IDS = ["focus", "quiet"] as const satisfies readonly PresenceModeId[];

const DAILY_SIGNAL_KINDS = [
  "chat-reply",
  "long-chat-compression",
  "memory-injection",
  "memory-consolidation",
  "sensitive-skip",
  "search-citation",
  "proactive-bubble"
] as const satisfies readonly DailyCompanionSignalKind[];

const LOW_FREQUENCY_COMPANION_EVENTS = Object.freeze([
  {
    eventId: "idle-presence-check",
    bubbleReason: "idle_presence",
    actionStateId: "proactive-bubble-visible",
    minimumIntervalMs: 20 * 60 * 1_000,
    allowedPresenceModes: ["default"],
    allowedDialogueModes: ALL_DIALOGUE_MODE_IDS,
    cadenceTier: "low-frequency",
    interruptPolicy: "normal",
    safeSummaryLabel: "idle presence check",
    realUiCoverage: ["p2-34-companion-presence-idle-mode-cadence"],
    privacyRisk: "safe-enum-only"
  },
  {
    eventId: "mode-presence-echo",
    bubbleReason: "mode_presence",
    actionStateId: "proactive-bubble-visible",
    minimumIntervalMs: 30 * 60 * 1_000,
    allowedPresenceModes: NON_SLEEP_PRESENCE_MODE_IDS,
    allowedDialogueModes: ["work", "game", "reading"],
    cadenceTier: "low-frequency",
    interruptPolicy: "low-interruption",
    safeSummaryLabel: "mode presence echo",
    realUiCoverage: ["p2-34-companion-presence-idle-mode-cadence"],
    privacyRisk: "safe-enum-only"
  },
  {
    eventId: "context-settle",
    bubbleReason: "idle_presence",
    actionStateId: "idle",
    minimumIntervalMs: 35 * 60 * 1_000,
    allowedPresenceModes: NON_SLEEP_PRESENCE_MODE_IDS,
    allowedDialogueModes: ALL_DIALOGUE_MODE_IDS,
    cadenceTier: "low-frequency",
    interruptPolicy: "low-interruption",
    safeSummaryLabel: "context settle",
    realUiCoverage: ["p2-30-daily-companion-contextual-rhythm"],
    privacyRisk: "safe-enum-only"
  },
  {
    eventId: "history-summary-pulse",
    bubbleReason: "idle_presence",
    actionStateId: "proactive-bubble-visible",
    minimumIntervalMs: 60 * 60 * 1_000,
    allowedPresenceModes: ["default"],
    allowedDialogueModes: ALL_DIALOGUE_MODE_IDS,
    cadenceTier: "low-frequency",
    interruptPolicy: "normal",
    safeSummaryLabel: "context compression pulse",
    realUiCoverage: ["p2-48-history-summary-proactive-bubble-safety"],
    privacyRisk: "safe-enum-only"
  },
  {
    eventId: "memory-safe-pulse",
    bubbleReason: "idle_presence",
    actionStateId: "memory-injected",
    minimumIntervalMs: 60 * 60 * 1_000,
    allowedPresenceModes: ["default"],
    allowedDialogueModes: ALL_DIALOGUE_MODE_IDS,
    cadenceTier: "low-frequency",
    interruptPolicy: "normal",
    safeSummaryLabel: "memory safe pulse",
    realUiCoverage: ["p2-31e2-expression-state-future-safe-states"],
    privacyRisk: "safe-enum-only"
  },
  {
    eventId: "search-citation-pulse",
    bubbleReason: "idle_presence",
    actionStateId: "search-cited",
    minimumIntervalMs: 60 * 60 * 1_000,
    allowedPresenceModes: ["default"],
    allowedDialogueModes: ALL_DIALOGUE_MODE_IDS,
    cadenceTier: "low-frequency",
    interruptPolicy: "normal",
    safeSummaryLabel: "search citation pulse",
    realUiCoverage: ["p2-31e2-expression-state-future-safe-states"],
    privacyRisk: "safe-enum-only"
  }
] as const satisfies readonly LowFrequencyCompanionEvent[]);

const DAILY_STATE_ORCHESTRATION_RULES = Object.freeze(
  DIALOGUE_MODE_VIEWS.flatMap((dialogueMode) => (
    PRESENCE_MODE_VIEWS.map((presenceMode) => createDailyStateOrchestrationRule(
      dialogueMode.id,
      presenceMode.id
    ))
  ))
);

export function listDailyStateOrchestrationRules(): readonly DailyStateOrchestrationRule[] {
  return DAILY_STATE_ORCHESTRATION_RULES;
}

export function listLowFrequencyCompanionEvents(): readonly LowFrequencyCompanionEvent[] {
  return LOW_FREQUENCY_COMPANION_EVENTS;
}

export function selectLowFrequencyCompanionEvent(
  input: LowFrequencyCompanionEventSelectionInput
): LowFrequencyCompanionEvent | null {
  if (input.presenceModeId === "sleep") {
    return null;
  }

  const candidates = LOW_FREQUENCY_COMPANION_EVENTS.filter((event) => (
    (!input.allowedEventIds || includesLowFrequencyCompanionEventId(input.allowedEventIds, event.eventId)) &&
    includesPresenceMode(event.allowedPresenceModes, input.presenceModeId) &&
    includesDialogueMode(event.allowedDialogueModes, input.dialogueModeId) &&
    (input.presenceModeId === "default" || event.interruptPolicy === "low-interruption") &&
    (input.elapsedSinceLastEventMs === undefined || input.elapsedSinceLastEventMs >= event.minimumIntervalMs)
  ));

  if (candidates.length === 0) {
    return null;
  }

  return candidates[safeTick(input.tick) % candidates.length] ?? candidates[0]!;
}

function createDailyStateOrchestrationRule(
  dialogueModeId: DialogueModeId,
  presenceModeId: PresenceModeId
): DailyStateOrchestrationRule {
  const lowFrequencyEventIds = LOW_FREQUENCY_COMPANION_EVENTS
    .filter((event) => (
      includesPresenceMode(event.allowedPresenceModes, presenceModeId) &&
      includesDialogueMode(event.allowedDialogueModes, dialogueModeId) &&
      (presenceModeId === "default" || event.interruptPolicy === "low-interruption")
    ))
    .map((event) => event.eventId);

  return Object.freeze({
    ruleId: `daily-state:${dialogueModeId}:${presenceModeId}`,
    dialogueModeId,
    presenceModeId,
    allowedActionStateIds: PET_ACTION_STATE_IDS.filter((stateId) => {
      const decision = getPetLayeredActionDecision(stateId);
      return (
        decision.allowedPresenceModes.includes(presenceModeId) &&
        decision.allowedDialogueModes.includes(dialogueModeId)
      );
    }),
    allowedBubbleReasons: presenceModeId === "sleep" ? [] : PROACTIVE_SPEECH_BUBBLE_REASONS,
    dailySignalKinds: DAILY_SIGNAL_KINDS,
    lowFrequencyEventIds,
    cadenceTier: presenceModeId === "sleep" ? "ambient" : "low-frequency",
    interruptPolicy: presenceModeId === "sleep"
      ? "suppressed"
      : LOW_INTERRUPTION_PRESENCE_MODE_IDS.includes(presenceModeId as typeof LOW_INTERRUPTION_PRESENCE_MODE_IDS[number])
        ? "low-interruption"
        : "normal",
    safeSummaryLabel: `daily state ${dialogueModeId} ${presenceModeId}`,
    realUiCoverage: [
      "p2-30-daily-companion-contextual-rhythm",
      "p2-31d-layered-action-matrix",
      "p2-34-companion-presence-idle-mode-cadence"
    ],
    privacyRisk: "safe-enum-only"
  } satisfies DailyStateOrchestrationRule);
}

function safeTick(tick: number): number {
  return Number.isSafeInteger(tick) ? Math.abs(tick) : 0;
}

function includesPresenceMode(
  modeIds: readonly PresenceModeId[],
  modeId: PresenceModeId
): boolean {
  return modeIds.includes(modeId);
}

function includesDialogueMode(
  modeIds: readonly DialogueModeId[],
  modeId: DialogueModeId
): boolean {
  return modeIds.includes(modeId);
}

function includesLowFrequencyCompanionEventId(
  eventIds: readonly LowFrequencyCompanionEventId[],
  eventId: LowFrequencyCompanionEventId
): boolean {
  return eventIds.includes(eventId);
}
