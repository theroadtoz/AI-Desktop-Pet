import type { DialogueModeId } from "../../shared/dialogue-style";
import type { ChatContextTransparencyPayload, ChatMemoryActivityPayload } from "../../shared/ipc-contract";
import type { PresenceModeId } from "../../shared/presence-mode";
import type { ProviderHealthResult } from "../../shared/provider-health";
import type { ProviderStatus } from "../../shared/provider-config";

export type StatusDatasetState = "ready" | "fallback" | "error";
export type ActivityEchoState = "idle" | "active" | "fading";
export type DailyCompanionRhythmPhase = "replying" | "complete" | "idle";
export type DailyCompanionRhythmKind =
  | "chat-replying"
  | "memory-sensitive-skip"
  | "context-compressed"
  | "memory-injected"
  | "memory-captured"
  | "search-cited"
  | "chat-complete"
  | "idle-presence";

export const ACTIVITY_ECHO_IDLE_MESSAGE = "安静待着";
export const ACTIVITY_ECHO_FADING_MESSAGE = "在旁边陪着";
export const ACTIVITY_ECHO_ACTIVE_MS = 5_000;
export const ACTIVITY_ECHO_FADING_MS = 4_000;
export const ACTIVITY_ECHO_DEDUPE_MS = 2_500;
const HISTORY_CONTEXT_SUMMARY_TRIGGER = 12;
const HISTORY_CONTEXT_RECENT_MESSAGE_BUDGET = 8;

const DIALOGUE_MODE_LABELS: Readonly<Record<DialogueModeId, string>> = {
  default: "默认陪伴",
  work: "工作",
  game: "游戏",
  reading: "读书"
};

const PRESENCE_MODE_LABELS: Readonly<Record<PresenceModeId, string>> = {
  default: "默认陪伴",
  focus: "专注陪伴",
  quiet: "安静陪伴",
  sleep: "睡眠待机"
};

export function formatProviderStatus(status: ProviderStatus): string {
  if (status.isFallback) {
    if (status.reason === "missing_api_key") {
      return `外部模型未就绪：需要配置 API Key 后才会发起请求${status.model ? ` · ${status.model}` : ""}`;
    }

    if (status.reason === "invalid_config") {
      return "模型未就绪：Provider 配置无效，当前不会调用真实模型";
    }

    return "模型未就绪：当前不会调用真实模型";
  }

  if (status.providerId === "openai-compatible") {
    const parts = [`外部模型：${status.model ?? status.displayName}`];

    if (status.baseURLHost) {
      parts.push(status.baseURLHost);
    }

    return parts.join(" · ");
  }

  if (status.providerId === "local-openai-compatible") {
    const parts = [`本地模型：${status.model ?? status.displayName}`];

    if (status.baseURLHost) {
      parts.push(status.baseURLHost);
    }

    return parts.join(" · ");
  }

  return "开发模式：Fake Provider（不会调用真实模型）";
}

export function formatProviderHealthResult(result: ProviderHealthResult): string {
  const host = result.baseURLHost ? ` · ${result.baseURLHost}` : "";
  const count = typeof result.modelCount === "number" ? ` · 可见模型 ${result.modelCount} 个` : "";

  if (result.status === "ready") {
    return `连接可用：已找到当前模型${host}${count}`;
  }

  if (result.status === "model_missing") {
    if (result.providerId === "local-openai-compatible" && result.localPresetId === "ollama") {
      return `Ollama 可达，但未找到 ${result.model}；请手动运行 ollama pull ${result.model} 后再检查${host}${count}`;
    }

    return `服务可达，但未找到当前模型${host}${count}`;
  }

  if (result.status === "incompatible_response") {
    return `响应格式不兼容，请确认端点支持 OpenAI-compatible /models${host}`;
  }

  if (result.status === "service_unreachable") {
    if (result.providerId === "local-openai-compatible" && result.localPresetId === "ollama") {
      return `Ollama 不可达：请确认已安装并启动 Ollama，且 Base URL 指向 http://localhost:11434/v1${host}`;
    }

    return `服务不可达，请确认服务已启动且 Base URL 正确${host}`;
  }

  if (result.status === "timeout") {
    return `连接检查超时，请确认服务状态或调大超时时间${host}`;
  }

  if (result.status === "missing_api_key") {
    return "云端 Provider 需要先配置 API Key；本次未发起检查请求。";
  }

  if (result.status === "cancelled") {
    return "连接检查已取消。";
  }

  return "Provider 配置无效，请检查 Base URL、模型和超时时间。";
}

