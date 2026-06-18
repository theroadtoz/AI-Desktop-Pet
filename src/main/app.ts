import {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  protocol,
  screen,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from "electron";
import { release as getOsRelease } from "node:os";
import type {
  ConfigApiKeyRequest,
  ConfigSetApiKeyRequest,
  ChatSendRequest,
  PetDragDelta,
  PetFirstFrameInfo,
  PetPointerHitState,
  PetTelemetryEvent,
  RenderHealth
} from "../shared/ipc-contract";
import { isChatMessage } from "../shared/ipc-contract";
import { emotionTags, type EmotionTag } from "../shared/emotion";
import { ChatEngineBusyError, createChatEngine, type ChatEngine } from "./services/chat/chat-engine";
import { createChatProviderFromConfig } from "./services/chat/provider-factory";
import { readEnvProviderConfig, type EnvProviderConfig } from "./services/config/env-config";
import {
  createProviderConfigStore,
  createProviderTelemetryPayload,
  DEFAULT_PROVIDER_CONFIG,
  type ProviderConfigStore
} from "./services/config/provider-config-store";
import { createSecureKeyStore, type SecureKeyStore } from "./services/config/secure-key-store";
import { registerModelAssetProtocol } from "./services/model-asset-protocol";
import { createPointerController, type PointerController } from "./services/pointer-controller";
import { createTelemetryService, type TelemetryPayload, type TelemetryService } from "./services/telemetry";
import { createChatWindow, focusChatInput, showChatWindow } from "./windows/chat-window";
import { createPetWindow } from "./windows/pet-window";

let petWindow: BrowserWindow | null = null;
let chatWindow: BrowserWindow | null = null;
let pointerController: PointerController | null = null;
let telemetry: TelemetryService | null = null;
let chatEngine: ChatEngine | null = null;
let providerConfigStore: ProviderConfigStore | null = null;
let secureKeyStore: SecureKeyStore | null = null;
let envProviderConfig: EnvProviderConfig | null = null;
let performanceHeartbeat: NodeJS.Timeout | null = null;

const PET_RENDERER_RECOVERY_WINDOW_MS = 60_000;
const PET_RENDERER_MAX_RECOVERIES = 3;
let petRendererRecoveryTimes: number[] = [];

const RENDERER_TELEMETRY_TYPES = new Set([
  "webgl_context_lost",
  "webgl_context_restored",
  "recovery_started",
  "recovery_succeeded",
  "recovery_failed"
]);

protocol.registerSchemesAsPrivileged([
  {
    scheme: "pet-model",
    privileges: {
      standard: true,
      secure: true,
      corsEnabled: true,
      supportFetchAPI: true
    }
  }
]);

const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
}

app.on("second-instance", () => {
  if (chatWindow) {
    showChatWindow(chatWindow);
    focusChatInput(chatWindow);
  }
});

app.on("child-process-gone", (_event, details) => {
  const payload = {
    type: details.type,
    reason: details.reason
  };
  logTelemetry("child_process_gone", payload);

  if (details.type.toLowerCase().includes("gpu")) {
    console.warn("[app] GPU child process gone", payload);
    return;
  }

  console.info("[app] child process gone", payload);
});

function canRecoverPetRenderer(): boolean {
  const now = Date.now();
  petRendererRecoveryTimes = petRendererRecoveryTimes.filter((time) => (
    now - time < PET_RENDERER_RECOVERY_WINDOW_MS
  ));

  if (petRendererRecoveryTimes.length >= PET_RENDERER_MAX_RECOVERIES) {
    logTelemetry("recovery_limit_reached", {
      source: "pet_renderer",
      limit: PET_RENDERER_MAX_RECOVERIES,
      windowMs: PET_RENDERER_RECOVERY_WINDOW_MS
    });
    console.warn("[pet] renderer recovery limit reached; automatic rebuild stopped", {
      limit: PET_RENDERER_MAX_RECOVERIES,
      windowMs: PET_RENDERER_RECOVERY_WINDOW_MS
    });
    return false;
  }

  petRendererRecoveryTimes.push(now);
  return true;
}

function createRecoverablePetWindow(): BrowserWindow {
  const nextPetWindow = createPetWindow();

  nextPetWindow.webContents.on("render-process-gone", (_event, details) => {
    console.warn("[pet] render process gone", {
      reason: details.reason,
      exitCode: details.exitCode
    });
    logTelemetry("renderer_process_gone", {
      window: "pet",
      reason: details.reason,
      exitCode: details.exitCode
    });

    if (petWindow !== nextPetWindow || !canRecoverPetRenderer()) {
      return;
    }

    rebuildPetWindow("renderer_process_gone");
  });

  return nextPetWindow;
}

