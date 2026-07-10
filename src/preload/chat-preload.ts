import { contextBridge, ipcRenderer } from "electron";
import type {
  ChatApi,
  ChatContextTransparencyPayload,
  ChatMemoryActivityPayload,
  ChatMemoryInjectionPayload,
  ChatSendRequest,
  ChatStreamDeltaPayload,
  ChatStreamDonePayload,
  ChatStreamErrorPayload,
  ConfigApi,
  ConfigApiKeyRequest,
  ConfigSetApiKeyRequest,
  DialogueModeApi,
  HistoryApi,
  LocalRuntimeApi,
  MemoryApi,
  PetActivityEcho,
  PetLockState,
  PetPresentationApi,
  PresenceModeApi,
  ProactiveCompanionApi,
  ShortcutApi,
  UserProfileApi,
  WebSearchApi
} from "../shared/ipc-contract";
import type { Conversation, ConversationSummary, HistoryMessage } from "../shared/chat-history";
import type { MemoryCard, MemoryCardDraft, MemoryCardUpdate, MemorySummary } from "../shared/chat-memory";
import type { DialogueModeId, DialogueModeView } from "../shared/dialogue-style";
import type { PresenceModeId, PresenceModeView } from "../shared/presence-mode";
import type { ProviderConfig, ProviderStatus } from "../shared/provider-config";
import type { ProviderHealthCheckRequest, ProviderHealthResult, ProviderHealthStatus } from "../shared/provider-health";
import type { PetPresentationPreferences } from "../shared/pet-presentation";
import type { ShortcutActionId, ShortcutPreferenceView, ShortcutUpdateResult } from "../shared/shortcut-preferences";
import type { UserProfile, UserProfileInput } from "../shared/user-profile";
import type {
  LlamaCppRuntimeSafeSummary,
  LlamaCppRuntimeSettingsUpdate,
  LlamaCppRuntimeStatus
} from "../shared/llama-cpp-runtime";
import type { WebSearchConnectionTestResult, WebSearchSettings, WebSearchStatus } from "../shared/web-search";
import type {
  ProactiveCompanionCadence,
  ProactiveCompanionSettings,
  ProactiveCompanionSettingsUpdate
} from "../shared/proactive-companion-settings";

const petAccessoryPresetIds = ["none", "glasses"] as const;
const shortcutActionIds = ["togglePetLock", "adjustPetScaleWithWheel"] as const;
const dialogueModeIds = ["default", "work", "game", "reading"] as const;
const presenceModeIds = ["default", "focus", "quiet", "sleep"] as const;
const proactiveCompanionCadences = ["normal", "quiet", "off"] as const;
const defaultProactiveCompanionSettings: ProactiveCompanionSettings = {
  cadence: "normal",
  memorySourceBubbles: true,
  searchSourceBubbles: true
};
const dialogueModeViews: readonly DialogueModeView[] = [
  { id: "default", label: "默认陪伴" },
  { id: "work", label: "工作" },
  { id: "game", label: "游戏" },
  { id: "reading", label: "读书" }
];
const presenceModeViews: readonly PresenceModeView[] = [
  { id: "default", label: "默认陪伴", description: "保留日常呼吸与动作节奏。" },
  { id: "focus", label: "专注陪伴", description: "降低待机打扰，保留清晰回应。" },
  { id: "quiet", label: "安静陪伴", description: "减少强动作与空闲渲染。" },
  { id: "sleep", label: "睡眠待机", description: "低频待机，保留微弱生命感。" }
];
const chatStreamErrorTypes = [
  "aborted",
  "busy",
  "missing_api_key",
  "invalid_config",
  "auth_failed",
  "rate_limited",
  "server_error",
  "timeout",
  "model_missing",
  "incompatible_response",
  "network_error",
  "failed"
] as const;
const chatMemoryActivitySkippedReasons = ["disabled", "sensitive", "no_candidate", "capture_failed"] as const;
const providerHealthStatuses: readonly ProviderHealthStatus[] = [
  "ready",
  "model_missing",
  "incompatible_response",
  "service_unreachable",
  "timeout",
  "missing_api_key",
  "cancelled",
  "invalid_config"
] as const;
const llamaCppRuntimeStatuses: readonly LlamaCppRuntimeStatus[] = [
  "disabled",
  "missing_binary",
  "missing_model",
  "starting",
  "ready",
  "exited",
  "timeout",
  "error"
] as const;
const llamaCppRuntimeReasons: readonly NonNullable<LlamaCppRuntimeSafeSummary["reason"]>[] = [
  "invalid_model_extension",
  "spawn_failed",
  "health_timeout",
  "stop_timeout"
] as const;
const localModelDiagnosticStatuses = ["ready", "not_ready", "script_failed"] as const;
const localModelDiagnosticRuntimeStatuses = [
  "ready",
  "not_installed_or_unreachable",
  "model_missing",
  "chat_failed",
  "missing_resources",
  "env_configured",
  "skipped"
] as const;
const localModelDiagnosticEndpointStatuses = [
  "ready",
  "model_missing",
  "service_unreachable",
  "incompatible_response",
  "chat_failed",
  "skipped"
] as const;
const DEFAULT_WEB_SEARCH_SETTINGS: WebSearchSettings = {
  enabled: false,
  command: "bundled-baidu-search",
  args: [],
  toolName: "search",
  timeoutMs: 60_000,
  maxResults: 3
};

type LocalModelDiagnosticRuntimeStatus = (typeof localModelDiagnosticRuntimeStatuses)[number];
type LocalModelDiagnosticEndpointStatus = (typeof localModelDiagnosticEndpointStatuses)[number];
type LocalModelDiagnosticSafeSummary = {
  ok: boolean;
  status: (typeof localModelDiagnosticStatuses)[number];
  recommendedRuntime: string;
  durationMs: number;
  safeSummaryOnly: true;
  runtimes: Array<{
    id: string;
    label: string;
    status: LocalModelDiagnosticRuntimeStatus;
    baseURLHost?: string;
    model?: string;
    reason?: string;
    nextAction?: string;
    commandFound?: boolean;
    processFound?: boolean;
    tcpReachable?: boolean;
    modelsStatus?: LocalModelDiagnosticEndpointStatus;
    chatStatus?: LocalModelDiagnosticEndpointStatus;
    modelCount?: number;
    firstTokenMs?: number;
    replyLength?: number;
    modelsCheckMs?: number;
    chatCheckMs?: number;
    durationMs?: number;
    managedEnabled?: boolean;
    bundled?: boolean;
    resourceSource?: string;
    manifestFound?: boolean;
    executableConfigured?: boolean;
    modelConfigured?: boolean;
  }>;
};

const emotionTags = ["neutral", "happy", "sad", "surprised", "confused", "angry"] as const;
const emotionIntensities = ["low", "medium", "high"] as const;
const PET_SCALE_MIN = 0.7;
const PET_SCALE_MAX = 1.35;
const PET_SCALE_STEP = 0.05;
const USER_PROFILE_TEXT_MAX_LENGTH = 32;

function isEmotionTag(value: unknown): boolean {
  return typeof value === "string" && emotionTags.includes(value as (typeof emotionTags)[number]);
}

function isEmotionIntensity(value: unknown): boolean {
  return typeof value === "string" && emotionIntensities.includes(value as (typeof emotionIntensities)[number]);
}

function normalizePetScale(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  const stepCount = Math.round((value - PET_SCALE_MIN) / PET_SCALE_STEP);
  const normalized = PET_SCALE_MIN + stepCount * PET_SCALE_STEP;

  if (
    normalized < PET_SCALE_MIN ||
    normalized > PET_SCALE_MAX ||
    Math.abs(value - normalized) > Number.EPSILON * 16
  ) {
    return null;
  }

  return Number(normalized.toFixed(2));
}

function isPetAccessoryPresetId(value: unknown): value is (typeof petAccessoryPresetIds)[number] {
  return typeof value === "string" && petAccessoryPresetIds.includes(value as (typeof petAccessoryPresetIds)[number]);
}

function parseDialogueModeId(value: unknown): DialogueModeId | null {
  return typeof value === "string" && dialogueModeIds.includes(value as DialogueModeId)
    ? value as DialogueModeId
    : null;
}

function parsePresenceModeId(value: unknown): PresenceModeId | null {
  return typeof value === "string" && presenceModeIds.includes(value as PresenceModeId)
    ? value as PresenceModeId
    : null;
}

function parseProactiveCompanionCadence(value: unknown): ProactiveCompanionCadence | null {
  return typeof value === "string" && proactiveCompanionCadences.includes(value as ProactiveCompanionCadence)
    ? value as ProactiveCompanionCadence
    : null;
}

function parseProactiveCompanionSettings(value: unknown): ProactiveCompanionSettings {
  const settings = value as Partial<ProactiveCompanionSettings> | null;

  if (!settings || typeof settings !== "object") {
    return { ...defaultProactiveCompanionSettings };
  }

  return {
    cadence: parseProactiveCompanionCadence(settings.cadence) ?? defaultProactiveCompanionSettings.cadence,
    memorySourceBubbles: typeof settings.memorySourceBubbles === "boolean"
      ? settings.memorySourceBubbles
      : defaultProactiveCompanionSettings.memorySourceBubbles,
    searchSourceBubbles: typeof settings.searchSourceBubbles === "boolean"
      ? settings.searchSourceBubbles
      : defaultProactiveCompanionSettings.searchSourceBubbles
  };
}