export function formatModeLabel(modeId: DialogueModeId): string {
  const label = DIALOGUE_MODE_LABELS[modeId];
  return modeId === "default" ? label : `${label}模式`;
}

export function formatPresenceLabel(modeId: PresenceModeId): string {
  return PRESENCE_MODE_LABELS[modeId];
}

export function formatPartnerStatus(input: {
  userProfileLabel: string | null;
  dialogueModeId: DialogueModeId;
  presenceModeId: PresenceModeId;
}): string {
  const modeLabel = formatModeLabel(input.dialogueModeId);
  const presenceLabel = formatPresenceLabel(input.presenceModeId);
  const roleLabel = input.userProfileLabel ?? "等待本地身份";

  return `桌面伙伴：${roleLabel} · ${modeLabel} · 存在：${presenceLabel}`;
}

export function formatMemoryRibbon(input: {
  memoryInjectionCount: number | null;
  ribbonEcho: string;
}): {
  text: string;
  state: StatusDatasetState;
} {
  const usedMemory = Boolean(input.memoryInjectionCount && input.memoryInjectionCount > 0);
  const companionState = formatCompanionStateEcho(input.ribbonEcho);
  const memoryText = usedMemory
    ? `她带上了 ${input.memoryInjectionCount} 条已允许的记忆`
    : "这轮没有带入记忆";

  return {
    text: `${memoryText} · ${companionState}`,
    state: usedMemory ? "ready" : "fallback"
  };
}

export function formatMemoryActivity(payload: ChatMemoryActivityPayload): {
  text: string;
  state: StatusDatasetState;
} {
  const parts: string[] = [];
  const autoCapture = payload.autoCapture;

  if (!autoCapture.enabled || autoCapture.skippedReason === "disabled") {
    parts.push("记忆关闭；她不会替你保存，也没有带入记忆");
  } else if (autoCapture.skippedReason === "sensitive") {
    parts.push("她跳过了敏感内容");
  } else if (autoCapture.skippedReason === "capture_failed") {
    parts.push("她暂时没能整理记忆");
  } else if (autoCapture.capturedCount > 0) {
    parts.push(`她刚记下 ${autoCapture.capturedCount} 条${autoCapture.keyCount > 0 ? "关键" : "一般"}记忆`);
  } else if (autoCapture.mergedCount + autoCapture.deduplicatedCount > 0) {
    parts.push(`她整理了 ${autoCapture.mergedCount + autoCapture.deduplicatedCount} 条相近记忆`);
  } else {
    parts.push("这轮没有新的可记内容");
  }

  if (autoCapture.enabled && autoCapture.mergedCount + autoCapture.deduplicatedCount > 0 && autoCapture.capturedCount > 0) {
    parts.push(`她整理了 ${autoCapture.mergedCount + autoCapture.deduplicatedCount} 条相近记忆`);
  }

  if (autoCapture.enabled && autoCapture.compressionTriggered && autoCapture.mergedCount + autoCapture.deduplicatedCount === 0) {
    parts.push("她收束了重复记忆");
  }

  if (autoCapture.enabled && payload.injection.count > 0) {
    parts.push(`她这轮带上了 ${payload.injection.count} 条已允许的记忆`);
  } else if (autoCapture.enabled) {
    parts.push("这轮没有带入记忆");
  }

  if (payload.contextBudget.compressed) {
    parts.push("长会话已收束成安全摘要");
  }

  const state = autoCapture.enabled &&
    (
      autoCapture.capturedCount > 0 ||
      autoCapture.mergedCount + autoCapture.deduplicatedCount > 0 ||
      autoCapture.compressionTriggered ||
      payload.injection.count > 0 ||
      payload.contextBudget.compressed
    )
    ? "ready"
    : "fallback";

  return {
    text: parts.join("；"),
    state
  };
}