function logTelemetry(type: string, payload: TelemetryPayload = {}): void {
  telemetry?.logEvent(type, payload);
}

function logStartupInfo(): void {
  logTelemetry("startup", {
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    chromiumVersion: process.versions.chrome,
    nodeVersion: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    windowsRelease: process.platform === "win32" ? getOsRelease() : undefined,
    userDataPath: app.getPath("userData")
  });
}

function getDisplaySnapshot(): TelemetryPayload[] {
  return screen.getAllDisplays().map((display) => ({
    id: display.id,
    bounds: display.bounds,
    workArea: display.workArea,
    scaleFactor: display.scaleFactor
  }));
}

function getWindowSnapshot(window: BrowserWindow | null, extras: TelemetryPayload = {}): TelemetryPayload | null {
  if (!window || window.isDestroyed()) {
    return null;
  }

  return {
    bounds: window.getBounds(),
    visible: window.isVisible(),
    alwaysOnTop: window.isAlwaysOnTop(),
    focusable: window.isFocusable(),
    ...extras
  };
}

function logWindowSnapshot(reason: string): void {
  logTelemetry("window_snapshot", {
    reason,
    displays: getDisplaySnapshot(),
    petWindow: getWindowSnapshot(petWindow, {
      ignoreMouseEvents: pointerController?.isIgnoringMouseEvents() ?? true
    }),
    chatWindow: getWindowSnapshot(chatWindow, {
      ignoreMouseEvents: false
    })
  });
}

function startPerformanceHeartbeat(): void {
  if (performanceHeartbeat) {
    return;
  }

  performanceHeartbeat = setInterval(() => {
    logTelemetry("performance_heartbeat", {
      processMetrics: app.getAppMetrics().map((metric) => ({
        pid: metric.pid,
        type: metric.type,
        cpu: metric.cpu,
        memory: metric.memory
      })),
      petWindowVisible: Boolean(petWindow && !petWindow.isDestroyed() && petWindow.isVisible()),
      chatWindowVisible: Boolean(chatWindow && !chatWindow.isDestroyed() && chatWindow.isVisible())
    });
  }, 5_000);
  performanceHeartbeat.unref();
}

function registerDiagnosticShortcuts(): void {
  if (app.isPackaged) {
    return;
  }

  const registered = globalShortcut.register("L", () => {
    logTelemetry("diagnostic_shortcut", {
      key: "L",
      action: "inject_webgl_context_loss"
    });

    if (petWindow && !petWindow.isDestroyed()) {
      petWindow.webContents.send("pet:inject-webgl-context-loss");
    }
  });

  if (!registered) {
    logTelemetry("diagnostic_shortcut_failed", {
      key: "L",
      action: "inject_webgl_context_loss"
    });
  }
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function sanitizeRenderHealth(state: RenderHealth): TelemetryPayload {
  return {
    renderer: state.renderer,
    framesPerSecond: readNumber(state.framesPerSecond),
    isContextLost: readBoolean(state.isContextLost),
    canvasWidth: readNumber(state.canvasWidth),
    canvasHeight: readNumber(state.canvasHeight),
    nonTransparentPixels: readNumber(state.nonTransparentPixels),
    opaqueBlackPixels: readNumber(state.opaqueBlackPixels),
    firstFrameMs: readNumber(state.firstFrameMs),
    renderStartMs: readNumber(state.renderStartMs),
    recoveryCount: readNumber(state.recoveryCount),
    rendererTimestamp: readNumber(state.timestamp),
    message: typeof state.message === "string" ? state.message : undefined
  };
}

function sanitizeFirstFrame(info: PetFirstFrameInfo): TelemetryPayload {
  return {
    firstFrameMs: readNumber(info.firstFrameMs),
    renderStartMs: readNumber(info.renderStartMs),
    renderer: info.renderer,
    recoveryCount: readNumber(info.recoveryCount)
  };
}

function sanitizeRendererTelemetry(event: PetTelemetryEvent): TelemetryPayload {
  const safePayload: TelemetryPayload = {};
  const payload = event.payload ?? {};

  for (const [key, value] of Object.entries(payload)) {
    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean" ||
      value === null
    ) {
      safePayload[key] = value;
    }
  }

  return safePayload;
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

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function getChatErrorType(error: unknown): "aborted" | "busy" | "failed" {
  if (isAbortError(error)) {
    return "aborted";
  }

  if (error instanceof ChatEngineBusyError) {
    return "busy";
  }

  return "failed";
}

function getChatErrorMessage(errorType: "aborted" | "busy" | "failed"): string {
  if (errorType === "aborted") {
    return "已中断。";
  }

  if (errorType === "busy") {
    return "回复仍在生成中。";
  }

  return "回复失败，请稍后再试。";
}

function rebuildPetWindow(recoverySource?: string): void {
  if (recoverySource) {
    logTelemetry("recovery_started", {
      source: recoverySource,
      window: "pet",
      recoveryCount: petRendererRecoveryTimes.length
    });
  }

  pointerController?.dispose();
  pointerController = null;

  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.destroy();
  }

  petWindow = createRecoverablePetWindow();
  pointerController = createPointerController(petWindow);
  logWindowSnapshot(recoverySource ? "pet_rebuild" : "pet_created");

  if (recoverySource) {
    logTelemetry("recovery_succeeded", {
      source: recoverySource,
      window: "pet",
      recoveryCount: petRendererRecoveryTimes.length
    });
  }
}

