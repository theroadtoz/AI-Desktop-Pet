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
  "state_local_model_busy"
] as const;

export type PetActionTriggerReason = typeof PET_ACTION_TRIGGER_REASONS[number];

export type PetActionTriggerActionType =
  | "greeting"
  | "listen"
  | "softSmile"
  | "replyThinking"
  | "gameReady"
  | "readingIdle"
  | "workFocus"
  | "doze"
  | "edgeGlance"
  | "flusteredGlance"
  | "replySustain";

export type PetActionTrigger = {
  reason: PetActionTriggerReason;
};

export const PET_ACTION_TRIGGER_ACTION_BY_REASON: Readonly<Record<PetActionTriggerReason, PetActionTriggerActionType>> = {
  chat_opened: "listen",
  chat_input_focus: "listen",
  chat_reply_waiting: "replyThinking",
  pet_edge_settled: "edgeGlance",
  rapid_touch_combo: "flusteredGlance",
  chat_reply_sustain: "replySustain",
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
  state_local_model_busy: "replyThinking"
};

export const PET_EDGE_SETTLED_THRESHOLD_PX = 72;

export function isPetActionTriggerReason(value: unknown): value is PetActionTriggerReason {
  return typeof value === "string" && PET_ACTION_TRIGGER_REASONS.includes(value as PetActionTriggerReason);
}

export function parsePetActionTrigger(value: unknown): PetActionTrigger | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const reason = (value as Partial<PetActionTrigger>).reason;
  return isPetActionTriggerReason(reason) ? { reason } : null;
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
