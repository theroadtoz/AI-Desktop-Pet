import type { DialogueModeId } from "./dialogue-style";
import type { PresenceModeId } from "./presence-mode";

export const PROACTIVE_SPEECH_BUBBLE_LINE_CATALOG = {
  startup_presence_ready: "我在这里，慢慢来。",
  startup_presence_soft: "准备好了，陪你一会儿。",
  startup_presence_focus: "先把呼吸放慢一点。",
  idle_presence_soft: "我在旁边，陪你一会儿。",
  idle_presence_default: "需要时叫我就好。",
  idle_presence_focus: "我会安静陪着。",
  idle_presence_quiet: "我轻一点陪你。",
  idle_presence_work: "先处理最小一步。",
  idle_presence_game: "准备好再开始。",
  idle_presence_reading: "这一页慢慢读。",
  mode_presence_focus: "我会放轻声音。",
  mode_presence_work: "工作模式，先稳住。",
  mode_presence_game: "游戏模式，轻松点。",
  mode_presence_reading: "读书模式，慢慢来。"
} as const;

export type ProactiveSpeechBubbleLineId = keyof typeof PROACTIVE_SPEECH_BUBBLE_LINE_CATALOG;

export const PROACTIVE_SPEECH_BUBBLE_REASONS = [
  "startup_presence",
  "idle_presence",
  "mode_presence"
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

export type ProactiveSpeechBubbleSelectionInput = {
  reason: ProactiveSpeechBubbleReason;
  presenceModeId: PresenceModeId;
  dialogueModeId: DialogueModeId;
  tick: number;
};

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

export function selectProactiveSpeechBubbleLineId(input: ProactiveSpeechBubbleSelectionInput): ProactiveSpeechBubbleLineId {
  if (input.reason === "startup_presence") {
    return selectFromList([
      "startup_presence_ready",
      input.presenceModeId === "focus" || input.presenceModeId === "sleep"
        ? "startup_presence_focus"
        : "startup_presence_soft"
    ], input.tick);
  }

  if (input.reason === "mode_presence") {
    if (input.presenceModeId === "focus" || input.presenceModeId === "quiet" || input.presenceModeId === "sleep") {
      return "mode_presence_focus";
    }

    if (input.dialogueModeId === "work") {
      return "mode_presence_work";
    }

    if (input.dialogueModeId === "game") {
      return "mode_presence_game";
    }

    if (input.dialogueModeId === "reading") {
      return "mode_presence_reading";
    }

    return "idle_presence_default";
  }

  if (input.presenceModeId === "focus") {
    return "idle_presence_focus";
  }

  if (input.presenceModeId === "quiet") {
    return "idle_presence_quiet";
  }

  if (input.presenceModeId === "sleep") {
    return "idle_presence_quiet";
  }

  if (input.dialogueModeId === "work") {
    return "idle_presence_work";
  }

  if (input.dialogueModeId === "game") {
    return "idle_presence_game";
  }

  if (input.dialogueModeId === "reading") {
    return "idle_presence_reading";
  }

  return selectFromList(["idle_presence_soft", "idle_presence_default"], input.tick);
}

function selectFromList<T>(items: readonly T[], tick: number): T {
  if (items.length === 0) {
    throw new Error("Cannot select proactive speech bubble line from an empty list");
  }

  const safeTick = Number.isSafeInteger(tick) ? Math.abs(tick) : 0;
  return items[safeTick % items.length] ?? items[0]!;
}