app.whenReady().then(async () => {
  telemetry = createTelemetryService();
  providerConfigStore = createProviderConfigStore({ logTelemetry });
  secureKeyStore = createSecureKeyStore({ logTelemetry });
  envProviderConfig = readEnvProviderConfig();
  chatEngine = createChatEngine(createProviderFromCurrentConfig());
  logStartupInfo();
  registerModelAssetProtocol();

  rebuildPetWindow();
  chatWindow = createChatWindow();
  logWindowSnapshot("startup");
  startPerformanceHeartbeat();
  registerDiagnosticShortcuts();

  function openChatWindow(): void {
    if (!chatWindow) {
      chatWindow = createChatWindow();
    }

    showChatWindow(chatWindow);
    focusChatInput(chatWindow);
    logWindowSnapshot("chat_opened");
  }

  function isPetSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    return Boolean(petWindow && event.sender === petWindow.webContents);
  }

  function isChatSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    return Boolean(chatWindow && event.sender === chatWindow.webContents);
  }

  function getCurrentProviderConfig() {
    if (envProviderConfig) {
      logTelemetry(
        "provider_config_loaded",
        createProviderTelemetryPayload(envProviderConfig.providerConfig, "env")
      );
      return envProviderConfig.providerConfig;
    }

    return providerConfigStore?.getConfig() ?? DEFAULT_PROVIDER_CONFIG;
  }

  function hasApiKey(apiKeyRef: string): boolean {
    if (
      envProviderConfig?.apiKeyRef === apiKeyRef &&
      typeof envProviderConfig.apiKey === "string" &&
      envProviderConfig.apiKey.length > 0
    ) {
      return true;
    }

    return secureKeyStore?.hasApiKey(apiKeyRef) ?? false;
  }

  function getApiKey(apiKeyRef: string): string | null {
    if (
      envProviderConfig?.apiKeyRef === apiKeyRef &&
      typeof envProviderConfig.apiKey === "string" &&
      envProviderConfig.apiKey.length > 0
    ) {
      return envProviderConfig.apiKey;
    }

    return secureKeyStore?.getApiKey(apiKeyRef) ?? null;
  }

  function createProviderFromCurrentConfig() {
    return createChatProviderFromConfig({
      config: getCurrentProviderConfig(),
      getApiKey,
      logTelemetry
    });
  }

  function isEmotionTag(value: unknown): value is EmotionTag {
    return typeof value === "string" && emotionTags.includes(value as EmotionTag);
  }

  ipcMain.handle("pet:open-chat", (event) => {
    if (!isPetSender(event)) {
      return;
    }

    openChatWindow();
  });

  ipcMain.on("pet:pointer-hit-change", (event, state: PetPointerHitState) => {
    if (!isPetSender(event) || typeof state?.isHit !== "boolean") {
      return;
    }

    pointerController?.setPointerHit(state.isHit);
  });

  ipcMain.on("pet:drag-start", (event) => {
    if (!isPetSender(event)) {
      return;
    }

    pointerController?.startDrag();
  });

  ipcMain.on("pet:drag-move", (event, delta: PetDragDelta) => {
    if (
      !isPetSender(event) ||
      typeof delta?.deltaX !== "number" ||
      typeof delta.deltaY !== "number"
    ) {
      return;
    }

    pointerController?.moveDrag(delta);
  });

  ipcMain.on("pet:drag-end", (event) => {
    if (!isPetSender(event)) {
      return;
    }

    pointerController?.endDrag();
  });

  ipcMain.on("pet:first-frame", (event, info: PetFirstFrameInfo) => {
    if (!isPetSender(event)) {
      return;
    }

    logTelemetry("first_frame", sanitizeFirstFrame(info));
    console.info("[pet] first frame reported");
  });

  ipcMain.on("pet:health", (event, state: RenderHealth) => {
    if (!isPetSender(event)) {
      return;
    }

    logTelemetry("pet_health", sanitizeRenderHealth(state));
    console.info("[pet] health", state);
  });

  ipcMain.on("pet:telemetry", (event, rendererEvent: PetTelemetryEvent) => {
    if (
      !isPetSender(event) ||
      !rendererEvent ||
      typeof rendererEvent.type !== "string" ||
      !RENDERER_TELEMETRY_TYPES.has(rendererEvent.type)
    ) {
      return;
    }

    logTelemetry(rendererEvent.type, sanitizeRendererTelemetry(rendererEvent));
  });

  ipcMain.on("chat:reply-emotion", (event, emotion: unknown) => {
    if (!isChatSender(event) || !isEmotionTag(emotion) || !petWindow || petWindow.isDestroyed()) {
      return;
    }

    petWindow.webContents.send("pet:apply-emotion", emotion);
  });

  ipcMain.on("chat:send", (event, request: unknown) => {
    if (!isChatSender(event) || !isChatSendRequest(request) || !chatEngine) {
      return;
    }

    const providerId = chatEngine.getProviderId();
    const startedAt = Date.now();
    let replyLength = 0;

    if (chatEngine.hasActiveStream()) {
      logTelemetry("chat_stream_failed", {
        providerId,
        conversationId: request.conversationId,
        messageCount: request.messages.length,
        replyLength,
        durationMs: 0,
        errorType: "busy"
      });
      event.sender.send("chat:stream-error", {
        message: getChatErrorMessage("busy"),
        errorType: "busy"
      });
      return;
    }

    logTelemetry("chat_stream_started", {
      providerId,
      conversationId: request.conversationId,
      messageCount: request.messages.length
    });

    void chatEngine.startChatStream(request, {
      onDelta(delta) {
        replyLength += delta.text.length;
        event.sender.send("chat:stream-delta", delta);
      }
    }).then((result) => {
      logTelemetry("chat_stream_completed", {
        providerId,
        conversationId: request.conversationId,
        messageCount: request.messages.length,
        replyLength: result.text.length,
        durationMs: Date.now() - startedAt,
        emotion: result.emotion
      });
      event.sender.send("chat:stream-done", result);
    }).catch((error: unknown) => {
      const errorType = getChatErrorType(error);
      const eventType = errorType === "aborted" ? "chat_stream_aborted" : "chat_stream_failed";

      logTelemetry(eventType, {
        providerId,
        conversationId: request.conversationId,
        messageCount: request.messages.length,
        replyLength,
        durationMs: Date.now() - startedAt,
        errorType
      });
      event.sender.send("chat:stream-error", {
        message: getChatErrorMessage(errorType),
        errorType
      });

      if (errorType === "failed") {
        console.warn("[chat] stream failed", {
          message: error instanceof Error ? error.message : String(error)
        });
      }
    });
  });

  ipcMain.on("chat:abort", (event) => {
    if (!isChatSender(event) || !chatEngine) {
      return;
    }

    chatEngine.abortActiveStream();
  });

  ipcMain.handle("config:get-provider", (event) => {
    if (!isChatSender(event)) {
      throw new Error("Unauthorized config request");
    }

    return getCurrentProviderConfig();
  });

  ipcMain.handle("config:set-provider", (event, config: unknown) => {
    if (!isChatSender(event) || !providerConfigStore) {
      throw new Error("Unauthorized config request");
    }

    const savedConfig = providerConfigStore.saveConfig(config);
    chatEngine?.setProvider(createProviderFromCurrentConfig());
    return savedConfig;
  });

  ipcMain.handle("config:has-api-key", (event, request: unknown) => {
    if (!isChatSender(event) || !isConfigApiKeyRequest(request)) {
      return false;
    }

    return hasApiKey(request.apiKeyRef);
  });

  ipcMain.handle("config:set-api-key", (event, request: unknown) => {
    if (!isChatSender(event) || !isConfigSetApiKeyRequest(request) || !secureKeyStore) {
      return false;
    }

    secureKeyStore.setApiKey(request.apiKeyRef, request.apiKey);
    return true;
  });

  ipcMain.handle("config:delete-api-key", (event, request: unknown) => {
    if (!isChatSender(event) || !isConfigApiKeyRequest(request) || !secureKeyStore) {
      return false;
    }

    return secureKeyStore.deleteApiKey(request.apiKeyRef);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("activate", () => {
  if (!petWindow || petWindow.isDestroyed()) {
    rebuildPetWindow();
  }
});