function parseProactiveCompanionSettingsUpdate(value: unknown): ProactiveCompanionSettingsUpdate | null {
  const update = value as Partial<ProactiveCompanionSettingsUpdate> | null;

  if (!update || typeof update !== "object") {
    return null;
  }

  const parsed: ProactiveCompanionSettingsUpdate = {};

  if ("cadence" in update) {
    const cadence = parseProactiveCompanionCadence(update.cadence);
    if (!cadence) {
      return null;
    }
    parsed.cadence = cadence;
  }

  if ("memorySourceBubbles" in update) {
    if (typeof update.memorySourceBubbles !== "boolean") {
      return null;
    }
    parsed.memorySourceBubbles = update.memorySourceBubbles;
  }

  if ("searchSourceBubbles" in update) {
    if (typeof update.searchSourceBubbles !== "boolean") {
      return null;
    }
    parsed.searchSourceBubbles = update.searchSourceBubbles;
  }

  return parsed;
}

function normalizeUserProfileText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  if (/[\r\n<>]/.test(value)) {
    return null;
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 0 && normalized.length <= USER_PROFILE_TEXT_MAX_LENGTH
    ? normalized
    : null;
}

function parseUserProfileInput(value: unknown): UserProfileInput | null {
  const profile = value as Partial<UserProfileInput> | null;
  const displayName = normalizeUserProfileText(profile?.displayName);
  const preferredName = profile?.preferredName === undefined || profile.preferredName === ""
    ? undefined
    : normalizeUserProfileText(profile.preferredName);

  if (!profile || !displayName || preferredName === null) {
    return null;
  }

  return {
    displayName,
    ...(preferredName ? { preferredName } : {})
  };
}

function parseUserProfile(value: unknown): UserProfile | null {
  const profile = value as Partial<UserProfile> | null;
  const input = parseUserProfileInput(profile);

  if (!profile || !input || typeof profile.completedAt !== "string" || Number.isNaN(Date.parse(profile.completedAt))) {
    return null;
  }

  return {
    ...input,
    completedAt: profile.completedAt
  };
}

function parsePetPresentationPreferences(value: unknown): PetPresentationPreferences | null {
  const preferences = value as Partial<PetPresentationPreferences> | null;
  const petScale = preferences && typeof preferences === "object"
    ? normalizePetScale(preferences.petScale)
    : null;
  const accessoryPresetId = preferences && typeof preferences === "object" && isPetAccessoryPresetId(preferences.accessoryPresetId)
    ? preferences.accessoryPresetId
    : "none";

  return petScale === null ? null : { petScale, accessoryPresetId };
}

function parsePetLockState(value: unknown): PetLockState | null {
  const state = value as Partial<PetLockState> | null;

  return state && typeof state.isLocked === "boolean"
    ? { isLocked: state.isLocked }
    : null;
}

function parsePetActivityEcho(value: unknown): PetActivityEcho | null {
  const echo = value as Partial<PetActivityEcho> | null;

  return echo && typeof echo.message === "string" && echo.message.length > 0 && echo.message.length <= 24
    ? { message: echo.message }
    : null;
}

function isShortcutActionId(value: unknown): value is ShortcutActionId {
  return typeof value === "string" && shortcutActionIds.includes(value as (typeof shortcutActionIds)[number]);
}

function parseShortcutPreferenceView(value: unknown): ShortcutPreferenceView | null {
  const shortcut = value as Partial<ShortcutPreferenceView> | null;

  if (
    !shortcut ||
    !isShortcutActionId(shortcut.id) ||
    typeof shortcut.label !== "string" ||
    typeof shortcut.description !== "string" ||
    typeof shortcut.defaultAccelerator !== "string" ||
    typeof shortcut.accelerator !== "string" ||
    (shortcut.kind !== "global" && shortcut.kind !== "wheelModifier") ||
    (shortcut.scope !== "global" && shortcut.scope !== "petRenderer") ||
    typeof shortcut.canDisable !== "boolean" ||
    typeof shortcut.userConfigurable !== "boolean" ||
    typeof shortcut.isDefault !== "boolean"
  ) {
    return null;
  }

  return {
    id: shortcut.id,
    label: shortcut.label,
    description: shortcut.description,
    defaultAccelerator: shortcut.defaultAccelerator,
    accelerator: shortcut.accelerator,
    kind: shortcut.kind,
    scope: shortcut.scope,
    canDisable: shortcut.canDisable,
    userConfigurable: shortcut.userConfigurable,
    isDefault: shortcut.isDefault
  };
}

function parseShortcutPreferenceViews(value: unknown): ShortcutPreferenceView[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const shortcuts = value.map(parseShortcutPreferenceView);

  if (shortcuts.some((shortcut) => shortcut === null)) {
    return null;
  }

  return shortcuts as ShortcutPreferenceView[];
}

function parseShortcutUpdateResult(value: unknown): ShortcutUpdateResult | null {
  const result = value as Partial<ShortcutUpdateResult> | null;
  const shortcuts = parseShortcutPreferenceViews(result?.shortcuts);
  const preferences = result?.preferences;

  if (!result || !shortcuts || !preferences || typeof preferences !== "object") {
    return null;
  }

  if (result.ok === true) {
    return {
      ok: true,
      preferences: result.preferences as ShortcutUpdateResult["preferences"],
      shortcuts
    };
  }

  if (result.ok === false && typeof result.reason === "string") {
    return {
      ok: false,
      reason: result.reason,
      preferences: result.preferences as ShortcutUpdateResult["preferences"],
      shortcuts
    };
  }

  return null;
}

function isChatMessage(value: unknown): boolean {
  const message = value as Partial<ChatSendRequest["messages"][number]> | null;

  return Boolean(
    message &&
    typeof message.id === "string" &&
    (message.role === "user" || message.role === "assistant") &&
    typeof message.content === "string"
  );
}

function isChatSendRequest(value: unknown): value is ChatSendRequest {
  const request = value as Partial<ChatSendRequest> | null;

  return Boolean(
    request &&
    typeof request.conversationId === "string" &&
    Array.isArray(request.messages) &&
    request.messages.every(isChatMessage)
  );
}

function isChatStreamDeltaPayload(value: unknown): value is ChatStreamDeltaPayload {
  const delta = value as Partial<ChatStreamDeltaPayload> | null;

  return Boolean(
    delta &&
    typeof delta.text === "string" &&
    typeof delta.requestVersion === "number" &&
    Number.isSafeInteger(delta.requestVersion) &&
    delta.requestVersion > 0
  );
}

function isChatStreamDonePayload(value: unknown): value is ChatStreamDonePayload {
  const result = value as Partial<ChatStreamDonePayload> | null;

  return Boolean(
    result && typeof result.requestVersion === "number" && Number.isSafeInteger(result.requestVersion) && result.requestVersion > 0 &&
    typeof result.text === "string" &&
    isEmotionTag(result.emotion) &&
    isEmotionIntensity(result.intensity) &&
    (result.webSearchCitation === undefined || isWebSearchCitationPayload(result.webSearchCitation))
  );
}

function isWebSearchCitationPayload(value: unknown): boolean {
  const payload = value as { citations?: unknown } | null;

  if (!payload || !Array.isArray(payload.citations)) {
    return false;
  }

  return payload.citations.length <= 5 && payload.citations.every((citation) => {
    const item = citation as {
      title?: unknown;
      domain?: unknown;
      url?: unknown;
      snippet?: unknown;
      generatedAt?: unknown;
      toolName?: unknown;
    } | null;

    if (
      !item ||
      typeof item.title !== "string" ||
      typeof item.domain !== "string" ||
      typeof item.generatedAt !== "string" ||
      typeof item.toolName !== "string" ||
      item.title.length > 96 ||
      item.domain.length > 80 ||
      item.generatedAt.length > 40 ||
      item.toolName.length > 80 ||
      (item.snippet !== undefined && (typeof item.snippet !== "string" || item.snippet.length > 220)) ||
      (item.url !== undefined && (typeof item.url !== "string" || item.url.length > 240))
    ) {
      return false;
    }

    if (item.url !== undefined) {
      try {
        const url = new URL(item.url);
        return (url.protocol === "http:" || url.protocol === "https:") && !url.search && !url.hash;
      } catch {
        return false;
      }
    }

    return true;
  });
}

function isChatStreamErrorPayload(value: unknown): value is ChatStreamErrorPayload {
  const error = value as Partial<ChatStreamErrorPayload> | null;

  return Boolean(
    error &&
    typeof error.requestVersion === "number" && Number.isSafeInteger(error.requestVersion) && error.requestVersion > 0 &&
    typeof error.message === "string" &&
    typeof error.errorType === "string" &&
    chatStreamErrorTypes.includes(error.errorType as (typeof chatStreamErrorTypes)[number])
  );
}

