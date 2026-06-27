import type { DialogueModeId } from "../../shared/dialogue-style";
import type { PresenceModeId } from "../../shared/presence-mode";
import type { ProviderHealthResult } from "../../shared/provider-health";
import type { ProviderStatus } from "../../shared/provider-config";

export type StatusDatasetState = "ready" | "fallback" | "error";
export type ActivityEchoState = "idle" | "active" | "fading";

export const ACTIVITY_ECHO_IDLE_MESSAGE = "等待中";
export const ACTIVITY_ECHO_FADING_MESSAGE = "安静陪伴中";
export const ACTIVITY_ECHO_ACTIVE_MS = 5_000;
export const ACTIVITY_ECHO_FADING_MS = 4_000;
export const ACTIVITY_ECHO_DEDUPE_MS = 2_500;

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
      return `本地回退：未配置 API Key${status.model ? ` · ${status.model}` : ""}`;
    }

    if (status.reason === "invalid_config") {
      return "本地回退：provider 配置无效";
    }

    return "本地回退：Fake Provider";
  }

  if (status.providerId === "openai-compatible") {
    const parts = [`真实模型：${status.model ?? status.displayName}`];

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

  return "本地模式：Fake Provider";
}

export function formatProviderHealthResult(result: ProviderHealthResult): string {
  const host = result.baseURLHost ? ` · ${result.baseURLHost}` : "";
  const count = typeof result.modelCount === "number" ? ` · 可见模型 ${result.modelCount} 个` : "";

  if (result.status === "ready") {
    return `连接可用：已找到当前模型${host}${count}`;
  }

  if (result.status === "model_missing") {
    return `服务可达，但未找到当前模型${host}${count}`;
  }

  if (result.status === "incompatible_response") {
    return `响应格式不兼容，请确认端点支持 OpenAI-compatible /models${host}`;
  }

  if (result.status === "service_unreachable") {
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
  const memoryText = usedMemory
    ? `本次使用 ${input.memoryInjectionCount} 条记忆`
    : "本次未使用记忆";

  return {
    text: `${memoryText} · ${input.ribbonEcho}`,
    state: usedMemory ? "ready" : "fallback"
  };
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
    actionEchoText: `最近动作：${input.activityEcho}`,
    actionEchoState: input.activityEchoState
  };
}
