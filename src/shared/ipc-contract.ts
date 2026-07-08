import type { EmotionPresentation } from "./emotion-presentation";
import type { ChatMessage } from "./chat";
import type { MemoryCard, MemoryCardDraft, MemoryCardUpdate, MemorySettings, MemorySummary } from "./chat-memory";
import type { Conversation, ConversationSummary } from "./chat-history";
import type { ChatProviderResult, ChatRequest, ChatStreamDelta } from "./chat-provider";
import type { ProviderHealthCheckRequest, ProviderHealthResult } from "./provider-health";
import type { DialogueModeId, DialogueModeView } from "./dialogue-style";
import type { PresenceModeId, PresenceModeView } from "./presence-mode";
import type { ProviderConfig, ProviderStatus } from "./provider-config";
import type { PetPresentationPreferences, PetScaleAdjustmentIntent } from "./pet-presentation";
import type { PetAccessoryPresetId } from "./pet-accessory";
import type { PetPresentationIntent } from "./pet-role-state";
import type { PetTelemetryEvent } from "./pet-telemetry-contract";
import type { ShortcutActionId, ShortcutPreferenceView, ShortcutUpdateResult } from "./shortcut-preferences";
import type { UserProfile, UserProfileInput } from "./user-profile";
import type { PetActionTrigger } from "./pet-action-trigger";
import type { LlamaCppRuntimeSafeSummary, LlamaCppRuntimeSettingsUpdate } from "./llama-cpp-runtime";
import type { LocalModelDiagnosticSafeSummary } from "./local-model-diagnostic";
import type { ProactiveSpeechBubblePayload } from "./proactive-speech-bubble";
import type {
  ProactiveCompanionSettings,
  ProactiveCompanionSettingsUpdate
} from "./proactive-companion-settings";
import type {
  WebSearchCitationPayload,
  WebSearchConnectionTestResult,
  WebSearchSettings,
  WebSearchStatus
} from "./web-search";

export type { PetTelemetryEvent } from "./pet-telemetry-contract";

export type PetWindowCommand =
  | { type: "pet:first-frame"; payload?: PetFirstFrameInfo }
  | { type: "pet:health"; payload: RenderHealth }
  | { type: "pet:telemetry"; payload: PetTelemetryEvent }
  | { type: "pet:pointer-hit-change"; payload: PetPointerHitState }
  | { type: "pet:apply-presentation"; payload: PetPresentationIntent }
  | { type: "pet:action-trigger"; payload: PetActionTrigger }
  | { type: "pet:proactive-speech-bubble"; payload: ProactiveSpeechBubblePayload }
  | { type: "pet:clear-proactive-speech-bubble" }
  | { type: "pet:window-motion-feedback"; payload: PetWindowMotionFeedback }
  | { type: "presenceMode:changed"; payload: PresenceModeId }
  | { type: "pet:inject-webgl-context-loss" }
  | { type: "pet:open-chat" }
  | { type: "pet:drag-start" }
  | { type: "pet:drag-move"; payload: PetDragDelta }
  | { type: "pet:drag-end" }
  | { type: "shortcuts:scale-wheel-modifier-changed"; payload: string };

export type ChatWindowCommand =
  | { type: "chat:focus-input" }
  | { type: "pet-lock:changed"; payload: PetLockState }
  | { type: "dialogueMode:changed"; payload: DialogueModeId }
  | { type: "presenceMode:changed"; payload: PresenceModeId }
  | { type: "proactiveCompanion:changed"; payload: ProactiveCompanionSettings }
  | { type: "pet-activity:echo"; payload: PetActivityEcho };

export type ChatSendRequest = Pick<ChatRequest, "requestVersion" | "conversationId" | "messages">;

export type ChatStreamDeltaPayload = ChatStreamDelta & { requestVersion: number };

export type ChatStreamDonePayload = ChatProviderResult & {
  requestVersion: number;
  webSearchCitation?: WebSearchCitationPayload;
};

export type ChatStreamErrorType =
  | "aborted"
  | "busy"
  | "missing_api_key"
  | "invalid_config"
  | "auth_failed"
  | "rate_limited"
  | "server_error"
  | "timeout"
  | "model_missing"
  | "incompatible_response"
  | "network_error"
  | "failed";

export type ChatStreamErrorPayload = {
  requestVersion: number;
  message: string;
  errorType: ChatStreamErrorType;
};

export type ChatMemoryInjectionPayload = {
  requestVersion: number;
  count: number;
};

export type ChatMemoryActivitySkippedReason =
  | "disabled"
  | "sensitive"
  | "no_candidate"
  | "capture_failed"
  | null;

