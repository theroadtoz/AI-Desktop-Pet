import type { DialogueModeId } from "./dialogue-style";
import type { PetActionTriggerActionType, PetActionTriggerReason } from "./pet-action-trigger";
import type { PresenceModeId } from "./presence-mode";

export const PET_ACTION_STATE_IDS = [
  "idle",
  "greet",
  "listen",
  "think",
  "reply-sustain",
  "sleep",
  "work",
  "game",
  "read",
  "edge",
  "flustered",
  "local-model-busy"
] as const;

export type PetActionStateId = typeof PET_ACTION_STATE_IDS[number];

export type PetActionStateInterruptPolicy = "skip_if_active" | "mode_transition";
export type PetActionStateSupportLevel = "existing_action" | "parameter_composition";

export type PetActionState = {
  stateId: PetActionStateId;
  triggerReason: PetActionTriggerReason;
  actionType: PetActionTriggerActionType;
  priority: number;
  minimumIntervalMs: number;
  interruptPolicy: PetActionStateInterruptPolicy;
  supportLevel: PetActionStateSupportLevel;
  safeSummaryLabel: string;
};

export const PET_ACTION_STATE_CATALOG: Readonly<Record<PetActionStateId, PetActionState>> = {
  idle: {
    stateId: "idle",
    triggerReason: "state_idle",
    actionType: "softSmile",
    priority: 10,
    minimumIntervalMs: 2_500,
    interruptPolicy: "skip_if_active",
    supportLevel: "existing_action",
    safeSummaryLabel: "idle soft smile"
  },
  greet: {
    stateId: "greet",
    triggerReason: "state_greet",
    actionType: "greeting",
    priority: 20,
    minimumIntervalMs: 1_500,
    interruptPolicy: "skip_if_active",
    supportLevel: "existing_action",
    safeSummaryLabel: "greeting"
  },
  listen: {
    stateId: "listen",
    triggerReason: "state_listen",
    actionType: "listen",
    priority: 30,
    minimumIntervalMs: 1_000,
    interruptPolicy: "skip_if_active",
    supportLevel: "parameter_composition",
    safeSummaryLabel: "listen"
  },
  think: {
    stateId: "think",
    triggerReason: "state_think",
    actionType: "replyThinking",
    priority: 40,
    minimumIntervalMs: 900,
    interruptPolicy: "skip_if_active",
    supportLevel: "parameter_composition",
    safeSummaryLabel: "thinking"
  },
  "reply-sustain": {
    stateId: "reply-sustain",
    triggerReason: "state_reply_sustain",
    actionType: "replySustain",
    priority: 35,
    minimumIntervalMs: 1_100,
    interruptPolicy: "skip_if_active",
    supportLevel: "parameter_composition",
    safeSummaryLabel: "reply sustain"
  },
  sleep: {
    stateId: "sleep",
    triggerReason: "state_sleep",
    actionType: "doze",
    priority: 50,
    minimumIntervalMs: 2_000,
    interruptPolicy: "mode_transition",
    supportLevel: "parameter_composition",
    safeSummaryLabel: "sleep doze"
  },
  work: {
    stateId: "work",
    triggerReason: "state_work",
    actionType: "workFocus",
    priority: 30,
    minimumIntervalMs: 1_500,
    interruptPolicy: "mode_transition",
    supportLevel: "parameter_composition",
    safeSummaryLabel: "work focus"
  },
  game: {
    stateId: "game",
    triggerReason: "state_game",
    actionType: "gameReady",
    priority: 30,
    minimumIntervalMs: 1_500,
    interruptPolicy: "mode_transition",
    supportLevel: "existing_action",
    safeSummaryLabel: "game ready"
  },
  read: {
    stateId: "read",
    triggerReason: "state_read",
    actionType: "readingIdle",
    priority: 30,
    minimumIntervalMs: 1_500,
    interruptPolicy: "mode_transition",
    supportLevel: "existing_action",
    safeSummaryLabel: "reading idle"
  },
  edge: {
    stateId: "edge",
    triggerReason: "state_edge",
    actionType: "edgeGlance",
    priority: 25,
    minimumIntervalMs: 900,
    interruptPolicy: "skip_if_active",
    supportLevel: "parameter_composition",
    safeSummaryLabel: "edge glance"
  },
  flustered: {
    stateId: "flustered",
    triggerReason: "state_flustered",
    actionType: "flusteredGlance",
    priority: 45,
    minimumIntervalMs: 1_200,
    interruptPolicy: "skip_if_active",
    supportLevel: "parameter_composition",
    safeSummaryLabel: "flustered glance"
  },
  "local-model-busy": {
    stateId: "local-model-busy",
    triggerReason: "state_local_model_busy",
    actionType: "replyThinking",
    priority: 40,
    minimumIntervalMs: 1_200,
    interruptPolicy: "skip_if_active",
    supportLevel: "parameter_composition",
    safeSummaryLabel: "local model busy"
  }
};

const PET_ACTION_STATE_ID_BY_REASON: Readonly<Record<PetActionTriggerReason, PetActionStateId>> = {
  chat_opened: "listen",
  chat_input_focus: "listen",
  chat_reply_waiting: "think",
  pet_edge_settled: "edge",
  rapid_touch_combo: "flustered",
  chat_reply_sustain: "reply-sustain",
  state_idle: "idle",
  state_greet: "greet",
  state_listen: "listen",
  state_think: "think",
  state_reply_sustain: "reply-sustain",
  state_sleep: "sleep",
  state_work: "work",
  state_game: "game",
  state_read: "read",
  state_edge: "edge",
  state_flustered: "flustered",
  state_local_model_busy: "local-model-busy"
};

export function isPetActionStateId(value: unknown): value is PetActionStateId {
  return typeof value === "string" && PET_ACTION_STATE_IDS.includes(value as PetActionStateId);
}

export function getPetActionState(stateId: PetActionStateId): PetActionState {
  return PET_ACTION_STATE_CATALOG[stateId];
}

export function getPetActionStateForReason(reason: PetActionTriggerReason): PetActionState {
  return getPetActionState(PET_ACTION_STATE_ID_BY_REASON[reason]);
}

export function getPetActionStateActionType(stateId: PetActionStateId): PetActionTriggerActionType {
  return getPetActionState(stateId).actionType;
}

export function selectPetActionStateForModeChange({
  dialogueModeId,
  presenceModeId
}: {
  dialogueModeId?: DialogueModeId | undefined;
  presenceModeId?: PresenceModeId | undefined;
}): PetActionState | null {
  if (presenceModeId === "sleep") {
    return getPetActionState("sleep");
  }

  if (dialogueModeId === "work") {
    return getPetActionState("work");
  }

  if (dialogueModeId === "game") {
    return getPetActionState("game");
  }

  if (dialogueModeId === "reading") {
    return getPetActionState("read");
  }

  if (dialogueModeId === "default") {
    return getPetActionState("idle");
  }

  return null;
}