function isChatMemoryInjectionPayload(value: unknown): value is ChatMemoryInjectionPayload {
  const payload = value as Partial<ChatMemoryInjectionPayload> | null;

  return Boolean(
    payload &&
    typeof payload.requestVersion === "number" &&
    Number.isSafeInteger(payload.requestVersion) &&
    payload.requestVersion > 0 &&
    typeof payload.count === "number" &&
    Number.isSafeInteger(payload.count) &&
    payload.count >= 0
  );
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const objectKeys = Object.keys(value);
  return objectKeys.length === keys.length &&
    objectKeys.every((key) => keys.includes(key)) &&
    keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isChatMemoryActivitySkippedReason(value: unknown): value is ChatMemoryActivityPayload["autoCapture"]["skippedReason"] {
  return value === null ||
    (typeof value === "string" && chatMemoryActivitySkippedReasons.includes(value as (typeof chatMemoryActivitySkippedReasons)[number]));
}

function isChatMemoryActivityPayload(value: unknown): value is ChatMemoryActivityPayload {
  if (!hasExactKeys(value, ["requestVersion", "autoCapture", "injection", "contextBudget"])) {
    return false;
  }

  const autoCapture = value.autoCapture;
  const injection = value.injection;
  const contextBudget = value.contextBudget;
  const requestVersion = value.requestVersion;

  if (!hasExactKeys(autoCapture, [
    "enabled",
    "skippedReason",
    "capturedCount",
    "keyCount",
    "generalCount",
    "mergedCount",
    "deduplicatedCount",
    "compressionTriggered",
    "totalCards",
    "injectionBudget"
  ]) || !hasExactKeys(injection, ["count"]) || !hasExactKeys(contextBudget, [
    "compressed",
    "summaryMessageCount",
    "summarizedMessageCount",
    "recentMessageCount"
  ])) {
    return false;
  }

  return Boolean(
    typeof requestVersion === "number" &&
    Number.isSafeInteger(requestVersion) &&
    requestVersion > 0 &&
    typeof autoCapture.enabled === "boolean" &&
    isChatMemoryActivitySkippedReason(autoCapture.skippedReason) &&
    isNonNegativeSafeInteger(autoCapture.capturedCount) &&
    isNonNegativeSafeInteger(autoCapture.keyCount) &&
    isNonNegativeSafeInteger(autoCapture.generalCount) &&
    isNonNegativeSafeInteger(autoCapture.mergedCount) &&
    isNonNegativeSafeInteger(autoCapture.deduplicatedCount) &&
    typeof autoCapture.compressionTriggered === "boolean" &&
    isNonNegativeSafeInteger(autoCapture.totalCards) &&
    isNonNegativeSafeInteger(autoCapture.injectionBudget) &&
    isNonNegativeSafeInteger(injection.count) &&
    typeof contextBudget.compressed === "boolean" &&
    isNonNegativeSafeInteger(contextBudget.summaryMessageCount) &&
    isNonNegativeSafeInteger(contextBudget.summarizedMessageCount) &&
    isNonNegativeSafeInteger(contextBudget.recentMessageCount)
  );
}

function isChatContextTransparencyPayload(value: unknown): value is ChatContextTransparencyPayload {
  if (!hasExactKeys(value, ["requestVersion", "contextBudget", "memory", "webSearch"])) {
    return false;
  }

  const requestVersion = value.requestVersion;
  const contextBudget = value.contextBudget;
  const memory = value.memory;
  const webSearch = value.webSearch;

  if (!hasExactKeys(contextBudget, [
    "originalMessageCount",
    "providerMessageCount",
    "compressed",
    "summaryMessageCount",
    "summarizedMessageCount",
    "recentMessageCount"
  ]) || !hasExactKeys(memory, ["injectionCount"]) || !hasExactKeys(webSearch, [
    "included",
    "citationCount"
  ])) {
    return false;
  }

  return Boolean(
    typeof requestVersion === "number" &&
    Number.isSafeInteger(requestVersion) &&
    requestVersion > 0 &&
    isNonNegativeSafeInteger(contextBudget.originalMessageCount) &&
    isNonNegativeSafeInteger(contextBudget.providerMessageCount) &&
    typeof contextBudget.compressed === "boolean" &&
    isNonNegativeSafeInteger(contextBudget.summaryMessageCount) &&
    isNonNegativeSafeInteger(contextBudget.summarizedMessageCount) &&
    isNonNegativeSafeInteger(contextBudget.recentMessageCount) &&
    isNonNegativeSafeInteger(memory.injectionCount) &&
    typeof webSearch.included === "boolean" &&
    isNonNegativeSafeInteger(webSearch.citationCount)
  );
}

function isProviderConfig(value: unknown): value is ProviderConfig {
  const config = value as Partial<ProviderConfig> | null;

  if (!config || typeof config !== "object") {
    return false;
  }

  if (config.providerId === "fake") {
    return typeof config.displayName === "string" && config.displayName.length > 0;
  }

  if (config.providerId === "openai-compatible") {
    return (
      typeof config.displayName === "string" &&
      config.displayName.length > 0 &&
      typeof config.baseURL === "string" &&
      config.baseURL.length > 0 &&
      typeof config.model === "string" &&
      config.model.length > 0 &&
      typeof config.apiKeyRef === "string" &&
      config.apiKeyRef.length > 0 &&
      typeof config.temperature === "number" &&
      Number.isFinite(config.temperature) &&
      typeof config.maxTokens === "number" &&
      Number.isInteger(config.maxTokens) &&
      config.maxTokens > 0 &&
      typeof config.timeoutMs === "number" &&
      Number.isInteger(config.timeoutMs) &&
      config.timeoutMs > 0
    );
  }

  if (config.providerId === "local-openai-compatible") {
    return (
      typeof config.displayName === "string" &&
      config.displayName.length > 0 &&
      typeof config.baseURL === "string" &&
      config.baseURL.length > 0 &&
      typeof config.model === "string" &&
      config.model.length > 0 &&
      (
        config.localPresetId === undefined ||
        config.localPresetId === "embedded-llama-cpp" ||
        config.localPresetId === "ollama" ||
        config.localPresetId === "lm-studio" ||
        config.localPresetId === "custom-local"
      ) &&
      typeof config.temperature === "number" &&
      Number.isFinite(config.temperature) &&
      typeof config.maxTokens === "number" &&
      Number.isInteger(config.maxTokens) &&
      config.maxTokens > 0 &&
      typeof config.timeoutMs === "number" &&
      Number.isInteger(config.timeoutMs) &&
      config.timeoutMs > 0
    );
  }

  return false;
}

function isProviderHealthCheckRequest(value: unknown): value is ProviderHealthCheckRequest {
  const request = value as Partial<ProviderHealthCheckRequest> | null;

  return Boolean(
    request &&
    (
      request.providerId === "local-openai-compatible"
    ) &&
    typeof request.baseURL === "string" &&
    request.baseURL.length > 0 &&
    typeof request.model === "string" &&
    request.model.length > 0 &&
    typeof request.timeoutMs === "number" &&
    Number.isInteger(request.timeoutMs) &&
    request.timeoutMs > 0 &&
    (
      request.localPresetId === undefined ||
      request.localPresetId === "embedded-llama-cpp" ||
      request.localPresetId === "ollama" ||
      request.localPresetId === "lm-studio" ||
      request.localPresetId === "custom-local"
    )
  );
}

function isProviderHealthResult(value: unknown): value is ProviderHealthResult {
  const result = value as Partial<ProviderHealthResult> | null;

  return Boolean(
    result &&
    (
      result.providerId === "openai-compatible" ||
      result.providerId === "local-openai-compatible"
    ) &&
    typeof result.status === "string" &&
    providerHealthStatuses.includes(result.status as ProviderHealthStatus) &&
    typeof result.model === "string" &&
    (result.baseURLHost === undefined || typeof result.baseURLHost === "string") &&
    (
      result.localPresetId === undefined ||
      result.localPresetId === "embedded-llama-cpp" ||
      result.localPresetId === "ollama" ||
      result.localPresetId === "lm-studio" ||
      result.localPresetId === "custom-local"
    ) &&
    (
      result.modelCount === undefined ||
      (
        typeof result.modelCount === "number" &&
        Number.isSafeInteger(result.modelCount) &&
        result.modelCount >= 0
      )
    )
  );
}

function isProviderStatus(value: unknown): value is ProviderStatus {
  const status = value as Partial<ProviderStatus> | null;

  return Boolean(
    status &&
    typeof status.displayName === "string" &&
    status.displayName.length > 0 &&
    (
      status.providerId === "fake" ||
      status.providerId === "openai-compatible" ||
      status.providerId === "local-openai-compatible"
    ) &&
    typeof status.isFallback === "boolean" &&
    (status.model === undefined || typeof status.model === "string") &&
    (status.baseURLHost === undefined || typeof status.baseURLHost === "string") &&
    (status.hasApiKey === undefined || typeof status.hasApiKey === "boolean") &&
    (
      status.reason === undefined ||
      status.reason === "missing_api_key" ||
      status.reason === "invalid_config"
    )
  );
}

function isConfigApiKeyRequest(value: unknown): value is ConfigApiKeyRequest {
  const request = value as Partial<ConfigApiKeyRequest> | null;

  return Boolean(request && typeof request.apiKeyRef === "string" && request.apiKeyRef.length > 0);
}

function isConfigSetApiKeyRequest(value: unknown): value is ConfigSetApiKeyRequest {
  const request = value as Partial<ConfigSetApiKeyRequest> | null;

  return Boolean(
    request &&
    typeof request.apiKeyRef === "string" &&
    request.apiKeyRef.length > 0 &&
    typeof request.apiKey === "string" &&
    request.apiKey.length > 0
  );
}

function isHistoryId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isMemoryId(value: unknown): value is string {
  return isHistoryId(value);
}

function normalizeMemoryText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length > 0 ? normalized.slice(0, maxLength) : null;
}