export type ChatMemoryActivityPayload = {
  requestVersion: number;
  autoCapture: {
    enabled: boolean;
    skippedReason: ChatMemoryActivitySkippedReason;
    capturedCount: number;
    keyCount: number;
    generalCount: number;
    mergedCount: number;
    deduplicatedCount: number;
    compressionTriggered: boolean;
    totalCards: number;
    injectionBudget: number;
  };
  injection: {
    count: number;
  };
  contextBudget: {
    compressed: boolean;
    summaryMessageCount: number;
    summarizedMessageCount: number;
    recentMessageCount: number;
  };
};

export type ChatContextTransparencyPayload = {
  requestVersion: number;
  contextBudget: {
    originalMessageCount: number;
    providerMessageCount: number;
    compressed: boolean;
    summaryMessageCount: number;
    summarizedMessageCount: number;
    recentMessageCount: number;
  };
  memory: {
    injectionCount: number;
  };
  webSearch: {
    included: boolean;
    citationCount: number;
  };
};

export type ConfigApiKeyRequest = {
  apiKeyRef: string;
};

export type ConfigSetApiKeyRequest = ConfigApiKeyRequest & {
  apiKey: string;
};

export type RenderHealth = {
  framesPerSecond: number;
  isContextLost: boolean;
  timestamp: number;
  renderer?: "live2d" | "placeholder";
  message?: string;
  canvasWidth?: number;
  canvasHeight?: number;
  nonTransparentPixels?: number;
  opaqueBlackPixels?: number;
  firstFrameMs?: number;
  renderStartMs?: number;
  recoveryCount?: number;
};

export type PetFirstFrameInfo = {
  firstFrameMs: number;
  renderStartMs: number;
  renderer: "live2d" | "placeholder";
  recoveryCount: number;
};

export type PetPointerHitState = {
  isHit: boolean;
};

export type PetDragDelta = {
  deltaX: number;
  deltaY: number;
};

export type PetWindowMotionFeedback = {
  type: "shake_light_feedback";
};

export type PetActivityEcho = {
  message: string;
};

export type PetLockState = {
  isLocked: boolean;
};

export type PetApi = {
  reportFirstFrame(info: PetFirstFrameInfo): void;
  reportRenderHealth(state: RenderHealth): void;
  reportTelemetry(type: string, payload?: Record<string, unknown>): void;
  setPointerHit(isHit: boolean): void;
  presentationReady(): void;
  onPresentationIntent(handler: (intent: PetPresentationIntent) => void): () => void;
  onActionTrigger(handler: (trigger: PetActionTrigger) => void): () => void;
  onProactiveSpeechBubble(handler: (payload: ProactiveSpeechBubblePayload) => void): () => void;
  onClearProactiveSpeechBubble(handler: () => void): () => void;
  onInjectWebGLContextLoss(handler: () => void): () => void;
  onWindowMotionFeedback(handler: (feedback: PetWindowMotionFeedback) => void): () => void;
  openChat(): void;
  startDrag(): void;
  moveDrag(delta: PetDragDelta): void;
  endDrag(): void;
  adjustScale(intent: PetScaleAdjustmentIntent): void;
  getScaleWheelModifier(): Promise<string>;
  onScaleWheelModifierChanged(handler: (accelerator: string) => void): () => void;
  getDialogueMode(): Promise<DialogueModeId>;
  onDialogueModeChanged(handler: (modeId: DialogueModeId) => void): () => void;
  getPresenceMode(): Promise<PresenceModeId>;
  onPresenceModeChanged(handler: (modeId: PresenceModeId) => void): () => void;
};

export type ChatApi = {
  focusInput(): void;
  sendMessage(request: ChatSendRequest): void;
  abortReply(): void;
  onReplyDelta(handler: (delta: ChatStreamDeltaPayload) => void): () => void;
  onReplyDone(handler: (result: ChatStreamDonePayload) => void): () => void;
  onReplyError(handler: (error: ChatStreamErrorPayload) => void): () => void;
  onMemoryInjection(handler: (payload: ChatMemoryInjectionPayload) => void): () => void;
  onMemoryActivity(handler: (payload: ChatMemoryActivityPayload) => void): () => void;
  onContextTransparency(handler: (payload: ChatContextTransparencyPayload) => void): () => void;
  onPetActivityEcho(handler: (echo: PetActivityEcho) => void): () => void;
  setInteractionActive(isActive: boolean): void;
};

