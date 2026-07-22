import { PET_WAIST_BOTTOM_OVERHANG_PX, calculatePetVisibleRegion } from "./pet-presentation.ts";

export type PetActionTriggerWindowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export const PET_ACTION_TRIGGER_REASONS = [
  "chat_opened",
  "chat_input_focus",
  "chat_reply_waiting",
  "pet_edge_settled",
  "rapid_touch_combo",
  "chat_reply_sustain",
  "chat_reply_completed",
  "state_music_playing_stable",
  "state_game_presence_stable",
  "return_from_idle",
  "evening_companion_tick",
  "long_work_session_complete",
  "state_idle",
  "state_greet",
  "state_listen",
  "state_think",
  "state_reply_sustain",
  "state_sleep",
  "state_work",
  "state_game",
  "state_read",
  "state_edge",
  "state_flustered",
  "state_local_model_busy",
  "state_memory_injected",
  "state_memory_skipped",
  "state_search_cited",
  "state_proactive_bubble_visible"
] as const;

export type PetActionTriggerReason = typeof PET_ACTION_TRIGGER_REASONS[number];
export const PET_ACTION_TRIGGER_REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
export const PET_ACTION_TRIGGER_SUPERSESSION_POLICIES = ["replace_active"] as const;
export type PetActionTriggerSupersessionPolicy = typeof PET_ACTION_TRIGGER_SUPERSESSION_POLICIES[number];
export const PET_ACTION_TRIGGER_ORIGIN = "main_dispatch" as const;

export type PetActionTriggerActionType =
  | "greeting"
  | "listen"
  | "softSmile"
  | "quietNod"
  | "replyThinking"
  | "gameReady"
  | "readingIdle"
  | "workFocus"
  | "doze"
  | "edgeGlance"
  | "flusteredGlance"
  | "replySustain"
  | "dialogueOpenWelcome"
  | "replyWarmSettle"
  | "musicListenSway"
  | "gamePresenceGlance"
  | "returnFromIdle"
  | "eveningWindowGlance"
  | "longWorkRecovery"
  | "searchNoteSettle";

export type PetActionTriggerPayload = {
  reason: PetActionTriggerReason;
  requestId?: string;
  supersessionPolicy?: PetActionTriggerSupersessionPolicy;
};

export type PetActionTrigger = PetActionTriggerPayload & {
  origin: typeof PET_ACTION_TRIGGER_ORIGIN;
};

export const PET_ACTION_TRIGGER_ACTION_BY_REASON: Readonly<Record<PetActionTriggerReason, PetActionTriggerActionType>> = {
  chat_opened: "dialogueOpenWelcome",
  chat_input_focus: "listen",
  chat_reply_waiting: "replyThinking",
  pet_edge_settled: "edgeGlance",
  rapid_touch_combo: "flusteredGlance",
  chat_reply_sustain: "replySustain",
  chat_reply_completed: "replyWarmSettle",
  state_music_playing_stable: "musicListenSway",
  state_game_presence_stable: "gamePresenceGlance",
  return_from_idle: "returnFromIdle",
  evening_companion_tick: "eveningWindowGlance",
  long_work_session_complete: "longWorkRecovery",
  state_idle: "softSmile",
  state_greet: "greeting",
  state_listen: "listen",
  state_think: "replyThinking",
  state_reply_sustain: "replySustain",
  state_sleep: "doze",
  state_work: "workFocus",
  state_game: "gameReady",
  state_read: "readingIdle",
  state_edge: "edgeGlance",
  state_flustered: "flusteredGlance",
  state_local_model_busy: "replyThinking",
  state_memory_injected: "quietNod",
  state_memory_skipped: "quietNod",
  state_search_cited: "searchNoteSettle",
  state_proactive_bubble_visible: "softSmile"
};

export const PET_EDGE_SETTLED_THRESHOLD_PX = 72;

export function isPetActionTriggerReason(value: unknown): value is PetActionTriggerReason {
  return typeof value === "string" && PET_ACTION_TRIGGER_REASONS.includes(value as PetActionTriggerReason);
}

export function isPetActionTriggerRequestId(value: unknown): value is string {
  return typeof value === "string" && PET_ACTION_TRIGGER_REQUEST_ID_PATTERN.test(value);
}

export function isPetActionTriggerSupersessionPolicy(
  value: unknown
): value is PetActionTriggerSupersessionPolicy {
  return typeof value === "string" && PET_ACTION_TRIGGER_SUPERSESSION_POLICIES.includes(
    value as PetActionTriggerSupersessionPolicy
  );
}

export function parsePetActionTrigger(value: unknown): PetActionTrigger | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const trigger = value as Partial<PetActionTrigger>;
  if (Object.hasOwn(trigger, "origin")) {
    return null;
  }
  if (!isPetActionTriggerReason(trigger.reason)) {
    return null;
  }

  if (trigger.requestId === undefined && trigger.supersessionPolicy === undefined) {
    return { reason: trigger.reason, origin: PET_ACTION_TRIGGER_ORIGIN };
  }

  if (!isPetActionTriggerRequestId(trigger.requestId)) {
    return null;
  }
  if (trigger.supersessionPolicy === undefined) {
    return {
      reason: trigger.reason,
      requestId: trigger.requestId,
      origin: PET_ACTION_TRIGGER_ORIGIN
    };
  }

  return trigger.reason === "chat_opened" &&
    isPetActionTriggerSupersessionPolicy(trigger.supersessionPolicy)
    ? {
        reason: trigger.reason,
        requestId: trigger.requestId,
        supersessionPolicy: trigger.supersessionPolicy,
        origin: PET_ACTION_TRIGGER_ORIGIN
      }
    : null;
}

export function getPetActionTriggerActionType(reason: PetActionTriggerReason): PetActionTriggerActionType {
  return PET_ACTION_TRIGGER_ACTION_BY_REASON[reason];
}

export function isPetNearWorkAreaEdge(
  bounds: PetActionTriggerWindowBounds,
  workArea: PetActionTriggerWindowBounds,
  thresholdPx = PET_EDGE_SETTLED_THRESHOLD_PX
): boolean {
  if (!isFiniteBounds(bounds) || !isFiniteBounds(workArea) || !Number.isFinite(thresholdPx) || thresholdPx < 0) {
    return false;
  }

  const visibleRegion = calculatePetVisibleRegion(bounds);
  const visibleLeft = bounds.x + visibleRegion.visibleLeft;
  const visibleRight = bounds.x + visibleRegion.visibleRight;
  const visibleTop = bounds.y + visibleRegion.visibleTop;
  const waistY = bounds.y + visibleRegion.waistY;
  const workAreaBottom = workArea.y + workArea.height;
  const isNearBottomEdge = (
    waistY >= workAreaBottom - thresholdPx &&
    waistY <= workAreaBottom + PET_WAIST_BOTTOM_OVERHANG_PX + thresholdPx
  );

  return (
    Math.abs(visibleLeft - workArea.x) <= thresholdPx ||
    Math.abs(visibleRight - (workArea.x + workArea.width)) <= thresholdPx ||
    Math.abs(visibleTop - workArea.y) <= thresholdPx ||
    isNearBottomEdge
  );
}

function isFiniteBounds(bounds: PetActionTriggerWindowBounds): boolean {
  return (
    Number.isFinite(bounds.x) &&
    Number.isFinite(bounds.y) &&
    Number.isFinite(bounds.width) &&
    Number.isFinite(bounds.height) &&
    bounds.width > 0 &&
    bounds.height > 0
  );
}