function normalizeMemoryTags(value: unknown): string[] | null {
  if (!Array.isArray(value)) {
    return null;
  }

  const tags: string[] = [];

  for (const item of value) {
    const tag = normalizeMemoryText(item, 24);

    if (!tag || tags.includes(tag)) {
      continue;
    }

    tags.push(tag);

    if (tags.length >= 8) {
      break;
    }
  }

  return tags;
}

function normalizeMemoryNamespace(value: unknown): string | null {
  const normalized = normalizeMemoryText(value, 32);

  return normalized && /^[a-z0-9][a-z0-9_-]{0,31}$/i.test(normalized)
    ? normalized.toLowerCase()
    : null;
}

function normalizeMemoryKey(value: unknown): string | null {
  const normalized = normalizeMemoryText(value, 48);

  return normalized && /^[a-z0-9][a-z0-9:_-]{0,47}$/i.test(normalized)
    ? normalized.toLowerCase()
    : null;
}

function normalizeMemoryCategory(value: unknown): string | null {
  const normalized = normalizeMemoryText(value, 32);

  return normalized && /^[a-z0-9][a-z0-9_-]{0,31}$/i.test(normalized)
    ? normalized.toLowerCase()
    : null;
}

function parseMemorySourceType(value: unknown): MemoryCard["sourceType"] | null {
  return value === "manual-chat" || value === "auto-local-heuristic" || value === "auto-local-model"
    ? value
    : null;
}

function parseMemoryImportance(value: unknown): MemoryCard["importance"] | null {
  return value === "key" || value === "general" ? value : null;
}

function parseMemoryCompressionState(value: unknown): MemoryCard["compressionState"] | null {
  return value === "raw" || value === "merged" || value === "deduplicated" || value === "budgeted"
    ? value
    : null;
}

function parseMemoryConfidence(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
    return null;
  }

  return Math.round(value * 100) / 100;
}

function parsePositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

const unsafeRuntimeFieldNames = new Set([
  "body",
  "prompt",
  "request",
  "messages",
  "content",
  "apikey"
]);

function hasUnsafeRuntimeField(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.some(hasUnsafeRuntimeField);
  }

  if (!value || typeof value !== "object") {
    return false;
  }

  for (const [key, nestedValue] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    const compactKey = normalizedKey.replace(/[^a-z0-9]/g, "");

    if (
      normalizedKey.includes("path") ||
      unsafeRuntimeFieldNames.has(normalizedKey) ||
      unsafeRuntimeFieldNames.has(compactKey) ||
      compactKey.includes("body") ||
      compactKey.includes("prompt") ||
      compactKey.includes("request") ||
      compactKey.includes("apikey")
    ) {
      return true;
    }

    if (hasUnsafeRuntimeField(nestedValue)) {
      return true;
    }
  }

  return false;
}

function isOptionalRuntimeString(value: unknown): value is string | undefined | null {
  return value === undefined || value === null || typeof value === "string";
}

function isOptionalRuntimeNumber(value: unknown): value is number | undefined {
  return value === undefined || (typeof value === "number" && Number.isFinite(value));
}

function isOptionalRuntimeBoolean(value: unknown): value is boolean | undefined {
  return value === undefined || typeof value === "boolean";
}