export type ConfigApi = {
  getProvider(): Promise<ProviderConfig>;
  getProviderStatus(): Promise<ProviderStatus>;
  checkProviderHealth(request: ProviderHealthCheckRequest): Promise<ProviderHealthResult>;
  setProvider(config: ProviderConfig): Promise<ProviderConfig>;
  hasApiKey(request: ConfigApiKeyRequest): Promise<boolean>;
  setApiKey(request: ConfigSetApiKeyRequest): Promise<boolean>;
  deleteApiKey(request: ConfigApiKeyRequest): Promise<boolean>;
};

export type LocalRuntimeApi = {
  diagnoseLocalModel(): Promise<LocalModelDiagnosticSafeSummary>;
  getLlamaCppSettings(): Promise<LlamaCppRuntimeSafeSummary>;
  updateLlamaCppSettings(update: LlamaCppRuntimeSettingsUpdate): Promise<LlamaCppRuntimeSafeSummary>;
  chooseLlamaCppExecutable(): Promise<LlamaCppRuntimeSafeSummary>;
  chooseLlamaCppModel(): Promise<LlamaCppRuntimeSafeSummary>;
  startLlamaCpp(): Promise<LlamaCppRuntimeSafeSummary>;
  stopLlamaCpp(): Promise<LlamaCppRuntimeSafeSummary>;
  getLlamaCppStatus(): Promise<LlamaCppRuntimeSafeSummary>;
};

export type HistoryApi = {
  listConversations(): Promise<ConversationSummary[]>;
  getConversation(id: string): Promise<Conversation | null>;
  deleteConversation(id: string): Promise<boolean>;
  clearConversations(): Promise<void>;
};

export type MemoryApi = {
  getSettings(): Promise<MemorySettings>;
  getSummary(): Promise<MemorySummary>;
  setEnabled(enabled: boolean): Promise<MemorySettings>;
  listCards(): Promise<MemoryCard[]>;
  getCard(id: string): Promise<MemoryCard | null>;
  createCard(draft: MemoryCardDraft): Promise<MemoryCard>;
  updateCard(id: string, update: MemoryCardUpdate): Promise<MemoryCard | null>;
  deleteCard(id: string): Promise<boolean>;
  clearCards(): Promise<void>;
};

export type DialogueModeApi = {
  listModes(): DialogueModeView[];
  getMode(): Promise<DialogueModeId>;
  setMode(modeId: DialogueModeId): Promise<DialogueModeId>;
  onModeChanged(handler: (modeId: DialogueModeId) => void): () => void;
};

export type PresenceModeApi = {
  listModes(): PresenceModeView[];
  getMode(): Promise<PresenceModeId>;
  setMode(modeId: PresenceModeId): Promise<PresenceModeId>;
  onModeChanged(handler: (modeId: PresenceModeId) => void): () => void;
};

export type ProactiveCompanionApi = {
  getSettings(): Promise<ProactiveCompanionSettings>;
  setSettings(update: ProactiveCompanionSettingsUpdate): Promise<ProactiveCompanionSettings>;
  onSettingsChanged(handler: (settings: ProactiveCompanionSettings) => void): () => void;
};

export type UserProfileApi = {
  getUserProfile(): Promise<UserProfile | null>;
  saveUserProfile(profile: UserProfileInput): Promise<UserProfile>;
  clearUserProfile(): Promise<void>;
};

export type PetPresentationApi = {
  getPreferences(): Promise<PetPresentationPreferences>;
  setPetScale(petScale: number): Promise<PetPresentationPreferences>;
  setAccessoryPreset(presetId: PetAccessoryPresetId): Promise<PetPresentationPreferences>;
  getPetLockState(): Promise<PetLockState>;
  setPetLocked(isLocked: boolean): Promise<PetLockState>;
  onPetLockChanged(handler: (state: PetLockState) => void): () => void;
};

export type ShortcutApi = {
  listShortcuts(): Promise<ShortcutPreferenceView[]>;
  updateShortcut(actionId: ShortcutActionId, accelerator: string): Promise<ShortcutUpdateResult>;
  resetShortcut(actionId: ShortcutActionId): Promise<ShortcutUpdateResult>;
};

export type WebSearchApi = {
  getSettings(): Promise<WebSearchSettings>;
  getStatus(): Promise<WebSearchStatus>;
  setSettings(settings: WebSearchSettings): Promise<WebSearchSettings>;
  testConnection(settings?: WebSearchSettings): Promise<WebSearchConnectionTestResult>;
};

export function isChatMessage(value: unknown): value is ChatMessage {
  const message = value as Partial<ChatMessage> | null;

  return Boolean(
    message &&
    typeof message.id === "string" &&
    (message.role === "user" || message.role === "assistant") &&
    typeof message.content === "string"
  );
}
