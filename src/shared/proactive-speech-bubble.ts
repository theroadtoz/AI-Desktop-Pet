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
  idle_presence_morning: "早上好，我在。",
  idle_presence_afternoon: "下午也慢慢来。",
  idle_presence_evening: "晚上先歇口气。",
  idle_presence_night: "夜深了，轻一点。",
  idle_presence_work_morning: "早上先理一小步。",
  idle_presence_work_afternoon: "下午稳稳推进。",
  idle_presence_reading_evening: "晚点读也可以。",
  idle_presence_reading_night: "夜里慢慢读。",
  idle_presence_game_evening: "晚上玩得轻松点。",
  idle_presence_context_settle: "我先陪你缓缓。",
  idle_presence_history_summary: "长聊我收轻了。",
  idle_presence_memory_safe: "我把记忆轻轻收好。",
  idle_presence_search_citation: "引用线索我收好了。",
  environment_music_started: "有音乐呀，我陪你听一会儿。",
  environment_game_started: "玩得轻松点。",
  environment_returned_from_away: "回来啦，慢慢进入状态。",
  environment_long_work_recovery: "这段辛苦了，先缓一缓。",
  mode_presence_focus: "我会放轻声音。",
  mode_presence_work: "工作模式，先稳住。",
  mode_presence_game: "游戏模式，轻松点。",
  mode_presence_reading: "读书模式，慢慢来。"
} as const;

export type ProactiveSpeechBubbleLineId = keyof typeof PROACTIVE_SPEECH_BUBBLE_LINE_CATALOG;

export const PROACTIVE_SPEECH_BUBBLE_REASONS = [
  "startup_presence",
  "idle_presence",
  "mode_presence",
  "music_presence",
  "game_presence",
  "return_presence",
  "work_recovery",
  "evening_presence",
  "silence_presence",
  "source_presence"
] as const;

export type ProactiveSpeechBubbleReason = typeof PROACTIVE_SPEECH_BUBBLE_REASONS[number];

export const PROACTIVE_SPEECH_BUBBLE_TIME_BANDS = [
  "morning",
  "afternoon",
  "evening",
  "night"
] as const;

export type ProactiveSpeechBubbleTimeBand = typeof PROACTIVE_SPEECH_BUBBLE_TIME_BANDS[number];

export const PROACTIVE_SPEECH_BUBBLE_SAFE_CONTEXT_TAGS = [
  "context_settle",
  "history_summary_safe",
  "memory_safe_pulse",
  "search_citation_pulse"
] as const;

export type ProactiveSpeechBubbleSafeContextTag = typeof PROACTIVE_SPEECH_BUBBLE_SAFE_CONTEXT_TAGS[number];

export type ProactiveSpeechBubblePayload = {
  lineId: ProactiveSpeechBubbleLineId;
  reason: ProactiveSpeechBubbleReason;
  durationMs: number;
};

export type ProactiveSpeechBubbleActivation = Pick<
  ProactiveSpeechBubblePayload,
  "lineId" | "reason"
>;

export const PROACTIVE_BUBBLE_CANDIDATE_IDS = [
  "idle_presence",
  "mode_presence",
  "startup_daily",
  "music_started",
  "explicit_game_started",
  "returned_from_away",
  "long_work_recovery",
  "evening_companion",
  "long_silence",
  "memory_safe",
  "search_citation_safe",
  "history_summary_safe"
] as const;

export type ProactiveBubbleCandidateId = typeof PROACTIVE_BUBBLE_CANDIDATE_IDS[number];

export const DEFAULT_PROACTIVE_SPEECH_BUBBLE_LINE_ID: ProactiveSpeechBubbleLineId = "startup_presence_ready";
export const DEFAULT_PROACTIVE_SPEECH_BUBBLE_DURATION_MS = 4_200;
export const MIN_PROACTIVE_SPEECH_BUBBLE_DURATION_MS = 1_000;
export const MAX_PROACTIVE_SPEECH_BUBBLE_DURATION_MS = 10_000;

export type ProactiveSpeechBubbleSelectionInput = {
  reason: ProactiveSpeechBubbleReason;
  presenceModeId: PresenceModeId;
  dialogueModeId: DialogueModeId;
  tick: number;
  timeBand?: ProactiveSpeechBubbleTimeBand | undefined;
  safeContextTag?: ProactiveSpeechBubbleSafeContextTag | undefined;
};

export function isProactiveSpeechBubbleLineId(value: unknown): value is ProactiveSpeechBubbleLineId {
  return typeof value === "string" && Object.hasOwn(PROACTIVE_SPEECH_BUBBLE_LINE_CATALOG, value);
}

export function isProactiveSpeechBubbleReason(value: unknown): value is ProactiveSpeechBubbleReason {
  return typeof value === "string" &&
    PROACTIVE_SPEECH_BUBBLE_REASONS.includes(value as ProactiveSpeechBubbleReason);
}

export function isProactiveSpeechBubbleTimeBand(value: unknown): value is ProactiveSpeechBubbleTimeBand {
  return typeof value === "string" &&
    PROACTIVE_SPEECH_BUBBLE_TIME_BANDS.includes(value as ProactiveSpeechBubbleTimeBand);
}

export function isProactiveSpeechBubbleSafeContextTag(value: unknown): value is ProactiveSpeechBubbleSafeContextTag {
  return typeof value === "string" &&
    PROACTIVE_SPEECH_BUBBLE_SAFE_CONTEXT_TAGS.includes(value as ProactiveSpeechBubbleSafeContextTag);
}

export function getProactiveSpeechBubbleTimeBand(date: Date): ProactiveSpeechBubbleTimeBand {
  const hour = date.getHours();

  if (hour >= 5 && hour < 12) {
    return "morning";
  }

  if (hour >= 12 && hour < 18) {
    return "afternoon";
  }

  if (hour >= 18 && hour < 22) {
    return "evening";
  }

  return "night";
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

  if (input.safeContextTag === "context_settle") {
    return "idle_presence_context_settle";
  }

  if (input.safeContextTag === "history_summary_safe") {
    return "idle_presence_history_summary";
  }

  if (input.safeContextTag === "memory_safe_pulse") {
    return "idle_presence_memory_safe";
  }

  if (input.safeContextTag === "search_citation_pulse") {
    return "idle_presence_search_citation";
  }

  if (input.dialogueModeId === "work") {
    if (input.timeBand === "morning") {
      return "idle_presence_work_morning";
    }

    if (input.timeBand === "afternoon") {
      return "idle_presence_work_afternoon";
    }

    return "idle_presence_work";
  }

  if (input.dialogueModeId === "game") {
    if (input.timeBand === "evening") {
      return "idle_presence_game_evening";
    }

    return "idle_presence_game";
  }

  if (input.dialogueModeId === "reading") {
    if (input.timeBand === "evening") {
      return "idle_presence_reading_evening";
    }

    if (input.timeBand === "night") {
      return "idle_presence_reading_night";
    }

    return "idle_presence_reading";
  }

  if (input.timeBand === "morning") {
    return "idle_presence_morning";
  }

  if (input.timeBand === "afternoon") {
    return "idle_presence_afternoon";
  }

  if (input.timeBand === "evening") {
    return "idle_presence_evening";
  }

  if (input.timeBand === "night") {
    return "idle_presence_night";
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