function isSafeRuntimeText(value: string): boolean {
  return (
    value.length <= 240 &&
    !/[\u0000-\u001f\u007f]/.test(value) &&
    !/[A-Za-z]:\\/.test(value) &&
    !/(^|[\s([{])\/(?:home|Users|Volumes|mnt|var|tmp|opt|usr|etc)\//.test(value)
  );
}

function isOptionalSafeRuntimeText(value: unknown): value is string | undefined {
  return value === undefined || (typeof value === "string" && isSafeRuntimeText(value));
}

function isOptionalLocalModelEndpointStatus(value: unknown): value is LocalModelDiagnosticEndpointStatus | undefined {
  return value === undefined || (
    typeof value === "string" &&
    localModelDiagnosticEndpointStatuses.includes(value as LocalModelDiagnosticEndpointStatus)
  );
}

function parseLocalModelDiagnosticRuntimeSummary(value: unknown): LocalModelDiagnosticSafeSummary["runtimes"][number] | null {
  const runtime = value as Partial<LocalModelDiagnosticSafeSummary["runtimes"][number]> | null;

  if (
    !runtime ||
    typeof runtime !== "object" ||
    typeof runtime.id !== "string" ||
    !isSafeRuntimeText(runtime.id) ||
    typeof runtime.label !== "string" ||
    !isSafeRuntimeText(runtime.label) ||
    typeof runtime.status !== "string" ||
    !localModelDiagnosticRuntimeStatuses.includes(runtime.status as LocalModelDiagnosticRuntimeStatus) ||
    !isOptionalSafeRuntimeText(runtime.baseURLHost) ||
    !isOptionalSafeRuntimeText(runtime.model) ||
    !isOptionalSafeRuntimeText(runtime.reason) ||
    !isOptionalSafeRuntimeText(runtime.nextAction) ||
    !isOptionalRuntimeBoolean(runtime.commandFound) ||
    !isOptionalRuntimeBoolean(runtime.processFound) ||
    !isOptionalRuntimeBoolean(runtime.tcpReachable) ||
    !isOptionalLocalModelEndpointStatus(runtime.modelsStatus) ||
    !isOptionalLocalModelEndpointStatus(runtime.chatStatus) ||
    !isOptionalRuntimeNumber(runtime.modelCount) ||
    !isOptionalRuntimeNumber(runtime.firstTokenMs) ||
    !isOptionalRuntimeNumber(runtime.replyLength) ||
    !isOptionalRuntimeNumber(runtime.modelsCheckMs) ||
    !isOptionalRuntimeNumber(runtime.chatCheckMs) ||
    !isOptionalRuntimeNumber(runtime.durationMs) ||
    !isOptionalRuntimeBoolean(runtime.managedEnabled) ||
    !isOptionalRuntimeBoolean(runtime.bundled) ||
    !isOptionalSafeRuntimeText(runtime.resourceSource) ||
    !isOptionalRuntimeBoolean(runtime.manifestFound) ||
    !isOptionalRuntimeBoolean(runtime.executableConfigured) ||
    !isOptionalRuntimeBoolean(runtime.modelConfigured)
  ) {
    return null;
  }

  return {
    id: runtime.id,
    label: runtime.label,
    status: runtime.status as LocalModelDiagnosticRuntimeStatus,
    ...(runtime.baseURLHost ? { baseURLHost: runtime.baseURLHost } : {}),
    ...(runtime.model ? { model: runtime.model } : {}),
    ...(runtime.reason ? { reason: runtime.reason } : {}),
    ...(runtime.nextAction ? { nextAction: runtime.nextAction } : {}),
    ...(typeof runtime.commandFound === "boolean" ? { commandFound: runtime.commandFound } : {}),
    ...(typeof runtime.processFound === "boolean" ? { processFound: runtime.processFound } : {}),
    ...(typeof runtime.tcpReachable === "boolean" ? { tcpReachable: runtime.tcpReachable } : {}),
    ...(runtime.modelsStatus ? { modelsStatus: runtime.modelsStatus } : {}),
    ...(runtime.chatStatus ? { chatStatus: runtime.chatStatus } : {}),
    ...(typeof runtime.modelCount === "number" ? { modelCount: runtime.modelCount } : {}),
    ...(typeof runtime.firstTokenMs === "number" ? { firstTokenMs: runtime.firstTokenMs } : {}),
    ...(typeof runtime.replyLength === "number" ? { replyLength: runtime.replyLength } : {}),
    ...(typeof runtime.modelsCheckMs === "number" ? { modelsCheckMs: runtime.modelsCheckMs } : {}),
    ...(typeof runtime.chatCheckMs === "number" ? { chatCheckMs: runtime.chatCheckMs } : {}),
    ...(typeof runtime.durationMs === "number" ? { durationMs: runtime.durationMs } : {}),
    ...(typeof runtime.managedEnabled === "boolean" ? { managedEnabled: runtime.managedEnabled } : {}),
    ...(typeof runtime.bundled === "boolean" ? { bundled: runtime.bundled } : {}),
    ...(runtime.resourceSource ? { resourceSource: runtime.resourceSource } : {}),
    ...(typeof runtime.manifestFound === "boolean" ? { manifestFound: runtime.manifestFound } : {}),
    ...(typeof runtime.executableConfigured === "boolean" ? { executableConfigured: runtime.executableConfigured } : {}),
    ...(typeof runtime.modelConfigured === "boolean" ? { modelConfigured: runtime.modelConfigured } : {})
  };
}

function parseLocalModelDiagnosticSafeSummary(value: unknown): LocalModelDiagnosticSafeSummary | null {
  const summary = value as Partial<LocalModelDiagnosticSafeSummary> | null;

  if (
    !summary ||
    typeof summary !== "object" ||
    hasUnsafeRuntimeField(summary) ||
    summary.safeSummaryOnly !== true ||
    typeof summary.ok !== "boolean" ||
    typeof summary.status !== "string" ||
    !localModelDiagnosticStatuses.includes(summary.status as (typeof localModelDiagnosticStatuses)[number]) ||
    typeof summary.recommendedRuntime !== "string" ||
    !isSafeRuntimeText(summary.recommendedRuntime) ||
    typeof summary.durationMs !== "number" ||
    !Number.isFinite(summary.durationMs) ||
    !Array.isArray(summary.runtimes)
  ) {
    return null;
  }

  const runtimes = summary.runtimes.map(parseLocalModelDiagnosticRuntimeSummary);

  if (runtimes.some((runtime) => runtime === null)) {
    return null;
  }

  return {
    ok: summary.ok,
    status: summary.status as LocalModelDiagnosticSafeSummary["status"],
    recommendedRuntime: summary.recommendedRuntime,
    durationMs: summary.durationMs,
    safeSummaryOnly: true,
    runtimes: runtimes as LocalModelDiagnosticSafeSummary["runtimes"]
  };
}

function parseLlamaCppRuntimeSafeSummary(value: unknown): LlamaCppRuntimeSafeSummary | null {
  const summary = value as Partial<LlamaCppRuntimeSafeSummary> | null;

  if (
    !summary ||
    typeof summary !== "object" ||
    hasUnsafeRuntimeField(summary) ||
    summary.runtime !== "llama.cpp" ||
    summary.safeSummaryOnly !== true ||
    typeof summary.enabled !== "boolean" ||
    typeof summary.status !== "string" ||
    !llamaCppRuntimeStatuses.includes(summary.status as LlamaCppRuntimeStatus) ||
    typeof summary.executableConfigured !== "boolean" ||
    typeof summary.modelConfigured !== "boolean" ||
    !isOptionalRuntimeString(summary.executableName) ||
    !isOptionalRuntimeString(summary.modelName) ||
    !isOptionalRuntimeString(summary.host) ||
    !isOptionalRuntimeString(summary.baseURLHost) ||
    !isOptionalRuntimeString(summary.alias) ||
    !isOptionalRuntimeNumber(summary.port) ||
    !isOptionalRuntimeNumber(summary.ctxSize) ||
    !isOptionalRuntimeNumber(summary.startupTimeoutMs) ||
    !isOptionalRuntimeNumber(summary.stopTimeoutMs) ||
    !isOptionalRuntimeNumber(summary.healthPollIntervalMs) ||
    !isOptionalRuntimeNumber(summary.durationMs) ||
    !isOptionalRuntimeNumber(summary.startupMs) ||
    !isOptionalRuntimeNumber(summary.stdoutBytes) ||
    !isOptionalRuntimeNumber(summary.stderrBytes) ||
    !(summary.exitCode === undefined || summary.exitCode === null || typeof summary.exitCode === "number") ||
    !(summary.signal === undefined || summary.signal === null || typeof summary.signal === "string") ||
    !(summary.reason === undefined || llamaCppRuntimeReasons.includes(summary.reason))
  ) {
    return null;
  }

  return {
    runtime: "llama.cpp",
    enabled: summary.enabled,
    status: summary.status as LlamaCppRuntimeStatus,
    safeSummaryOnly: true,
    executableConfigured: summary.executableConfigured,
    modelConfigured: summary.modelConfigured,
    ...(summary.executableName ? { executableName: summary.executableName } : {}),
    ...(summary.modelName ? { modelName: summary.modelName } : {}),
    ...(summary.host ? { host: summary.host } : {}),
    ...(typeof summary.port === "number" ? { port: summary.port } : {}),
    ...(typeof summary.ctxSize === "number" ? { ctxSize: summary.ctxSize } : {}),
    ...(summary.baseURLHost ? { baseURLHost: summary.baseURLHost } : {}),
    ...(summary.alias ? { alias: summary.alias } : {}),
    ...(typeof summary.startupTimeoutMs === "number" ? { startupTimeoutMs: summary.startupTimeoutMs } : {}),
    ...(typeof summary.stopTimeoutMs === "number" ? { stopTimeoutMs: summary.stopTimeoutMs } : {}),
    ...(typeof summary.healthPollIntervalMs === "number" ? { healthPollIntervalMs: summary.healthPollIntervalMs } : {}),
    ...(typeof summary.durationMs === "number" ? { durationMs: summary.durationMs } : {}),
    ...(typeof summary.startupMs === "number" ? { startupMs: summary.startupMs } : {}),
    ...(summary.exitCode !== undefined ? { exitCode: summary.exitCode } : {}),
    ...(summary.signal !== undefined ? { signal: summary.signal } : {}),
    ...(typeof summary.stdoutBytes === "number" ? { stdoutBytes: summary.stdoutBytes } : {}),
    ...(typeof summary.stderrBytes === "number" ? { stderrBytes: summary.stderrBytes } : {}),
    ...(summary.reason ? { reason: summary.reason } : {})
  };
}

function parseLlamaCppRuntimeSettingsUpdate(value: unknown): LlamaCppRuntimeSettingsUpdate | null {
  const update = value as Partial<LlamaCppRuntimeSettingsUpdate> | null;

  if (!update || typeof update !== "object" || hasUnsafeRuntimeField(update)) {
    return null;
  }

  const parsed: LlamaCppRuntimeSettingsUpdate = {};

  if ("enabled" in update) {
    if (typeof update.enabled !== "boolean") {
      return null;
    }
    parsed.enabled = update.enabled;
  }
  if ("host" in update) {
    if (typeof update.host !== "string") {
      return null;
    }
    parsed.host = update.host;
  }
  if ("port" in update) {
    if (update.port !== null && (typeof update.port !== "number" || !Number.isInteger(update.port))) {
      return null;
    }
    parsed.port = update.port;
  }
  if ("ctxSize" in update) {
    if (update.ctxSize !== null && (typeof update.ctxSize !== "number" || !Number.isInteger(update.ctxSize))) {
      return null;
    }
    parsed.ctxSize = update.ctxSize;
  }
  if ("alias" in update) {
    if (typeof update.alias !== "string") {
      return null;
    }
    parsed.alias = update.alias;
  }
  if ("startupTimeoutMs" in update) {
    if (typeof update.startupTimeoutMs !== "number" || !Number.isInteger(update.startupTimeoutMs)) {
      return null;
    }
    parsed.startupTimeoutMs = update.startupTimeoutMs;
  }
  if ("stopTimeoutMs" in update) {
    if (typeof update.stopTimeoutMs !== "number" || !Number.isInteger(update.stopTimeoutMs)) {
      return null;
    }
    parsed.stopTimeoutMs = update.stopTimeoutMs;
  }
  if ("healthPollIntervalMs" in update) {
    if (typeof update.healthPollIntervalMs !== "number" || !Number.isInteger(update.healthPollIntervalMs)) {
      return null;
    }
    parsed.healthPollIntervalMs = update.healthPollIntervalMs;
  }

  return parsed;
}

async function invokeLocalRuntimeSummary(channel: string, ...args: unknown[]): Promise<LlamaCppRuntimeSafeSummary> {
  const summary = parseLlamaCppRuntimeSafeSummary(await ipcRenderer.invoke(channel, ...args));

  if (!summary) {
    throw new Error("Invalid local runtime response");
  }

  return summary;
}

async function invokeLocalModelDiagnosticSummary(): Promise<LocalModelDiagnosticSafeSummary> {
  const summary = parseLocalModelDiagnosticSafeSummary(await ipcRenderer.invoke("localRuntime:diagnose-local-model"));

  if (!summary) {
    throw new Error("Invalid local model diagnostic response");
  }

  return summary;
}

function parseMemoryCardDraft(value: unknown): MemoryCardDraft | null {
  const draft = value as Partial<MemoryCardDraft> | null;
  const title = normalizeMemoryText(draft?.title, 80);
  const content = normalizeMemoryText(draft?.content, 800);
  const tags = normalizeMemoryTags(draft?.tags);

  if (!draft || !title || !content || !tags || !isMemoryId(draft.sourceConversationId)) {
    return null;
  }

  return {
    title,
    content,
    tags,
    sourceConversationId: draft.sourceConversationId
  };
}

function parseMemoryCardUpdate(value: unknown): MemoryCardUpdate | null {
  const update = value as Partial<MemoryCardUpdate> | null;

  if (!update || typeof update !== "object") {
    return null;
  }

  const parsed: MemoryCardUpdate = {};

  if ("title" in update) {
    const title = normalizeMemoryText(update.title, 80);

    if (!title) {
      return null;
    }

    parsed.title = title;
  }

  if ("content" in update) {
    const content = normalizeMemoryText(update.content, 800);

    if (!content) {
      return null;
    }

    parsed.content = content;
  }

  if ("tags" in update) {
    const tags = normalizeMemoryTags(update.tags);

    if (!tags) {
      return null;
    }

    parsed.tags = tags;
  }

  if ("enabled" in update) {
    if (typeof update.enabled !== "boolean") {
      return null;
    }

    parsed.enabled = update.enabled;
  }

  return parsed;
}

function parseMemoryCard(value: unknown): MemoryCard | null {
  const card = value as Partial<MemoryCard> | null;
  const title = normalizeMemoryText(card?.title, 80);
  const content = normalizeMemoryText(card?.content, 800);
  const tags = normalizeMemoryTags(card?.tags);
  const sourceType = parseMemorySourceType(card?.sourceType);
  const namespace = normalizeMemoryNamespace(card?.namespace);
  const key = normalizeMemoryKey(card?.key);
  const importance = parseMemoryImportance(card?.importance);
  const category = normalizeMemoryCategory(card?.category);
  const confidence = parseMemoryConfidence(card?.confidence);
  const sourceMessageId = card?.sourceMessageId;
  const observedCount = parsePositiveInteger(card?.observedCount);
  const lastObservedAt = parsePositiveInteger(card?.lastObservedAt);
  const compressionState = parseMemoryCompressionState(card?.compressionState);
  const lastInjectedAt = card?.lastInjectedAt;
  const injectionCount = card?.injectionCount;

  if (
    !card ||
    !isMemoryId(card.id) ||
    !title ||
    !content ||
    !tags ||
    !sourceType ||
    !namespace ||
    !key ||
    !importance ||
    !category ||
    confidence === null ||
    !(sourceMessageId === null || isMemoryId(sourceMessageId)) ||
    !isMemoryId(card.sourceConversationId) ||
    typeof card.createdAt !== "number" ||
    !Number.isSafeInteger(card.createdAt) ||
    card.createdAt <= 0 ||
    typeof card.updatedAt !== "number" ||
    !Number.isSafeInteger(card.updatedAt) ||
    card.updatedAt < card.createdAt ||
    observedCount === null ||
    lastObservedAt === null ||
    lastObservedAt < card.createdAt ||
    !compressionState ||
    typeof card.enabled !== "boolean" ||
    !(
      lastInjectedAt === null ||
      (
        typeof lastInjectedAt === "number" &&
        Number.isSafeInteger(lastInjectedAt) &&
        lastInjectedAt > 0
      )
    ) ||
    typeof injectionCount !== "number" ||
    !Number.isSafeInteger(injectionCount) ||
    injectionCount < 0
  ) {
    return null;
  }

  return {
    id: card.id,
    title,
    content,
    tags,
    sourceConversationId: card.sourceConversationId,
    sourceType,
    namespace,
    key,
    importance,
    category,
    confidence,
    sourceMessageId,
    observedCount,
    lastObservedAt,
    compressionState,
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
    enabled: card.enabled,
    lastInjectedAt,
    injectionCount
  };
}

function parseCountMap(value: unknown, expectedKeys?: readonly string[]): Record<string, number> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const entries = Object.entries(value);

  if (
    entries.some(([key, count]) => (
      typeof key !== "string" ||
      typeof count !== "number" ||
      !Number.isSafeInteger(count) ||
      count < 0
    ))
  ) {
    return null;
  }

  if (expectedKeys && expectedKeys.some((key) => !Object.prototype.hasOwnProperty.call(value, key))) {
    return null;
  }

  return Object.fromEntries(entries) as Record<string, number>;
}

function parseMemorySummary(value: unknown): MemorySummary | null {
  const summary = value as Partial<MemorySummary> | null;
  const sourceTypeCounts = parseCountMap(summary?.sourceTypeCounts, ["manual-chat", "auto-local-heuristic", "auto-local-model"]);
  const importanceCounts = parseCountMap(summary?.importanceCounts, ["key", "general"]);
  const compressionStateCounts = parseCountMap(summary?.compressionStateCounts, ["raw", "merged", "deduplicated", "budgeted"]);
  const categoryCounts = parseCountMap(summary?.categoryCounts);

  if (
    !summary ||
    typeof summary.enabled !== "boolean" ||
    !isNonNegativeSafeInteger(summary.totalCards) ||
    !isNonNegativeSafeInteger(summary.enabledCards) ||
    !isNonNegativeSafeInteger(summary.disabledCards) ||
    !isNonNegativeSafeInteger(summary.injectableCount) ||
    !isNonNegativeSafeInteger(summary.injectionBudget) ||
    !isNonNegativeSafeInteger(summary.compressionThreshold) ||
    !sourceTypeCounts ||
    !importanceCounts ||
    !compressionStateCounts ||
    !categoryCounts
  ) {
    return null;
  }

  return {
    enabled: summary.enabled,
    totalCards: summary.totalCards,
    enabledCards: summary.enabledCards,
    disabledCards: summary.disabledCards,
    injectableCount: summary.injectableCount,
    injectionBudget: summary.injectionBudget,
    compressionThreshold: summary.compressionThreshold,
    sourceTypeCounts: sourceTypeCounts as MemorySummary["sourceTypeCounts"],
    importanceCounts: importanceCounts as MemorySummary["importanceCounts"],
    compressionStateCounts: compressionStateCounts as MemorySummary["compressionStateCounts"],
    categoryCounts
  };
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isHistoryMessage(value: unknown): value is HistoryMessage {
  const message = value as Partial<HistoryMessage> | null;

  return Boolean(
    message &&
    isHistoryId(message.id) &&
    (message.role === "user" || message.role === "assistant") &&
    typeof message.content === "string" &&
    typeof message.createdAt === "number" &&
    Number.isSafeInteger(message.createdAt) &&
    message.createdAt > 0
  );
}

function isConversation(value: unknown): value is Conversation {
  const conversation = value as Partial<Conversation> | null;

  return Boolean(
    conversation &&
    isHistoryId(conversation.id) &&
    typeof conversation.title === "string" &&
    typeof conversation.createdAt === "number" &&
    Number.isSafeInteger(conversation.createdAt) &&
    typeof conversation.updatedAt === "number" &&
    Number.isSafeInteger(conversation.updatedAt) &&
    Array.isArray(conversation.messages) &&
    conversation.messages.every(isHistoryMessage)
  );
}

function isConversationSummary(value: unknown): value is ConversationSummary {
  const conversation = value as Partial<ConversationSummary> | null;

  return Boolean(
    conversation &&
    isHistoryId(conversation.id) &&
    typeof conversation.title === "string" &&
    typeof conversation.createdAt === "number" &&
    Number.isSafeInteger(conversation.createdAt) &&
    typeof conversation.updatedAt === "number" &&
    Number.isSafeInteger(conversation.updatedAt) &&
    typeof conversation.messageCount === "number" &&
    Number.isSafeInteger(conversation.messageCount) &&
    conversation.messageCount >= 0
  );
}

function isWebSearchSettings(value: unknown): value is WebSearchSettings {
  const settings = value as Partial<WebSearchSettings> | null;

  return Boolean(
    settings &&
    typeof settings.enabled === "boolean" &&
    typeof settings.command === "string" &&
    Array.isArray(settings.args) &&
    settings.args.every((arg) => typeof arg === "string") &&
    typeof settings.toolName === "string" &&
    typeof settings.timeoutMs === "number" &&
    Number.isSafeInteger(settings.timeoutMs) &&
    typeof settings.maxResults === "number" &&
    Number.isSafeInteger(settings.maxResults)
  );
}

function isWebSearchStatus(value: unknown): value is WebSearchStatus {
  const status = value as Partial<WebSearchStatus> | null;

  return Boolean(
    status &&
    typeof status.enabled === "boolean" &&
    typeof status.commandConfigured === "boolean" &&
    (status.commandName === undefined || typeof status.commandName === "string") &&
    typeof status.argsCount === "number" &&
    Number.isSafeInteger(status.argsCount) &&
    typeof status.toolName === "string" &&
    typeof status.timeoutMs === "number" &&
    Number.isSafeInteger(status.timeoutMs) &&
    typeof status.maxResults === "number" &&
    Number.isSafeInteger(status.maxResults)
  );
}

function isWebSearchConnectionTestResult(value: unknown): value is WebSearchConnectionTestResult {
  const result = value as Partial<WebSearchConnectionTestResult> | null;
  const statuses = [
    "not_configured",
    "configured_disabled",
    "tool_available",
    "tool_missing",
    "spawn_failed",
    "timeout",
    "failed"
  ];

  return Boolean(
    result &&
    typeof result.status === "string" &&
    statuses.includes(result.status) &&
    typeof result.commandConfigured === "boolean" &&
    typeof result.enabled === "boolean" &&
    typeof result.toolName === "string" &&
    typeof result.toolFound === "boolean" &&
    typeof result.toolCount === "number" &&
    Number.isSafeInteger(result.toolCount) &&
    result.toolCount >= 0 &&
    (result.commandName === undefined || typeof result.commandName === "string")
  );
}

const api: ChatApi = {
  focusInput() {
    ipcRenderer.once("chat:focus-input", () => {
      window.dispatchEvent(new CustomEvent("chat:focus-input"));
    });
  },
  sendMessage(request: ChatSendRequest) {
    if (!isChatSendRequest(request)) {
      return;
    }

    ipcRenderer.send("chat:send", request);
  },
  abortReply() {
    ipcRenderer.send("chat:abort");
  },
  onReplyDelta(handler) {
    const listener = (_event: Electron.IpcRendererEvent, delta: unknown): void => {
      if (isChatStreamDeltaPayload(delta)) {
        handler(delta);
      }
    };

    ipcRenderer.on("chat:stream-delta", listener);
    return () => {
      ipcRenderer.removeListener("chat:stream-delta", listener);
    };
  },
  onReplyDone(handler) {
    const listener = (_event: Electron.IpcRendererEvent, result: unknown): void => {
      if (isChatStreamDonePayload(result)) {
        handler(result);
      }
    };

    ipcRenderer.on("chat:stream-done", listener);
    return () => {
      ipcRenderer.removeListener("chat:stream-done", listener);
    };
  },
  onReplyError(handler) {
    const listener = (_event: Electron.IpcRendererEvent, error: unknown): void => {
      if (isChatStreamErrorPayload(error)) {
        handler(error);
      }
    };

    ipcRenderer.on("chat:stream-error", listener);
    return () => {
      ipcRenderer.removeListener("chat:stream-error", listener);
    };
  },
  onMemoryInjection(handler) {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      if (isChatMemoryInjectionPayload(payload)) {
        handler(payload);
      }
    };

    ipcRenderer.on("chat:memory-injection", listener);
    return () => {
      ipcRenderer.removeListener("chat:memory-injection", listener);
    };
  },
  onMemoryActivity(handler) {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      if (isChatMemoryActivityPayload(payload)) {
        handler(payload);
      }
    };

    ipcRenderer.on("chat:memory-activity", listener);
    return () => {
      ipcRenderer.removeListener("chat:memory-activity", listener);
    };
  },
  onContextTransparency(handler) {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      if (isChatContextTransparencyPayload(payload)) {
        handler(payload);
      }
    };

    ipcRenderer.on("chat:context-transparency", listener);
    return () => {
      ipcRenderer.removeListener("chat:context-transparency", listener);
    };
  },
  onPetActivityEcho(handler) {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      const echo = parsePetActivityEcho(payload);

      if (echo) {
        handler(echo);
      }
    };

    ipcRenderer.on("pet-activity:echo", listener);
    return () => {
      ipcRenderer.removeListener("pet-activity:echo", listener);
    };
  },
  setInteractionActive(isActive: boolean) {
    ipcRenderer.send("chat:interaction-active", Boolean(isActive));
  }
};

