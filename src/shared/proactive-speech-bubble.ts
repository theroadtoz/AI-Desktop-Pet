export const PROACTIVE_SPEECH_BUBBLE_LINE_CATALOG = {
  startup_presence_ready: "我在这里，慢慢来。",
  startup_presence_soft: "准备好了，陪你一会儿。",
  startup_presence_focus: "先把呼吸放慢一点。"
} as const;

export type ProactiveSpeechBubbleLineId = keyof typeof PROACTIVE_SPEECH_BUBBLE_LINE_CATALOG;

export const PROACTIVE_SPEECH_BUBBLE_REASONS = [
  "startup_presence"
] as const;

export type ProactiveSpeechBubbleReason = typeof PROACTIVE_SPEECH_BUBBLE_REASONS[number];

export type ProactiveSpeechBubblePayload = {
  lineId: ProactiveSpeechBubbleLineId;
  reason: ProactiveSpeechBubbleReason;
  durationMs: number;
};

export const DEFAULT_PROACTIVE_SPEECH_BUBBLE_LINE_ID: ProactiveSpeechBubbleLineId = "startup_presence_ready";
export const DEFAULT_PROACTIVE_SPEECH_BUBBLE_DURATION_MS = 4_200;
export const MIN_PROACTIVE_SPEECH_BUBBLE_DURATION_MS = 1_000;
export const MAX_PROACTIVE_SPEECH_BUBBLE_DURATION_MS = 10_000;

export function isProactiveSpeechBubbleLineId(value: unknown): value is ProactiveSpeechBubbleLineId {
  return typeof value === "string" && Object.hasOwn(PROACTIVE_SPEECH_BUBBLE_LINE_CATALOG, value);
}

export function isProactiveSpeechBubbleReason(value: unknown): value is ProactiveSpeechBubbleReason {
  return typeof value === "string" &&
    PROACTIVE_SPEECH_BUBBLE_REASONS.includes(value as ProactiveSpeechBubbleReason);
}

export function clampProactiveSpeechBubbleDuration(durationMs: number): number {
  if (!Number.isFinite(durationMs)) {
    return DEFAULT_PROACTIVE_SPEECH_BUBBLE_DURATION_MS;
  }

  return Math.min(
    MAX_PROACTIVE_SPEECH_BUBBLE_DURATION_MS,
    Math.max(MIN_PROACTIVE_SPEECH_BUBBLE_DURATION_MS, Math.round(durationMs))
  );
}

export function getProactiveSpeechBubbleLine(lineId: ProactiveSpeechBubbleLineId): string {
  return PROACTIVE_SPEECH_BUBBLE_LINE_CATALOG[lineId];
}
