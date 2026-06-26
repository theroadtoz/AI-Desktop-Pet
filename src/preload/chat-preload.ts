import { contextBridge, ipcRenderer } from "electron";
import type {
  ChatApi,
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
  MemoryApi,
  PetLockState,
  PetPresentationApi,
  ShortcutApi
} from "../shared/ipc-contract";
import type { Conversation, ConversationSummary, HistoryMessage } from "../shared/chat-history";
import type { MemoryCard, MemoryCardDraft, MemoryCardUpdate } from "../shared/chat-memory";
import type { DialogueModeId, DialogueModeView } from "../shared/dialogue-style";
import type { ProviderConfig, ProviderStatus } from "../shared/provider-config";
import type { PetPresentationPreferences } from "../shared/pet-presentation";
import type { ShortcutActionId, ShortcutPreferenceView, ShortcutUpdateResult } from "../shared/shortcut-preferences";

const petAccessoryPresetIds = ["none", "glasses"] as const;
const shortcutActionIds = ["togglePetLock", "adjustPetScaleWithWheel"] as const;
const dialogueModeIds = ["default", "work", "game", "reading"] as const;
const dialogueModeViews: readonly DialogueModeView[] = [
  { id: "default", label: "默认陪伴" },
  { id: "work", label: "工作" },
  { id: "game", label: "游戏" },
  { id: "reading", label: "读书" }
];
const chatStreamErrorTypes = [
  "aborted",
  "busy",
  "auth_failed",
  "rate_limited",
  "server_error",
  "network_error",
  "failed"
] as const;

const emotionTags = ["neutral", "happy", "sad", "surprised", "confused", "angry"] as const;
const emotionIntensities = ["low", "medium", "high"] as const;
const PET_SCALE_MIN = 0.7;
const PET_SCALE_MAX = 1.35;
const PET_SCALE_STEP = 0.05;

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
    isEmotionIntensity(result.intensity)
  );
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

  if (
    !card ||
    !isMemoryId(card.id) ||
    !title ||
    !content ||
    !tags ||
    !isMemoryId(card.sourceConversationId) ||
    typeof card.createdAt !== "number" ||
    !Number.isSafeInteger(card.createdAt) ||
    card.createdAt <= 0 ||
    typeof card.updatedAt !== "number" ||
    !Number.isSafeInteger(card.updatedAt) ||
    card.updatedAt < card.createdAt ||
    typeof card.enabled !== "boolean"
  ) {
    return null;
  }

  return {
    id: card.id,
    title,
    content,
    tags,
    sourceConversationId: card.sourceConversationId,
    createdAt: card.createdAt,
    updatedAt: card.updatedAt,
    enabled: card.enabled
  };
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

ipcRenderer.on("chat:focus-input", () => {
  window.dispatchEvent(new CustomEvent("chat:focus-input"));
});

contextBridge.exposeInMainWorld("chatApi", api);
contextBridge.exposeInMainWorld("configApi", configApi);
contextBridge.exposeInMainWorld("historyApi", historyApi);
contextBridge.exposeInMainWorld("memoryApi", memoryApi);
contextBridge.exposeInMainWorld("petPresentationApi", petPresentationApi);
contextBridge.exposeInMainWorld("shortcutApi", shortcutApi);
contextBridge.exposeInMainWorld("dialogueModeApi", dialogueModeApi);