const configApi: ConfigApi = {
  async getProvider() {
    const config = await ipcRenderer.invoke("config:get-provider");

    if (!isProviderConfig(config)) {
      throw new Error("Invalid provider config response");
    }

    return config;
  },
  async getProviderStatus() {
    const status = await ipcRenderer.invoke("config:get-provider-status");

    if (!isProviderStatus(status)) {
      throw new Error("Invalid provider status response");
    }

    return status;
  },
  async checkProviderHealth(request) {
    if (!isProviderHealthCheckRequest(request)) {
      throw new Error("Invalid provider health request");
    }

    const result = await ipcRenderer.invoke("config:check-provider-health", request);

    if (!isProviderHealthResult(result)) {
      throw new Error("Invalid provider health response");
    }

    return result;
  },
  async setProvider(config) {
    if (!isProviderConfig(config)) {
      throw new Error("Invalid provider config");
    }

    const savedConfig = await ipcRenderer.invoke("config:set-provider", config);

    if (!isProviderConfig(savedConfig)) {
      throw new Error("Invalid provider config response");
    }

    return savedConfig;
  },
  async hasApiKey(request) {
    if (!isConfigApiKeyRequest(request)) {
      return false;
    }

    return Boolean(await ipcRenderer.invoke("config:has-api-key", request));
  },
  async setApiKey(request) {
    if (!isConfigSetApiKeyRequest(request)) {
      return false;
    }

    return Boolean(await ipcRenderer.invoke("config:set-api-key", request));
  },
  async deleteApiKey(request) {
    if (!isConfigApiKeyRequest(request)) {
      return false;
    }

    return Boolean(await ipcRenderer.invoke("config:delete-api-key", request));
  }
};