export function formatContextTransparency(payload: ChatContextTransparencyPayload): {
  text: string;
  state: StatusDatasetState;
} {
  const parts: string[] = [];
  const budget = payload.contextBudget;

  if (budget.compressed) {
    parts.push(`长会话已收束：${budget.summarizedMessageCount} 条较早消息变成安全摘要，保留最近 ${budget.recentMessageCount} 条`);
  } else {
    parts.push("这轮只发送当前短上下文；不需要安全摘要");
  }

  if (payload.memory.injectionCount > 0) {
    parts.push(`她这轮会带上 ${payload.memory.injectionCount} 条已允许记忆`);
  } else {
    parts.push("这轮没有带入记忆");
  }

  if (payload.webSearch.included) {
    parts.push(`联网搜索只带入 ${payload.webSearch.citationCount} 条引用线索`);
  } else {
    parts.push("这轮没有带入联网搜索引用");
  }

  parts.push("打开历史只是本机查看；继续发送后才会交给当前 Provider");

  return {
    text: parts.join("；"),
    state: budget.compressed || payload.memory.injectionCount > 0 || payload.webSearch.included
      ? "ready"
      : "fallback"
  };
}

export function formatDailyCompanionRhythm(input: {
  memoryActivity?: ChatMemoryActivityPayload | null;
  contextTransparency?: ChatContextTransparencyPayload | null;
  activityEcho?: string | null;
  activityEchoState?: ActivityEchoState;
  phase: DailyCompanionRhythmPhase;
}): {
  primaryText: string;
  secondaryText: string | null;
  text: string;
  state: StatusDatasetState;
  kind: DailyCompanionRhythmKind;
} {
  const important = selectImportantDailyRhythm(input);

  if (input.phase === "replying") {
    return createDailyRhythm("她在想怎么说", important?.text ?? null, "ready", "chat-replying");
  }

  if (important) {
    return createDailyRhythm(important.text, null, important.state, important.kind);
  }

  if (input.phase === "complete") {
    return createDailyRhythm("她刚说完", null, "fallback", "chat-complete");
  }

  const idleText = input.activityEcho === ACTIVITY_ECHO_IDLE_MESSAGE
    ? "她安静待着"
    : "她在旁边陪着";
  return createDailyRhythm(idleText, null, "fallback", "idle-presence");
}

function selectImportantDailyRhythm(input: {
  memoryActivity?: ChatMemoryActivityPayload | null;
  contextTransparency?: ChatContextTransparencyPayload | null;
}): {
  text: string;
  state: StatusDatasetState;
  kind: Exclude<DailyCompanionRhythmKind, "chat-replying" | "chat-complete" | "idle-presence">;
} | null {
  const memory = input.memoryActivity;
  const context = input.contextTransparency;

  if (memory?.autoCapture.enabled && memory.autoCapture.skippedReason === "sensitive") {
    return { text: "她把敏感部分先放下", state: "ready", kind: "memory-sensitive-skip" };
  }

  if (memory?.contextBudget.compressed || context?.contextBudget.compressed) {
    return { text: "她把长聊收拢成轻便脉络", state: "ready", kind: "context-compressed" };
  }

  const injectionCount = Math.max(
    memory?.injection.count ?? 0,
    context?.memory.injectionCount ?? 0
  );
  if (injectionCount > 0) {
    return { text: "她带着已允许的记忆靠近", state: "ready", kind: "memory-injected" };
  }

  const capturedCount = memory?.autoCapture.capturedCount ?? 0;
  const organizedCount = (memory?.autoCapture.mergedCount ?? 0) + (memory?.autoCapture.deduplicatedCount ?? 0);
  if (memory?.autoCapture.enabled && (capturedCount > 0 || organizedCount > 0 || memory.autoCapture.compressionTriggered)) {
    return { text: "她把记忆轻轻归好", state: "ready", kind: "memory-captured" };
  }

  if (context?.webSearch.included && context.webSearch.citationCount > 0) {
    return { text: "她带着联网引用线索回来", state: "ready", kind: "search-cited" };
  }

  return null;
}

