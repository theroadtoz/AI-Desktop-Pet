const PET_VISIBLE_INSET_RATIO = 0.1;
const PET_WAIST_RATIO = 0.58;

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
  "chat_reply_sustain"
] as const;

export type PetActionTriggerReason = typeof PET_ACTION_TRIGGER_REASONS[number];

export type PetActionTriggerActionType =
  | "listen"
  | "replyThinking"
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
  chat_reply_sustain: "replySustain"
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

  const visibleRegion = calculateVisibleRegion(bounds);
  const visibleLeft = bounds.x + visibleRegion.visibleLeft;
  const visibleRight = bounds.x + visibleRegion.visibleRight;
  const visibleTop = bounds.y + visibleRegion.visibleTop;
  const waistY = bounds.y + visibleRegion.waistY;

  return (
    Math.abs(visibleLeft - workArea.x) <= thresholdPx ||
    Math.abs(visibleRight - (workArea.x + workArea.width)) <= thresholdPx ||
    Math.abs(visibleTop - workArea.y) <= thresholdPx ||
    Math.abs(waistY - (workArea.y + workArea.height)) <= thresholdPx
  );
}

function calculateVisibleRegion(bounds: Pick<PetActionTriggerWindowBounds, "width" | "height">): {
  visibleLeft: number;
  visibleRight: number;
  visibleTop: number;
  waistY: number;
} {
  const visibleLeft = bounds.width * PET_VISIBLE_INSET_RATIO;
  const visibleRight = bounds.width * (1 - PET_VISIBLE_INSET_RATIO);
  const visibleTop = bounds.height * PET_VISIBLE_INSET_RATIO;
  const visibleBottom = bounds.height * (1 - PET_VISIBLE_INSET_RATIO);

  return {
    visibleLeft,
    visibleRight,
    visibleTop,
    waistY: visibleTop + (visibleBottom - visibleTop) * PET_WAIST_RATIO
  };
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