const localRuntimeApi: LocalRuntimeApi = {
  diagnoseLocalModel() {
    return invokeLocalModelDiagnosticSummary();
  },
  getLlamaCppSettings() {
    return invokeLocalRuntimeSummary("localRuntime:get-llama-cpp-settings");
  },
  updateLlamaCppSettings(update) {
    const parsedUpdate = parseLlamaCppRuntimeSettingsUpdate(update);

    if (!parsedUpdate) {
      throw new Error("Invalid local runtime settings update");
    }

    return invokeLocalRuntimeSummary("localRuntime:update-llama-cpp-settings", parsedUpdate);
  },
  chooseLlamaCppExecutable() {
    return invokeLocalRuntimeSummary("localRuntime:choose-llama-cpp-executable");
  },
  chooseLlamaCppModel() {
    return invokeLocalRuntimeSummary("localRuntime:choose-llama-cpp-model");
  },
  startLlamaCpp() {
    return invokeLocalRuntimeSummary("localRuntime:start-llama-cpp");
  },
  stopLlamaCpp() {
    return invokeLocalRuntimeSummary("localRuntime:stop-llama-cpp");
  },
  getLlamaCppStatus() {
    return invokeLocalRuntimeSummary("localRuntime:get-llama-cpp-status");
  }
};

const historyApi: HistoryApi = {
  async listConversations() {
    const conversations: unknown = await ipcRenderer.invoke("history:list");

    if (!Array.isArray(conversations) || !conversations.every(isConversationSummary)) {
      throw new Error("Invalid conversation history response");
    }

    return conversations;
  },
  async getConversation(id) {
    if (!isHistoryId(id)) {
      return null;
    }

    const conversation: unknown = await ipcRenderer.invoke("history:get", id);

    if (conversation !== null && !isConversation(conversation)) {
      throw new Error("Invalid conversation response");
    }

    return conversation;
  },
  async deleteConversation(id) {
    if (!isHistoryId(id)) {
      return false;
    }

    return Boolean(await ipcRenderer.invoke("history:delete", id));
  },
  async clearConversations() {
    await ipcRenderer.invoke("history:clear");
  }
};

const memoryApi: MemoryApi = {
  async getSettings() {
    const settings = await ipcRenderer.invoke("memory:get-settings");

    if (!settings || typeof settings.enabled !== "boolean") {
      throw new Error("Invalid memory settings response");
    }

    return { enabled: settings.enabled };
  },
  async getSummary() {
    const summary = parseMemorySummary(await ipcRenderer.invoke("memory:get-summary"));

    if (!summary) {
      throw new Error("Invalid memory summary response");
    }

    return summary;
  },
  async setEnabled(enabled) {
    const settings = await ipcRenderer.invoke("memory:set-enabled", Boolean(enabled));

    if (!settings || typeof settings.enabled !== "boolean") {
      throw new Error("Invalid memory settings response");
    }

    return { enabled: settings.enabled };
  },
  async listCards() {
    const cards: unknown = await ipcRenderer.invoke("memory:list");

    if (!Array.isArray(cards)) {
      throw new Error("Invalid memory list response");
    }

    const parsedCards = cards.map(parseMemoryCard);

    if (parsedCards.some((card) => card === null)) {
      throw new Error("Invalid memory card response");
    }

    return parsedCards as MemoryCard[];
  },
  async getCard(id) {
    if (!isMemoryId(id)) {
      return null;
    }

    const card: unknown = await ipcRenderer.invoke("memory:get", id);

    if (card === null) {
      return null;
    }

    const parsedCard = parseMemoryCard(card);

    if (!parsedCard) {
      throw new Error("Invalid memory card response");
    }

    return parsedCard;
  },
  async createCard(draft) {
    const parsedDraft = parseMemoryCardDraft(draft);

    if (!parsedDraft) {
      throw new Error("Invalid memory draft");
    }

    const card = parseMemoryCard(await ipcRenderer.invoke("memory:create", parsedDraft));

    if (!card) {
      throw new Error("Invalid memory card response");
    }

    return card;
  },
  async updateCard(id, update) {
    const parsedUpdate = parseMemoryCardUpdate(update);

    if (!isMemoryId(id) || !parsedUpdate) {
      return null;
    }

    const card: unknown = await ipcRenderer.invoke("memory:update", id, parsedUpdate);

    if (card === null) {
      return null;
    }

    const parsedCard = parseMemoryCard(card);

    if (!parsedCard) {
      throw new Error("Invalid memory card response");
    }

    return parsedCard;
  },
  async deleteCard(id) {
    if (!isMemoryId(id)) {
      return false;
    }

    return Boolean(await ipcRenderer.invoke("memory:delete", id));
  },
  async clearCards() {
    await ipcRenderer.invoke("memory:clear");
  }
};

