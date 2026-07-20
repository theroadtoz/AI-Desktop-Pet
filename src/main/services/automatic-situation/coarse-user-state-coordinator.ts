import type {
  CompanionEnvironmentActivity,
  CompanionEnvironmentInterruptibility,
  CompanionEnvironmentMedia,
  CompanionEnvironmentSnapshot,
  CompanionEnvironmentTimeBand
} from "../desktop-context/companion-environment";

export type ExplicitGameContextMessageIntent = "start" | "end-or-correct" | "none";
export type CoarseUserEngagement = "allowed" | "defer" | "suppressed" | "unknown";

export type CoarseUserState = {
  activity: CompanionEnvironmentActivity;
  interruptibility: CompanionEnvironmentInterruptibility;
  media: CompanionEnvironmentMedia;
  timeBand: CompanionEnvironmentTimeBand;
  explicitGameContext: "active" | "inactive" | "unknown";
  engagement: CoarseUserEngagement;
};

export type CoarseUserStateCoordinator = {
  getState(): CoarseUserState;
  subscribe(listener: (state: CoarseUserState) => void): () => void;
  updateEnvironment(snapshot: CompanionEnvironmentSnapshot): CoarseUserState;
  handleUserMessage(text: string): ExplicitGameContextMessageIntent;
  setExplicitGameContextEnabled(enabled: boolean): CoarseUserState;
  tick(): CoarseUserState;
  dispose(): void;
};

export const EXPLICIT_GAME_CONTEXT_TTL_MS = 10 * 60_000;
const MAX_EXPLICIT_GAME_MESSAGE_LENGTH = 1_000;

const GAME_TOPIC_ONLY_PATTERNS = [
  /(?:开发(?:一款)?游戏|游戏(?:开发|新闻|评测|评论|攻略|世界观|设计|文档))/u,
  /\bgame\s+(?:development|news|review|reviews|design|documentation|story|lore)\b/iu
] as const;

