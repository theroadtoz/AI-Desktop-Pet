import type { EmotionPresentation } from "./emotion-presentation";
import type { ChatMessage } from "./chat";
import type { MemoryCard, MemoryCardDraft, MemoryCardUpdate, MemorySettings } from "./chat-memory";
import type { Conversation, ConversationSummary } from "./chat-history";
import type { ChatProviderResult, ChatRequest, ChatStreamDelta } from "./chat-provider";
import type { ProviderConfig, ProviderStatus } from "./provider-config";
import type { PetPresentationPreferences, PetScaleAdjustmentIntent } from "./pet-presentation";
import type { PetAccessoryPresetId } from "./pet-accessory";
import type { PetPresentationIntent } from "./pet-role-state";
import type { ShortcutActionId, ShortcutPreferenceView, ShortcutUpdateResult } from "./shortcut-preferences";

export type PetWindowCommand =
  | { type: "pet:first-frame"; payload?: PetFirstFrameInfo }
  | { type: "pet:health"; payload: RenderHealth }
  | { type: "pet:telemetry"; payload: PetTelemetryEvent }
  | { type: "pet:pointer-hit-change"; payload: PetPointerHitState }
  | { type: "pet:apply-presentation"; payload: PetPresentationIntent }
  | { type: "pet:inject-webgl-context-loss" }
  | { type: "pet:open-chat" }
  | { type: "pet:drag-start" }
  | { type: "pet:drag-move"; payload: PetDragDelta }
  | { type: "pet:drag-end" };

export type ChatWindowCommand =
  | { type: "chat:focus-input" }
  | { type: "pet-lock:changed"; payload: PetLockState };

export type ChatSendRequest = ChatRequest;

export type ChatStreamDeltaPayload = ChatStreamDelta & { requestVersion: number };

export type ChatStreamDonePayload = ChatProviderResult & { requestVersion: number };

export type ChatStreamErrorType =
  | "aborted"
  | "busy"
  | "auth_failed"
  | "rate_limited"
  | "server_error"
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

export type PetTelemetryEvent = {
  type: string;
  payload?: Record<string, unknown>;
};

export type PetPointerHitState = {
  isHit: boolean;
};

export type PetDragDelta = {
  deltaX: number;
  deltaY: number;
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
  onInjectWebGLContextLoss(handler: () => void): () => void;
  openChat(): void;
  startDrag(): void;
  moveDrag(delta: PetDragDelta): void;
  endDrag(): void;
  adjustScale(intent: PetScaleAdjustmentIntent): void;
};

export type ChatApi = {
  focusInput(): void;
  sendMessage(request: ChatSendRequest): void;
  abortReply(): void;
  onReplyDelta(handler: (delta: ChatStreamDeltaPayload) => void): () => void;
  onReplyDone(handler: (result: ChatStreamDonePayload) => void): () => void;
  onReplyError(handler: (error: ChatStreamErrorPayload) => void): () => void;
  onMemoryInjection(handler: (payload: ChatMemoryInjectionPayload) => void): () => void;
  setInteractionActive(isActive: boolean): void;
};

export type ConfigApi = {
  getProvider(): Promise<ProviderConfig>;
  getProviderStatus(): Promise<ProviderStatus>;
  setProvider(config: ProviderConfig): Promise<ProviderConfig>;
  hasApiKey(request: ConfigApiKeyRequest): Promise<boolean>;
  setApiKey(request: ConfigSetApiKeyRequest): Promise<boolean>;
  deleteApiKey(request: ConfigApiKeyRequest): Promise<boolean>;
};

export type HistoryApi = {
  listConversations(): Promise<ConversationSummary[]>;
  getConversation(id: string): Promise<Conversation | null>;
  deleteConversation(id: string): Promise<boolean>;
  clearConversations(): Promise<void>;
};

export type MemoryApi = {
  getSettings(): Promise<MemorySettings>;
  setEnabled(enabled: boolean): Promise<MemorySettings>;
  listCards(): Promise<MemoryCard[]>;
  getCard(id: string): Promise<MemoryCard | null>;
  createCard(draft: MemoryCardDraft): Promise<MemoryCard>;
  updateCard(id: string, update: MemoryCardUpdate): Promise<MemoryCard | null>;
  deleteCard(id: string): Promise<boolean>;
  clearCards(): Promise<void>;
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

export function isChatMessage(value: unknown): value is ChatMessage {
  const message = value as Partial<ChatMessage> | null;

  return Boolean(
    message &&
    typeof message.id === "string" &&
    (message.role === "user" || message.role === "assistant") &&
    typeof message.content === "string"
  );
}