function createDailyRhythm(
  primaryText: string,
  secondaryText: string | null,
  state: StatusDatasetState,
  kind: DailyCompanionRhythmKind
): {
  primaryText: string;
  secondaryText: string | null;
  text: string;
  state: StatusDatasetState;
  kind: DailyCompanionRhythmKind;
} {
  return {
    primaryText,
    secondaryText,
    text: secondaryText ? `${primaryText} · ${secondaryText}` : primaryText,
    state,
    kind
  };
}

export function formatHistoryContextPreview(input: {
  messageCount: number;
  summaryTrigger?: number;
  recentMessageBudget?: number;
}): {
  text: string;
  state: StatusDatasetState;
} {
  const messageCount = Math.max(0, Math.floor(input.messageCount));
  const summaryTrigger = input.summaryTrigger ?? HISTORY_CONTEXT_SUMMARY_TRIGGER;
  const recentMessageBudget = input.recentMessageBudget ?? HISTORY_CONTEXT_RECENT_MESSAGE_BUDGET;

  const nextMessageCount = messageCount + 1;

  if (nextMessageCount > summaryTrigger) {
    const recentCount = Math.min(nextMessageCount, recentMessageBudget);
    const summarizedCount = Math.max(0, nextMessageCount - recentCount);

    return {
      text: `本地查看：${messageCount} 条消息不会自动发送；继续发送下一条后，预计 ${summarizedCount} 条较早消息会先变成安全摘要，保留最近 ${recentCount} 条。`,
      state: "ready"
    };
  }

  return {
    text: `本地查看：${messageCount} 条消息不会自动发送；继续发送下一条后，会携带这段短上下文，预计不需要安全摘要。`,
    state: "fallback"
  };
}

function formatCompanionStateEcho(echo: string): string {
  if (echo === ACTIVITY_ECHO_IDLE_MESSAGE) {
    return "她安静待着";
  }

  if (echo === ACTIVITY_ECHO_FADING_MESSAGE) {
    return "她在旁边陪着";
  }

  if (echo === "正在回复") {
    return "她在想怎么说";
  }

  if (echo === "回复完成") {
    return "她刚说完";
  }

  if (echo === "回复失败") {
    return "她暂时没接上模型";
  }

  if (echo === "已中断") {
    return "她先停在这里";
  }

  return echo;
}

export function formatCompanionShelf(input: {
  accessoryLabel: string;
  petScale: number;
  isPetLocked: boolean;
  activityEcho: string;
  activityEchoState: ActivityEchoState;
}): {
  accessoryText: string;
  scaleText: string;
  lockText: string;
  lockState: StatusDatasetState;
  actionEchoText: string;
  actionEchoState: ActivityEchoState;
} {
  return {
    accessoryText: `配件：${input.accessoryLabel}`,
    scaleText: `大小：${Math.round(input.petScale * 100)}%`,
    lockText: `锁定：${input.isPetLocked ? "已锁定" : "未锁定"}`,
    lockState: input.isPetLocked ? "ready" : "fallback",
    actionEchoText: `小动作：${input.activityEcho}`,
    actionEchoState: input.activityEchoState
  };
}