const END_OR_CORRECT_PATTERNS = [
  /(?:^|[\s，。！？、；：,.!?;:])(?:我|我们|咱|咱们)(?:已经|现在|刚刚|刚才)?(?:不玩|没在玩|没有在玩|不打)(?:游戏|了)?/u,
  /(?:^|[\s，。！？、；：,.!?;:])(?:我|我们|咱|咱们)(?:的)?(?:游戏|对局|排位|匹配|副本|开黑)(?:已经)?(?:结束|完了|打完|玩完)(?:了)?/u,
  /^(?:游戏|对局|排位|匹配|副本|开黑)(?:已经)?(?:结束|完了|打完|玩完)(?:了)?[\s，。！？,.!]*$/u,
  /(?:^|[\s，。！？、；：,.!?;:])(?:我|我们|咱|咱们)(?:已经)?(?:退出|退了|关了)(?:游戏|对局)?/u,
  /^(?:刚才|刚刚)(?:并)?不是在玩(?:游戏)?[\s，。！？,.!]*$/u,
  /(?:^|[\s，。！？、；：,.!?;:])(?:我|我们|咱|咱们)(?:刚才|刚刚)(?:并)?不是在玩(?:游戏)?/u,
  /(?:我|我们|咱|咱们)[^。！？.!?]{0,160}[，,；;:：](?:但|不过|可是)?(?:刚才|刚刚)(?:并)?不是在玩(?:游戏)?/u,
  /(?:别|不要)按(?:我)?(?:正在)?(?:玩游戏|游戏状态)(?:来|处理|判断)?/u,
  /\b(?:i(?:'m| am) not|we(?:'re| are) not|i wasn'?t|we weren'?t) (?:playing|gaming)\b/iu,
  /\b(?:i|we) (?:stopped|finished|quit|am done|are done) (?:playing|gaming|the game)\b/iu,
  /^(?:the )?(?:game|match) is over[\s.!?]*$/iu,
  /\b(?:do not|don't) treat (?:this|me) as (?:gaming|a game state)\b/iu,
  /\b(?:i|we) (?:am|are) no longer (?:playing|gaming)\b/iu
] as const;

const START_PATTERNS = [
  /(?:^|[\s，。！？、；：,.!?;:])(?:但|不过|可是)?(?:我|我们|咱|咱们)(?:现在|此刻|这会儿|目前|马上|待会儿|等会儿|一会儿|接下来|已经|还)?(?:正(?:在)?|在|还在|已经在|准备(?:要|去)?|打算(?:去)?|马上(?:要|去)?|就要|要去|继续)(?:现在|马上|待会儿|等会儿|一会儿|接下来)?(?:开始|继续|一起|去)?(?:玩(?:游戏|一局(?:游戏)?)|打(?:游戏|一局(?:游戏)?|排位|匹配|副本)|开黑|排位|匹配|开一局(?:游戏)?|来一局(?:游戏)?|进游戏|上游戏)/u,
  /(?:^|[\s，。！？、；：,.!?;:])(?:现在|此刻|这会儿|目前|马上|待会儿|等会儿|一会儿|接下来)(?:正(?:在)?|在|准备(?:要|去)?|打算(?:去)?|马上(?:要|去)?|就要|要去|继续)(?:开始|继续|一起|去)?(?:玩(?:游戏|一局(?:游戏)?)|打(?:游戏|一局(?:游戏)?|排位|匹配|副本)|开黑|排位|匹配|开一局(?:游戏)?|来一局(?:游戏)?|进游戏|上游戏)/u,
  /(?:^|[\s，。！？、；：,.!?;:])(?:我|我们|咱|咱们)(?:现在|此刻|这会儿|目前|已经|还)?(?:正(?:在)?|在|还在|已经在)?(?:游戏|对局|排位|匹配|副本|开黑)(?:中|里|内)(?:$|[\s，。！？、；：,.!?;:])/u,
  /^(?:现在|此刻|这会儿|目前|正(?:在)?|还在|已经在)?(?:游戏|对局|排位|匹配|副本|开黑)(?:中|里|内)(?:了|呢)?[\s，。！？,.!]*$/u,
  /\b(?:i(?:'m| am)|we(?:'re| are))\s+(?:(?:currently|now)\s+)?(?:gaming|playing\s+(?:a|the)\s+(?:game|match)|in\s+(?:a\s+|the\s+)?(?:game|match|queue|lobby))\b/iu,
  /\b(?:i(?:'m| am)|we(?:'re| are))\s+(?:about to|going to|getting ready to|planning to)\s+(?:(?:start|resume|play)\s+(?:a|the)\s+(?:game|match)|game|queue\s+(?:for\s+)?(?:a|the)\s+(?:game|match))\b/iu,
  /\b(?:i|we)\s+(?:will|want to|plan to)\s+(?:(?:play|start|resume)\s+(?:a|the)\s+(?:game|match)|queue\s+(?:for\s+)?(?:a|the)\s+(?:game|match))\b/iu,
  /\blet'?s\s+(?:(?:play|start)\s+(?:a|the)\s+(?:game|match)|queue\s+(?:for\s+)?(?:a|the)\s+(?:game|match))\b/iu
] as const;

export function classifyExplicitGameContextMessage(text: string): ExplicitGameContextMessageIntent {
  const normalized = text.normalize("NFKC").trim().slice(0, MAX_EXPLICIT_GAME_MESSAGE_LENGTH);
  if (!normalized) {
    return "none";
  }
  if (END_OR_CORRECT_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "end-or-correct";
  }
  if (START_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "start";
  }
  if (GAME_TOPIC_ONLY_PATTERNS.some((pattern) => pattern.test(normalized))) {
    return "none";
  }
  return "none";
}

export function createCoarseUserStateCoordinator({
  now = Date.now,
  explicitGameContextEnabled = true,
  explicitGameContextTtlMs = EXPLICIT_GAME_CONTEXT_TTL_MS,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout
}: {
  now?: () => number;
  explicitGameContextEnabled?: boolean;
  explicitGameContextTtlMs?: number;
  setTimeoutFn?: typeof setTimeout;
  clearTimeoutFn?: typeof clearTimeout;
} = {}): CoarseUserStateCoordinator {
  const listeners = new Set<(state: CoarseUserState) => void>();
  let disposed = false;
  let enabled = explicitGameContextEnabled;
  let explicitGameExpiresAtMs: number | null = null;
  let expiryTimer: ReturnType<typeof setTimeout> | null = null;
  let state: CoarseUserState = {
    activity: "unknown",
    interruptibility: "unknown",
    media: "unknown",
    timeBand: "unknown",
    explicitGameContext: "inactive",
    engagement: "unknown"
  };

  function publish(next: CoarseUserState): CoarseUserState {
    if (Object.keys(next).every((key) => next[key as keyof CoarseUserState] === state[key as keyof CoarseUserState])) {
      return state;
    }
    state = Object.freeze({ ...next });
    for (const listener of listeners) {
      listener(state);
    }
    return state;
  }

  function clearExpiryTimer(): void {
    if (expiryTimer) {
      clearTimeoutFn(expiryTimer);
      expiryTimer = null;
    }
  }

  function clearExplicitGameContext(): CoarseUserState {
    explicitGameExpiresAtMs = null;
    clearExpiryTimer();
    return publish({ ...state, explicitGameContext: "inactive" });
  }

  function expireIfNeeded(): CoarseUserState {
    if (explicitGameExpiresAtMs !== null && now() >= explicitGameExpiresAtMs) {
      return clearExplicitGameContext();
    }
    return state;
  }

  function scheduleExpiry(): void {
    clearExpiryTimer();
    if (explicitGameExpiresAtMs === null || disposed) {
      return;
    }
    expiryTimer = setTimeoutFn(() => {
      expiryTimer = null;
      if (explicitGameExpiresAtMs !== null && now() < explicitGameExpiresAtMs) {
        scheduleExpiry();
      } else {
        expireIfNeeded();
      }
    }, Math.max(1, explicitGameExpiresAtMs - now()));
    expiryTimer.unref?.();
  }

  return {
    getState() {
      return state;
    },
    subscribe(listener) {
      if (disposed) {
        return () => undefined;
      }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    updateEnvironment(snapshot) {
      if (disposed) {
        return state;
      }
      const next = {
        activity: snapshot.activity.value,
        interruptibility: snapshot.interruptibility.value,
        media: snapshot.media.value,
        timeBand: snapshot.timeBand.value,
        explicitGameContext: state.explicitGameContext,
        engagement: deriveEngagement(snapshot.activity.value, snapshot.interruptibility.value)
      } satisfies CoarseUserState;
      return publish(next);
    },
    handleUserMessage(text) {
      if (disposed) {
        return "none";
      }
      const intent = classifyExplicitGameContextMessage(text);
      if (intent === "end-or-correct") {
        clearExplicitGameContext();
      } else if (intent === "start" && enabled) {
        explicitGameExpiresAtMs = now() + Math.max(1, explicitGameContextTtlMs);
        publish({ ...state, explicitGameContext: "active" });
        scheduleExpiry();
      }
      return intent;
    },
    setExplicitGameContextEnabled(nextEnabled) {
      if (disposed) {
        return state;
      }
      enabled = nextEnabled;
      return enabled ? state : clearExplicitGameContext();
    },
    tick() {
      return disposed ? state : expireIfNeeded();
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      explicitGameExpiresAtMs = null;
      clearExpiryTimer();
      state = Object.freeze({ ...state, explicitGameContext: "inactive" });
      listeners.clear();
    }
  };
}

function deriveEngagement(
  activity: CompanionEnvironmentActivity,
  interruptibility: CompanionEnvironmentInterruptibility
): CoarseUserEngagement {
  if (
    activity === "locked" ||
    activity === "suspended" ||
    interruptibility === "suppressed" ||
    interruptibility === "presentation" ||
    interruptibility === "full-screen-activity"
  ) {
    return "suppressed";
  }
  if (activity === "away" || activity === "idle-long") {
    return "defer";
  }
  if ((activity === "active" || activity === "idle-short") && interruptibility === "allowed") {
    return "allowed";
  }
  return "unknown";
}