const petPresentationApi: PetPresentationApi = {
  async getPreferences() {
    const preferences = await ipcRenderer.invoke("pet-presentation:get");
    const parsedPreferences = parsePetPresentationPreferences(preferences);

    if (!parsedPreferences) {
      throw new Error("Invalid pet presentation preferences response");
    }

    return parsedPreferences;
  },
  async setPetScale(petScale) {
    if (normalizePetScale(petScale) === null) {
      throw new Error("Invalid pet scale");
    }

    const preferences: unknown = await ipcRenderer.invoke("pet-presentation:set-scale", petScale);
    const parsedPreferences: PetPresentationPreferences | null = parsePetPresentationPreferences(preferences);

    if (!parsedPreferences) {
      throw new Error("Invalid pet presentation preferences response");
    }

    return parsedPreferences;
  },
  async setAccessoryPreset(presetId) {
    if (!isPetAccessoryPresetId(presetId)) {
      throw new Error("Invalid pet accessory preset");
    }

    const preferences: unknown = await ipcRenderer.invoke("pet-presentation:set-accessory", presetId);
    const parsedPreferences: PetPresentationPreferences | null = parsePetPresentationPreferences(preferences);

    if (!parsedPreferences) {
      throw new Error("Invalid pet presentation preferences response");
    }

    return parsedPreferences;
  },
  async getPetLockState() {
    const state = parsePetLockState(await ipcRenderer.invoke("pet-lock:get"));

    if (!state) {
      throw new Error("Invalid pet lock state response");
    }

    return state;
  },
  async setPetLocked(isLocked) {
    const state = parsePetLockState(await ipcRenderer.invoke("pet-lock:set", Boolean(isLocked)));

    if (!state) {
      throw new Error("Invalid pet lock state response");
    }

    return state;
  },
  onPetLockChanged(handler) {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const state = parsePetLockState(value);

      if (state) {
        handler(state);
      }
    };

    ipcRenderer.on("pet-lock:changed", listener);
    return () => {
      ipcRenderer.removeListener("pet-lock:changed", listener);
    };
  }
};

const shortcutApi: ShortcutApi = {
  async listShortcuts() {
    const shortcuts = parseShortcutPreferenceViews(await ipcRenderer.invoke("shortcuts:get"));

    if (!shortcuts) {
      throw new Error("Invalid shortcut preferences response");
    }

    return shortcuts;
  },
  async updateShortcut(actionId, accelerator) {
    if (!isShortcutActionId(actionId) || typeof accelerator !== "string") {
      throw new Error("Invalid shortcut update request");
    }

    const result = parseShortcutUpdateResult(await ipcRenderer.invoke("shortcuts:update", actionId, accelerator));

    if (!result) {
      throw new Error("Invalid shortcut update response");
    }

    return result;
  },
  async resetShortcut(actionId) {
    if (!isShortcutActionId(actionId)) {
      throw new Error("Invalid shortcut reset request");
    }

    const result = parseShortcutUpdateResult(await ipcRenderer.invoke("shortcuts:reset", actionId));

    if (!result) {
      throw new Error("Invalid shortcut reset response");
    }

    return result;
  }
};

const dialogueModeApi: DialogueModeApi = {
  listModes() {
    return dialogueModeViews.map((mode) => ({ ...mode }));
  },
  async getMode() {
    const modeId = parseDialogueModeId(await ipcRenderer.invoke("dialogueMode:get"));

    if (!modeId) {
      throw new Error("Invalid dialogue mode response");
    }

    return modeId;
  },
  async setMode(modeId) {
    if (!dialogueModeIds.includes(modeId)) {
      throw new Error("Invalid dialogue mode");
    }

    const nextModeId = parseDialogueModeId(await ipcRenderer.invoke("dialogueMode:set", modeId));

    if (!nextModeId) {
      throw new Error("Invalid dialogue mode response");
    }

    return nextModeId;
  },
  onModeChanged(handler) {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const modeId = parseDialogueModeId(value);

      if (modeId) {
        handler(modeId);
      }
    };

    ipcRenderer.on("dialogueMode:changed", listener);
    return () => {
      ipcRenderer.removeListener("dialogueMode:changed", listener);
    };
  }
};

const presenceModeApi: PresenceModeApi = {
  listModes() {
    return presenceModeViews.map((mode) => ({ ...mode }));
  },
  async getMode() {
    const modeId = parsePresenceModeId(await ipcRenderer.invoke("presenceMode:get"));

    if (!modeId) {
      throw new Error("Invalid presence mode response");
    }

    return modeId;
  },
  async setMode(modeId) {
    if (!presenceModeIds.includes(modeId)) {
      throw new Error("Invalid presence mode");
    }

    const nextModeId = parsePresenceModeId(await ipcRenderer.invoke("presenceMode:set", modeId));

    if (!nextModeId) {
      throw new Error("Invalid presence mode response");
    }

    return nextModeId;
  },
  onModeChanged(handler) {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      const modeId = parsePresenceModeId(value);

      if (modeId) {
        handler(modeId);
      }
    };

    ipcRenderer.on("presenceMode:changed", listener);
    return () => {
      ipcRenderer.removeListener("presenceMode:changed", listener);
    };
  }
};

const proactiveCompanionApi: ProactiveCompanionApi = {
  async getSettings() {
    return parseProactiveCompanionSettings(await ipcRenderer.invoke("proactiveCompanion:get-settings"));
  },
  async setSettings(update) {
    const parsedUpdate = parseProactiveCompanionSettingsUpdate(update);

    if (!parsedUpdate) {
      throw new Error("Invalid proactive companion settings");
    }

    return parseProactiveCompanionSettings(
      await ipcRenderer.invoke("proactiveCompanion:set-settings", parsedUpdate)
    );
  },
  onSettingsChanged(handler) {
    const listener = (_event: Electron.IpcRendererEvent, value: unknown): void => {
      handler(parseProactiveCompanionSettings(value));
    };

    ipcRenderer.on("proactiveCompanion:changed", listener);
    return () => {
      ipcRenderer.removeListener("proactiveCompanion:changed", listener);
    };
  }
};

const userProfileApi: UserProfileApi = {
  async getUserProfile() {
    const profile = await ipcRenderer.invoke("userProfile:get");

    if (profile === null) {
      return null;
    }

    const parsedProfile = parseUserProfile(profile);

    if (!parsedProfile) {
      throw new Error("Invalid user profile response");
    }

    return parsedProfile;
  },
  async saveUserProfile(profile) {
    const parsedInput = parseUserProfileInput(profile);

    if (!parsedInput) {
      throw new Error("Invalid user profile");
    }

    const savedProfile = parseUserProfile(await ipcRenderer.invoke("userProfile:save", parsedInput));

    if (!savedProfile) {
      throw new Error("Invalid user profile response");
    }

    return savedProfile;
  },
  async clearUserProfile() {
    await ipcRenderer.invoke("userProfile:clear");
  }
};

const webSearchApi: WebSearchApi = {
  async getSettings() {
    const settings = await ipcRenderer.invoke("webSearch:get-settings");

    if (!isWebSearchSettings(settings)) {
      return { ...DEFAULT_WEB_SEARCH_SETTINGS };
    }

    return { ...settings, args: [...settings.args] };
  },
  async getStatus() {
    const status = await ipcRenderer.invoke("webSearch:get-status");

    if (!isWebSearchStatus(status)) {
      throw new Error("Invalid web search status response");
    }

    return status;
  },
  async setSettings(settings: WebSearchSettings) {
    if (!isWebSearchSettings(settings)) {
      throw new Error("Invalid web search settings");
    }

    const savedSettings = await ipcRenderer.invoke("webSearch:set-settings", settings);

    if (!isWebSearchSettings(savedSettings)) {
      throw new Error("Invalid web search settings response");
    }

    return { ...savedSettings, args: [...savedSettings.args] };
  },
  async testConnection(settings?: WebSearchSettings) {
    if (settings !== undefined && !isWebSearchSettings(settings)) {
      throw new Error("Invalid web search settings");
    }

    const result = await ipcRenderer.invoke("webSearch:test-connection", settings);

    if (!isWebSearchConnectionTestResult(result)) {
      throw new Error("Invalid web search test response");
    }

    return result;
  }
};

ipcRenderer.on("chat:focus-input", () => {
  window.dispatchEvent(new CustomEvent("chat:focus-input"));
});

contextBridge.exposeInMainWorld("chatApi", api);
contextBridge.exposeInMainWorld("configApi", configApi);
contextBridge.exposeInMainWorld("localRuntimeApi", localRuntimeApi);
contextBridge.exposeInMainWorld("historyApi", historyApi);
contextBridge.exposeInMainWorld("memoryApi", memoryApi);
contextBridge.exposeInMainWorld("petPresentationApi", petPresentationApi);
contextBridge.exposeInMainWorld("shortcutApi", shortcutApi);
contextBridge.exposeInMainWorld("dialogueModeApi", dialogueModeApi);
contextBridge.exposeInMainWorld("presenceModeApi", presenceModeApi);
contextBridge.exposeInMainWorld("proactiveCompanionApi", proactiveCompanionApi);
contextBridge.exposeInMainWorld("userProfileApi", userProfileApi);
contextBridge.exposeInMainWorld("webSearchApi", webSearchApi);
