import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  protocol,
  screen,
  type OpenDialogOptions,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from "electron";
import { release as getOsRelease } from "node:os";
import { isAbsolute } from "node:path";
import type { ChatRuntimeContext } from "../shared/chat-provider";
import type {
  ConfigApiKeyRequest,
  ConfigSetApiKeyRequest,
  ChatStreamErrorType,
  ChatSendRequest,
  PetActivityEcho,
  PetDragDelta,
  PetFirstFrameInfo,
  PetPointerHitState,
  PetTelemetryEvent,
  RenderHealth
} from "../shared/ipc-contract";
import { isChatMessage } from "../shared/ipc-contract";
import { isHistoryId, type HistoryMessage } from "../shared/chat-history";
import { isMemoryId, parseMemoryCardDraft, parseMemoryCardUpdate, type MemoryCardUpdate } from "../shared/chat-memory";
import { DIALOGUE_MODE_VIEWS, isDialogueModeId, type DialogueModeId } from "../shared/dialogue-style";
import { PRESENCE_MODE_VIEWS, isPresenceModeId, type PresenceModeId } from "../shared/presence-mode";
import { selectEmotionPresentation } from "../shared/emotion-presentation";
import {
  getPetInteractionActionSafeEchoMessage,
  getPetWindowMotionFeedbackSafeEchoMessage
} from "../shared/interaction-action-catalog";
import { isPetAccessoryPresetId } from "../shared/pet-accessory";
import {
  createPetPresentationIntent,
  INITIAL_PET_ROLE_SNAPSHOT,
  reducePetRoleState,
  type PetPresentationIntent,
  type PetRoleEvent,
  type PetRoleSnapshot
} from "../shared/pet-role-state";
import type { LocalOpenAICompatibleConfig, ProviderConfig, ProviderStatus } from "../shared/provider-config";
import type { ProviderHealthCheckRequest } from "../shared/provider-health";
import type { LlamaCppRuntimeSettingsUpdate } from "../shared/llama-cpp-runtime";
import {
  parseLocalModelDiagnosticSafeSummary,
  type LocalModelDiagnosticSafeSummary
} from "../shared/local-model-diagnostic";
import { createUserProfilePromptContext } from "../shared/user-profile";
import {
  calculateInitialPetBounds,
  calculateScaledPetBounds,
  canApplyPetScaleAdjustment,
  clampPetBounds,
  DEFAULT_PET_PRESENTATION_PREFERENCES,
  getAdjustedPetScale,
  normalizePetScale,
  parsePetScaleAdjustmentIntent,
  type PetPresentationPreferences
} from "../shared/pet-presentation";
import {
  isPetNearWorkAreaEdge,
  type PetActionTriggerReason
} from "../shared/pet-action-trigger";
import { ChatEngineBusyError, createChatEngine, type ChatEngine } from "./services/chat/chat-engine";
import { budgetChatContext } from "./services/chat/chat-context-budget";
import { createHistoryStore, type HistoryStore } from "./services/chat/history-store";
import { createMemoryStore, type MemoryStore } from "./services/chat/memory-store";
import { createChatProviderFromConfig } from "./services/chat/provider-factory";
import { checkProviderHealth } from "./services/chat/provider-health";
import { readEnvProviderConfig, type EnvProviderConfig } from "./services/config/env-config";
import { createDialogueModeStore, type DialogueModeStore } from "./services/config/dialogue-mode-store";
import { createPresenceModeStore, type PresenceModeStore } from "./services/config/presence-mode-store";
import {
  createProviderConfigStore,
  createProviderTelemetryPayload,
  DEFAULT_PROVIDER_CONFIG,
  type ProviderConfigStore
} from "./services/config/provider-config-store";
import { createSecureKeyStore, type SecureKeyStore } from "./services/config/secure-key-store";
import { createUserProfileStore, type UserProfileStore } from "./services/config/user-profile-store";
import {
  registerWebGLDiagnosticShortcut,
  sendWebGLDiagnosticTrigger
} from "./services/diagnostic-shortcut";
import { createPetPresentationStore, type PetPresentationStore } from "./services/config/pet-presentation-store";
import {
  createPetPresentationPersistence,
  type PetPresentationPersistence
} from "./services/config/pet-presentation-persistence";
import { createShortcutPreferencesStore, type ShortcutPreferencesStore } from "./services/config/shortcut-preferences-store";
import { registerModelAssetProtocol } from "./services/model-asset-protocol";
import { createPointerController, type PointerController } from "./services/pointer-controller";
import { createShortcutRegistry, type ShortcutRegistry } from "./services/shortcut-registry";
import { createTelemetryService, type TelemetryPayload, type TelemetryService } from "./services/telemetry";
import {
  createLlamaCppRuntime,
  readLlamaCppRuntimeConfigFromEnv,
  type LlamaCppRuntimeConfig,
  type LlamaCppRuntimeSummary,
  type LlamaCppRuntime
} from "./services/local-runtime/llama-cpp-runtime";
import { createLlamaCppProviderHandoff } from "./services/local-runtime/llama-cpp-provider-handoff";
import {
  createLlamaCppRuntimeSettingsStore,
  type LlamaCppRuntimeSettingsStore
} from "./services/local-runtime/llama-cpp-runtime-settings-store";
import { diagnoseLocalRuntimes } from "./services/local-runtime/local-model-diagnostic";
import { createChatWindow, focusChatInput, showChatWindow } from "./windows/chat-window";
import { createPetWindow } from "./windows/pet-window";
import { restorePetWindowOnTop } from "./windows/topmost-policy";
import { DEFAULT_SHORTCUT_PREFERENCES, getScaleWheelModifierAccelerator, type ShortcutPreferences } from "../shared/shortcut-preferences";
import {
  parsePetRendererTelemetryEvent,
  sanitizePetTelemetryEvent,
  type PetTelemetryEventType
} from "../shared/pet-telemetry-contract";

let petWindow: BrowserWindow | null = null;
let chatWindow: BrowserWindow | null = null;
let pointerController: PointerController | null = null;
let telemetry: TelemetryService | null = null;
let chatEngine: ChatEngine | null = null;
let providerConfigStore: ProviderConfigStore | null = null;
let secureKeyStore: SecureKeyStore | null = null;
let envProviderConfig: EnvProviderConfig | null = null;
let managedLlamaCppProviderConfig: LocalOpenAICompatibleConfig | null = null;
let petPresentationStore: PetPresentationStore | null = null;
let petPresentationPersistence: PetPresentationPersistence | null = null;
let historyStore: HistoryStore | null = null;
let memoryStore: MemoryStore | null = null;
let dialogueModeStore: DialogueModeStore | null = null;
let presenceModeStore: PresenceModeStore | null = null;
let shortcutPreferencesStore: ShortcutPreferencesStore | null = null;
let userProfileStore: UserProfileStore | null = null;
let shortcutRegistry: ShortcutRegistry | null = null;
let llamaCppRuntime: LlamaCppRuntime | null = null;
let llamaCppRuntimeSettingsStore: LlamaCppRuntimeSettingsStore | null = null;
let latestLlamaCppRuntimeSummary: LlamaCppRuntimeSummary | null = null;
let refreshCurrentProvider: (() => void) | null = null;
let currentPetPresentationPreferences: PetPresentationPreferences = DEFAULT_PET_PRESENTATION_PREFERENCES;
let isChatInteractionActive = false;
let petRoleSnapshot: PetRoleSnapshot = INITIAL_PET_ROLE_SNAPSHOT;
let currentPetPresentationIntent: PetPresentationIntent = createPetPresentationIntent(petRoleSnapshot);
let activeChatRequestVersion: number | null = null;
let currentDialogueModeId: DialogueModeId = "default";
let currentPresenceModeId: PresenceModeId = "default";
let performanceHeartbeat: NodeJS.Timeout | null = null;
let isPetLocked = false;
let initialEdgeGlanceTimer: NodeJS.Timeout | null = null;
let chatReplySustainTimer: NodeJS.Timeout | null = null;

const PET_RENDERER_RECOVERY_WINDOW_MS = 60_000;
const DEFAULT_API_KEY_REF = "openai-compatible-default";
const PET_RENDERER_MAX_RECOVERIES = 3;
const PET_WINDOW_TITLE = "Desktop Pet";
const PET_ACTION_TRIGGER_THROTTLE_MS = 700;
const PET_INITIAL_EDGE_GLANCE_DELAY_MS = 2_350;
const PET_DRAG_END_EDGE_GLANCE_DELAY_MS = 100;
const PET_CHAT_REPLY_SUSTAIN_MIN_CHARS = 42;
const PET_CHAT_REPLY_SUSTAIN_DELAY_MS = 1_250;
const isAcceptanceTelemetryEnabled = process.env.AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY === "1";
let petRendererRecoveryTimes: number[] = [];
const lastPetActionTriggerAtByReason: Partial<Record<PetActionTriggerReason, number>> = {};

const userDataPathOverride = process.env.AI_DESKTOP_PET_USER_DATA_PATH;

if (!app.isPackaged && userDataPathOverride && isAbsolute(userDataPathOverride)) {
  app.setPath("userData", userDataPathOverride);
}

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
  logTelemetry("second_instance_received");
  ensurePetWindow("second_instance");
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
  logPetTelemetry({
    type: "child_process_gone",
    payload
  });

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
  applyPetPresentationPreferences(nextPetWindow, getCurrentPetPresentationPreferences(), {
    placement: "initial"
  });

  nextPetWindow.webContents.on("render-process-gone", (_event, details) => {
    console.warn("[pet] render process gone", {
      reason: details.reason,
      exitCode: details.exitCode
    });
    logPetTelemetry({
      type: "renderer_process_gone",
      payload: {
        window: "pet",
        reason: details.reason,
        exitCode: details.exitCode
      }
    });

    if (petWindow !== nextPetWindow || !canRecoverPetRenderer()) {
      return;
    }

    rebuildPetWindow("renderer_process_gone");
  });

  return nextPetWindow;
}

function getDesktopPetWindowCount(): number {
  return BrowserWindow.getAllWindows().filter((window) => (
    !window.isDestroyed() &&
    window.getTitle() === PET_WINDOW_TITLE
  )).length;
}

function showExistingPetWindow(reason: string): BrowserWindow | null {
  if (!petWindow || petWindow.isDestroyed()) {
    return null;
  }

  restorePetWindowOnTop(petWindow);
  logTelemetry("pet_window_duplicate_prevented", {
    reason,
    desktopPetWindowCount: getDesktopPetWindowCount()
  });
  logTelemetry("pet_window_reuse", {
    reason,
    desktopPetWindowCount: getDesktopPetWindowCount()
  });
  logWindowSnapshot(`pet_reuse_${reason}`);
  return petWindow;
}

function ensurePetWindow(reason: string): BrowserWindow {
  const existingPetWindow = showExistingPetWindow(reason);

  if (existingPetWindow) {
    return existingPetWindow;
  }

  pointerController?.dispose();
  pointerController = null;
  petWindow = createRecoverablePetWindow();
  pointerController = createPointerControllerForWindow(petWindow);
  pointerController.setLocked(isPetLocked);
  logTelemetry("pet_window_created", {
    reason,
    desktopPetWindowCount: getDesktopPetWindowCount()
  });
  logWindowSnapshot(`pet_created_${reason}`);
  return petWindow;
}

function logTelemetry(type: string, payload: TelemetryPayload = {}): void {
  telemetry?.logEvent(type, payload);
}

function startLlamaCppRuntimeIfEnabled(options: {
  refreshProvider?: () => void;
} = {}): void {
  void startLlamaCppRuntimeNow(options);
}

async function startLlamaCppRuntimeNow(options: {
  refreshProvider?: () => void;
} = {}): Promise<LlamaCppRuntimeSummary> {
  const config = readMergedLlamaCppRuntimeConfig();

  if (!config.enabled) {
    latestLlamaCppRuntimeSummary = llamaCppRuntimeSettingsStore?.getSafeSettingsView() ?? null;
    return latestLlamaCppRuntimeSummary ?? {
      runtime: "llama.cpp",
      enabled: false,
      status: "disabled",
      safeSummaryOnly: true,
      executableConfigured: false,
      modelConfigured: false
    };
  }

  const runtime = createLlamaCppRuntime(config);
  llamaCppRuntime = runtime;
  latestLlamaCppRuntimeSummary = llamaCppRuntimeSettingsStore?.getSafeSettingsView(removeUndefinedRuntimeSummary({
    runtime: "llama.cpp",
    enabled: config.enabled,
    status: "starting",
    safeSummaryOnly: true,
    executableConfigured: Boolean(config.executablePath),
    modelConfigured: Boolean(config.modelPath),
    ...(config.alias ? { alias: config.alias } : {})
  })) ?? null;

  try {
    const summary = await runtime.start();

    if (llamaCppRuntime !== runtime) {
      return latestLlamaCppRuntimeSummary ?? summary;
    }

    latestLlamaCppRuntimeSummary = llamaCppRuntimeSettingsStore?.getSafeSettingsView(summary) ?? summary;
    logTelemetry("llama_cpp_runtime_status", summary);
    const handoff = createLlamaCppProviderHandoff(summary, runtime.getBaseURL());

    if (!handoff) {
      if (managedLlamaCppProviderConfig) {
        managedLlamaCppProviderConfig = null;
        options.refreshProvider?.();
      }
      return latestLlamaCppRuntimeSummary;
    }

    managedLlamaCppProviderConfig = handoff.providerConfig;
    logTelemetry("llama_cpp_provider_handoff", handoff.safeSummary);
    options.refreshProvider?.();
    return latestLlamaCppRuntimeSummary;
  } catch {
    if (llamaCppRuntime === runtime && managedLlamaCppProviderConfig) {
      managedLlamaCppProviderConfig = null;
      options.refreshProvider?.();
    }

    const errorSummary: LlamaCppRuntimeSummary = {
      runtime: "llama.cpp",
      enabled: true,
      status: "error",
      safeSummaryOnly: true,
      executableConfigured: Boolean(config.executablePath),
      modelConfigured: Boolean(config.modelPath)
    };
    latestLlamaCppRuntimeSummary = llamaCppRuntimeSettingsStore?.getSafeSettingsView(errorSummary) ?? errorSummary;
    logTelemetry("llama_cpp_runtime_status", errorSummary);
    return latestLlamaCppRuntimeSummary;
  }
}

async function stopLlamaCppRuntime(): Promise<LlamaCppRuntimeSummary | null> {
  const runtime = llamaCppRuntime;

  if (!runtime) {
    managedLlamaCppProviderConfig = null;
    refreshCurrentProvider?.();
    return latestLlamaCppRuntimeSummary;
  }

  llamaCppRuntime = null;
  managedLlamaCppProviderConfig = null;
  refreshCurrentProvider?.();
  return runtime.stop()
    .then((summary) => {
      latestLlamaCppRuntimeSummary = llamaCppRuntimeSettingsStore?.getSafeSettingsView(summary) ?? summary;
      logTelemetry("llama_cpp_runtime_stopped", summary);
      return latestLlamaCppRuntimeSummary;
    })
    .catch(() => {
      const errorSummary: LlamaCppRuntimeSummary = {
        runtime: "llama.cpp",
        enabled: true,
        status: "error",
        safeSummaryOnly: true,
        executableConfigured: false,
        modelConfigured: false
      };
      latestLlamaCppRuntimeSummary = llamaCppRuntimeSettingsStore?.getSafeSettingsView(errorSummary) ?? errorSummary;
      logTelemetry("llama_cpp_runtime_stopped", errorSummary);
      return latestLlamaCppRuntimeSummary;
    });
}

function readMergedLlamaCppRuntimeConfig(): LlamaCppRuntimeConfig {
  const savedConfig = llamaCppRuntimeSettingsStore?.getRuntimeConfig() ?? { enabled: false };
  const envConfig = readLlamaCppRuntimeConfigFromEnv();
  const merged: LlamaCppRuntimeConfig = {
    ...savedConfig,
    ...removeUndefinedConfig(envConfig),
    enabled: Boolean(savedConfig.enabled || envConfig.enabled)
  };

  return merged;
}

function removeUndefinedConfig(config: LlamaCppRuntimeConfig): LlamaCppRuntimeConfig {
  return Object.fromEntries(
    Object.entries(config).filter(([, value]) => typeof value !== "undefined")
  ) as LlamaCppRuntimeConfig;
}

function removeUndefinedRuntimeSummary(summary: LlamaCppRuntimeSummary): LlamaCppRuntimeSummary {
  return Object.fromEntries(
    Object.entries(summary).filter(([, value]) => typeof value !== "undefined")
  ) as LlamaCppRuntimeSummary;
}

function getManagedLlamaCppDiagnosticConfig() {
  const settingsView = llamaCppRuntimeSettingsStore?.getSafeSettingsView(latestLlamaCppRuntimeSummary);

  return {
    enabled: settingsView?.enabled ?? false,
    executableConfigured: settingsView?.executableConfigured ?? false,
    modelConfigured: settingsView?.modelConfigured ?? false,
    ...(settingsView?.host ? { host: settingsView.host } : {}),
    ...(typeof settingsView?.port === "number" ? { port: settingsView.port } : {}),
    ...(settingsView?.alias ? { alias: settingsView.alias } : {})
  };
}

function createLocalModelDiagnosticFailureSummary(): LocalModelDiagnosticSafeSummary {
  return {
    ok: false,
    status: "script_failed",
    recommendedRuntime: "ollama",
    durationMs: 0,
    safeSummaryOnly: true,
    runtimes: []
  };
}

function logLocalModelDiagnosticSummary(summary: LocalModelDiagnosticSafeSummary): void {
  logTelemetry("local_model_diagnostic_completed", {
    ok: summary.ok,
    status: summary.status,
    recommendedRuntime: summary.recommendedRuntime,
    durationMs: summary.durationMs,
    runtimeCount: summary.runtimes.length,
    readyRuntimeCount: summary.runtimes.filter((runtime) => runtime.status === "ready").length,
    runtimes: summary.runtimes.map((runtime) => ({
      id: runtime.id,
      status: runtime.status,
      baseURLHost: runtime.baseURLHost,
      model: runtime.model,
      commandFound: runtime.commandFound,
      processFound: runtime.processFound,
      tcpReachable: runtime.tcpReachable,
      modelsStatus: runtime.modelsStatus,
      chatStatus: runtime.chatStatus,
      modelCount: runtime.modelCount,
      firstTokenMs: runtime.firstTokenMs,
      replyLength: runtime.replyLength,
      durationMs: runtime.durationMs,
      managedEnabled: runtime.managedEnabled,
      executableConfigured: runtime.executableConfigured,
      modelConfigured: runtime.modelConfigured
    }))
  });
}

function logPetTelemetry(event: { type: PetTelemetryEventType; payload?: unknown }): void {
  const safeEvent = sanitizePetTelemetryEvent(event);
  logTelemetry(safeEvent.type, safeEvent.payload);
}

function sendPetActionTrigger(reason: PetActionTriggerReason): boolean {
  if (!petWindow || petWindow.isDestroyed()) {
    return false;
  }

  const now = Date.now();
  const lastTriggeredAt = lastPetActionTriggerAtByReason[reason] ?? 0;
  if (now - lastTriggeredAt < PET_ACTION_TRIGGER_THROTTLE_MS) {
    return false;
  }

  lastPetActionTriggerAtByReason[reason] = now;
  petWindow.webContents.send("pet:action-trigger", { reason });
  return true;
}

function isCurrentPetWindowNearEdge(): boolean {
  if (!petWindow || petWindow.isDestroyed()) {
    return false;
  }

  const bounds = petWindow.getBounds();
  const workArea = screen.getDisplayMatching(bounds).workArea;
  return isPetNearWorkAreaEdge(bounds, workArea);
}

function triggerEdgeGlanceIfPetSettled(): boolean {
  return isCurrentPetWindowNearEdge() && sendPetActionTrigger("pet_edge_settled");
}

function clearChatReplySustainTimer(): void {
  if (!chatReplySustainTimer) {
    return;
  }

  clearTimeout(chatReplySustainTimer);
  chatReplySustainTimer = null;
}

function scheduleChatReplySustainTrigger(): void {
  if (chatReplySustainTimer) {
    return;
  }

  chatReplySustainTimer = setTimeout(() => {
    chatReplySustainTimer = null;
    sendPetActionTrigger("chat_reply_sustain");
  }, PET_CHAT_REPLY_SUSTAIN_DELAY_MS);
}

function scheduleInitialEdgeGlanceIfNeeded(): void {
  if (initialEdgeGlanceTimer) {
    clearTimeout(initialEdgeGlanceTimer);
  }

  initialEdgeGlanceTimer = setTimeout(() => {
    initialEdgeGlanceTimer = null;
    triggerEdgeGlanceIfPetSettled();
  }, PET_INITIAL_EDGE_GLANCE_DELAY_MS);
}

function createPointerControllerForWindow(window: BrowserWindow): PointerController {
  return createPointerController(window, {
    getMotionGuards: () => ({
      isScaleGestureActive: false,
      isChatInteractionActive
    }),
    onWindowMotionCandidate: (candidate) => {
      logPetTelemetry({
        type: "pet_window_motion_detected",
        payload: {
          eventType: candidate.eventType,
          reason: candidate.reason,
          directionChanges: candidate.directionChanges,
          distancePx: candidate.distancePx,
          durationMs: candidate.durationMs,
          cooldownState: candidate.cooldownState,
          isLocked: candidate.isLocked,
          isDragging: candidate.isDragging
        }
      });
      if (candidate.eventType === "window_shake_candidate" && !window.isDestroyed()) {
        window.webContents.send("pet:window-motion-feedback", {
          type: "shake_light_feedback"
        });
      }
    }
  });
}

function publishPetPresentation(intent: PetPresentationIntent): void {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }

  petWindow.webContents.send("pet:apply-presentation", intent);
}

function withCurrentAccessoryPreset(intent: PetPresentationIntent): PetPresentationIntent {
  return {
    ...intent,
    accessoryPresetId: currentPetPresentationPreferences.accessoryPresetId
  };
}

function transitionPetRole(event: PetRoleEvent): boolean {
  const transition = reducePetRoleState(petRoleSnapshot, event);

  if (!transition.accepted) {
    return false;
  }

  petRoleSnapshot = transition.snapshot;
  currentPetPresentationIntent = withCurrentAccessoryPreset(transition.intent);
  publishPetPresentation(currentPetPresentationIntent);
  logTelemetry("pet_role_transition", {
    state: petRoleSnapshot.state,
    requestVersion: petRoleSnapshot.activeRequestVersion,
    event: event.type
  });
  return true;
}

function settleInterruptedRole(): void {
  queueMicrotask(() => {
    transitionPetRole({ type: "interruption:settled" });
  });
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
      ignoreMouseEvents: pointerController?.isIgnoringMouseEvents() ?? true,
      isLocked: pointerController?.isLocked() ?? isPetLocked
    }),
    chatWindow: getWindowSnapshot(chatWindow, {
      ignoreMouseEvents: false
    })
  });
}

function logAcceptanceWindowSnapshot(reason: string): void {
  if (isAcceptanceTelemetryEnabled) {
    logWindowSnapshot(reason);
  }
}

function setPetLocked(nextIsLocked: boolean, reason: string): { isLocked: boolean } {
  isPetLocked = nextIsLocked;
  pointerController?.setLocked(isPetLocked);
  logTelemetry("pet_lock_changed", {
    isLocked: isPetLocked,
    reason
  });
  logWindowSnapshot(reason);
  notifyChatPetLockChanged({ isLocked: isPetLocked });
  return { isLocked: isPetLocked };
}

function notifyChatPetLockChanged(state: { isLocked: boolean }): boolean {
  if (!chatWindow || chatWindow.isDestroyed()) {
    return false;
  }

  chatWindow.webContents.send("pet-lock:changed", state);
  return true;
}

function notifyChatPetActivityEcho(echo: PetActivityEcho): boolean {
  if (!chatWindow || chatWindow.isDestroyed()) {
    return false;
  }

  chatWindow.webContents.send("pet-activity:echo", echo);
  return true;
}

function createPetActivityEcho(event: PetTelemetryEvent): PetActivityEcho | null {
  const payload = event.payload ?? {};

  if (event.type === "pet_window_motion_feedback") {
    const message = getPetWindowMotionFeedbackSafeEchoMessage(payload.result);
    return message ? { message } : null;
  }

  if (event.type !== "pet_interaction_action_started") {
    return null;
  }

  const message = getPetInteractionActionSafeEchoMessage(payload.type);
  return message ? { message } : null;
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
      chatWindowVisible: Boolean(chatWindow && !chatWindow.isDestroyed() && chatWindow.isVisible()),
      windowSnapshot: isAcceptanceTelemetryEnabled ? {
        petWindow: getWindowSnapshot(petWindow, {
          ignoreMouseEvents: pointerController?.isIgnoringMouseEvents() ?? true,
          isLocked: pointerController?.isLocked() ?? isPetLocked
        }),
        chatWindow: getWindowSnapshot(chatWindow, {
          ignoreMouseEvents: false
        })
      } : undefined
    });
  }, 5_000);
  performanceHeartbeat.unref();
}

function registerDiagnosticShortcuts(): void {
  const result = registerWebGLDiagnosticShortcut({
    isPackaged: app.isPackaged,
    register: (accelerator, callback) => globalShortcut.register(accelerator, callback),
    onTriggered: () => {
      const delivered = sendWebGLDiagnosticTrigger(petWindow);

      logTelemetry("diagnostic_shortcut_triggered", {
        accelerator: result.accelerator,
        action: "inject_webgl_context_loss",
        delivered
      });
    }
  });

  logTelemetry("diagnostic_shortcut_registration", result);
}

function createUserShortcutRegistry(): ShortcutRegistry | null {
  if (!shortcutPreferencesStore) {
    return null;
  }

  return createShortcutRegistry({
    initialPreferences: shortcutPreferencesStore.getPreferences(),
    register: (accelerator, callback) => globalShortcut.register(accelerator, callback),
    unregister: (accelerator) => globalShortcut.unregister(accelerator),
    isRegistered: (accelerator) => globalShortcut.isRegistered(accelerator),
    savePreferences: (preferences) => shortcutPreferencesStore?.savePreferences(preferences) ?? preferences,
    handlers: {
      togglePetLock: () => {
        const nextState = setPetLocked(!isPetLocked, "global_lock_shortcut_toggle");

        logTelemetry("pet_lock_shortcut_triggered", {
          accelerator: shortcutRegistry
            ?.getShortcutViews()
            .find((shortcut) => shortcut.id === "togglePetLock")
            ?.accelerator,
          isLocked: nextState.isLocked,
          chatWindowNotified: Boolean(chatWindow && !chatWindow.isDestroyed())
        });
      }
    },
    onRegistrationResult: (result) => {
      logTelemetry("pet_lock_shortcut_registration", result);
    },
    onPreferencesChanged: (preferences) => {
      publishScaleWheelModifier(preferences);
    }
  });
}

function getCurrentShortcutPreferences(): ShortcutPreferences {
  return shortcutRegistry?.getPreferences()
    ?? shortcutPreferencesStore?.getPreferences()
    ?? DEFAULT_SHORTCUT_PREFERENCES;
}

function publishScaleWheelModifier(preferences = getCurrentShortcutPreferences()): void {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }

  petWindow.webContents.send(
    "shortcuts:scale-wheel-modifier-changed",
    getScaleWheelModifierAccelerator(preferences)
  );
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function sanitizeRenderHealth(state: RenderHealth): TelemetryPayload {
  const safeEvent = sanitizePetTelemetryEvent({
    type: "pet_health",
    payload: {
      renderer: state.renderer,
      framesPerSecond: state.framesPerSecond,
      isContextLost: state.isContextLost,
      canvasWidth: state.canvasWidth,
      canvasHeight: state.canvasHeight,
      nonTransparentPixels: state.nonTransparentPixels,
      opaqueBlackPixels: state.opaqueBlackPixels,
      firstFrameMs: state.firstFrameMs,
      renderStartMs: state.renderStartMs,
      recoveryCount: state.recoveryCount,
      rendererTimestamp: state.timestamp
    }
  });

  return safeEvent.payload ?? {};
}

function sanitizeFirstFrame(info: PetFirstFrameInfo): TelemetryPayload {
  return {
    firstFrameMs: readNumber(info.firstFrameMs),
    renderStartMs: readNumber(info.renderStartMs),
    renderer: info.renderer,
    recoveryCount: readNumber(info.recoveryCount)
  };
}

function isChatSendRequest(value: unknown): value is ChatSendRequest {
  const request = value as Partial<ChatSendRequest> | null;

  return Boolean(
    request &&
    typeof request.requestVersion === "number" &&
    Number.isSafeInteger(request.requestVersion) &&
    request.requestVersion > 0 &&
    typeof request.conversationId === "string" &&
    isHistoryId(request.conversationId) &&
    Array.isArray(request.messages) &&
    request.messages.length > 0 &&
    request.messages.every((message) => isChatMessage(message) && isHistoryId(message.id) && message.content.trim().length > 0) &&
    request.messages.at(-1)?.role === "user"
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

function isProviderHealthCheckRequest(value: unknown): value is ProviderHealthCheckRequest {
  const request = value as Partial<ProviderHealthCheckRequest> | null;

  return Boolean(
    request &&
    (
      request.providerId === "openai-compatible" ||
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
      request.localPresetId === "ollama" ||
      request.localPresetId === "lm-studio" ||
      request.localPresetId === "custom-local"
    )
  );
}

function isLlamaCppRuntimeSettingsUpdate(value: unknown): value is LlamaCppRuntimeSettingsUpdate {
  const update = value as Partial<LlamaCppRuntimeSettingsUpdate> & Record<string, unknown> | null;

  if (!update || typeof update !== "object" || "executablePath" in update || "modelPath" in update) {
    return false;
  }

  return (
    (update.enabled === undefined || typeof update.enabled === "boolean") &&
    (update.host === undefined || typeof update.host === "string") &&
    (update.port === undefined || update.port === null || isPositiveInteger(update.port)) &&
    (update.ctxSize === undefined || update.ctxSize === null || isPositiveInteger(update.ctxSize)) &&
    (update.alias === undefined || typeof update.alias === "string") &&
    (update.startupTimeoutMs === undefined || isPositiveInteger(update.startupTimeoutMs)) &&
    (update.stopTimeoutMs === undefined || isPositiveInteger(update.stopTimeoutMs)) &&
    (update.healthPollIntervalMs === undefined || isPositiveInteger(update.healthPollIntervalMs))
  );
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function getChatErrorType(error: unknown): ChatStreamErrorType {
  if (isAbortError(error)) {
    return "aborted";
  }

  if (error instanceof ChatEngineBusyError) {
    return "busy";
  }

  if (error instanceof Error) {
    if (error.name === "provider_missing_api_key") {
      return "missing_api_key";
    }

    if (error.name === "provider_invalid_config") {
      return "invalid_config";
    }

    if (error.name === "provider_auth_failed") {
      return "auth_failed";
    }

    if (error.name === "provider_rate_limited") {
      return "rate_limited";
    }

    if (error.name === "provider_server_error") {
      return "server_error";
    }

    if (error.name === "provider_timeout") {
      return "timeout";
    }

    if (error.name === "provider_model_missing") {
      return "model_missing";
    }

    if (error.name === "provider_incompatible_response") {
      return "incompatible_response";
    }

    if (error.name === "provider_network_error") {
      return "network_error";
    }
  }

  return "failed";
}

function getCurrentPetPresentationPreferences(): PetPresentationPreferences {
  return currentPetPresentationPreferences;
}

function applyPetPresentationPreferences(
  window: BrowserWindow,
  preferences: PetPresentationPreferences,
  options: { placement?: "current" | "initial" } = {}
): void {
  if (window.isDestroyed()) {
    return;
  }

  if (options.placement === "initial") {
    window.setBounds(calculateInitialPetBounds(preferences.petScale, screen.getPrimaryDisplay().workArea));
    if (window === petWindow) {
      pointerController?.syncWindowSize();
    }
    return;
  }

  const currentBounds = window.getBounds();
  const currentWorkArea = screen.getDisplayMatching(currentBounds).workArea;
  const clampedCurrentBounds = clampPetBounds(currentBounds, currentWorkArea);
  const targetWorkArea = screen.getDisplayMatching(clampedCurrentBounds).workArea;
  const scaledBounds = calculateScaledPetBounds(clampedCurrentBounds, preferences.petScale, targetWorkArea);

  window.setBounds(scaledBounds);
  if (window === petWindow) {
    pointerController?.syncWindowSize();
  }
}

function getChatErrorMessage(errorType: ChatStreamErrorType): string {
  if (errorType === "aborted") {
    return "这轮先停在这里，未完成的回复不会保存。";
  }

  if (errorType === "busy") {
    return "回复仍在生成中。";
  }

  if (errorType === "missing_api_key") {
    return "当前不会调用真实模型：请先配置 API Key，或切换到本地 Ollama。";
  }

  if (errorType === "invalid_config") {
    return "当前不会调用真实模型：Provider 配置无效，请检查模型设置。";
  }

  if (errorType === "auth_failed") {
    return "密钥无效，请检查本地配置。";
  }

  if (errorType === "rate_limited") {
    return "请求过于频繁，请稍后再试。";
  }

  if (errorType === "server_error") {
    return "模型服务暂时不可用，请稍后再试。";
  }

  if (errorType === "timeout") {
    return "连接超时，请检查本地服务是否已启动，或适当调大超时时间。";
  }

  if (errorType === "model_missing") {
    return `模型服务可达，但找不到当前模型；若使用推荐本地模型，请手动拉取 ${DEFAULT_PROVIDER_CONFIG.model} 后再试。`;
  }

  if (errorType === "incompatible_response") {
    return "服务响应不是兼容格式，请确认端点支持 OpenAI-compatible API。";
  }

  if (errorType === "network_error") {
    return "连接失败，请检查网络、baseURL；若使用推荐本地模型，请确认 Ollama 已安装并启动。";
  }

  return "她暂时没接上模型，稍后再试或检查连接。";
}

function rebuildPetWindow(recoverySource?: string): void {
  if (recoverySource) {
    logPetTelemetry({
      type: "recovery_started",
      payload: {
        source: recoverySource,
        window: "pet",
        recoveryCount: petRendererRecoveryTimes.length
      }
    });
  }

  pointerController?.dispose();
  pointerController = null;

  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.destroy();
  }

  petWindow = createRecoverablePetWindow();
  pointerController = createPointerControllerForWindow(petWindow);
  pointerController.setLocked(isPetLocked);
  logWindowSnapshot(recoverySource ? "pet_rebuild" : "pet_created");
  logTelemetry(recoverySource ? "pet_window_rebuilt" : "pet_window_created", {
    reason: recoverySource ?? "rebuild_pet_window",
    desktopPetWindowCount: getDesktopPetWindowCount()
  });

  if (recoverySource) {
    logPetTelemetry({
      type: "recovery_succeeded",
      payload: {
        source: recoverySource,
        window: "pet",
        recoveryCount: petRendererRecoveryTimes.length
      }
    });
  }
}

app.whenReady().then(async () => {
  telemetry = createTelemetryService();
  providerConfigStore = createProviderConfigStore({ logTelemetry });
  petPresentationStore = createPetPresentationStore();
  currentPetPresentationPreferences = petPresentationStore.getPreferences();
  currentPetPresentationIntent = withCurrentAccessoryPreset(currentPetPresentationIntent);
  petPresentationPersistence = createPetPresentationPersistence(petPresentationStore);
  historyStore = createHistoryStore();
  memoryStore = createMemoryStore();
  dialogueModeStore = createDialogueModeStore();
  currentDialogueModeId = dialogueModeStore.getMode();
  presenceModeStore = createPresenceModeStore();
  currentPresenceModeId = presenceModeStore.getMode();
  shortcutPreferencesStore = createShortcutPreferencesStore();
  userProfileStore = createUserProfileStore({ logTelemetry });
  shortcutRegistry = createUserShortcutRegistry();
  secureKeyStore = createSecureKeyStore({ logTelemetry });
  llamaCppRuntimeSettingsStore = createLlamaCppRuntimeSettingsStore({
    userDataPath: app.getPath("userData")
  });
  envProviderConfig = readEnvProviderConfig();
  chatEngine = createChatEngine(createProviderFromCurrentConfig());
  refreshCurrentProvider = () => {
    chatEngine?.setProvider(createProviderFromCurrentConfig());
  };
  logStartupInfo();
  registerModelAssetProtocol();
  startLlamaCppRuntimeIfEnabled({
    refreshProvider() {
      refreshCurrentProvider?.();
    }
  });

  ensurePetWindow("startup");
  chatWindow = createChatWindow();
  chatWindow.on("hide", () => {
    isChatInteractionActive = false;
    if (activeChatRequestVersion !== null) {
      chatEngine?.abortActiveStream();
      transitionPetRole({ type: "request:cancelled", requestVersion: activeChatRequestVersion });
      activeChatRequestVersion = null;
      clearChatReplySustainTimer();
      settleInterruptedRole();
    }
    transitionPetRole({ type: "chat:closed" });
    if (petWindow) {
      restorePetWindowOnTop(petWindow);
      logWindowSnapshot("chat_hidden_pet_restored");
    }
  });
  logWindowSnapshot("startup");
  startPerformanceHeartbeat();
  registerDiagnosticShortcuts();
  shortcutRegistry?.registerAll();

  screen.on("display-metrics-changed", () => {
    if (petWindow && !petWindow.isDestroyed()) {
      applyPetPresentationPreferences(petWindow, getCurrentPetPresentationPreferences());
    }
  });

  screen.on("display-added", () => {
    if (petWindow && !petWindow.isDestroyed()) {
      applyPetPresentationPreferences(petWindow, getCurrentPetPresentationPreferences());
    }
  });

  screen.on("display-removed", () => {
    if (petWindow && !petWindow.isDestroyed()) {
      applyPetPresentationPreferences(petWindow, getCurrentPetPresentationPreferences());
    }
  });

  function openChatWindow(): void {
    if (!chatWindow) {
      chatWindow = createChatWindow();
    }

    showChatWindow(chatWindow);
    focusChatInput(chatWindow);
    transitionPetRole({ type: "chat:opened" });
    sendPetActionTrigger("chat_opened");
    logWindowSnapshot("chat_opened");
  }

  function isPetSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    return Boolean(petWindow && event.sender === petWindow.webContents);
  }

  function isChatSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    return Boolean(chatWindow && event.sender === chatWindow.webContents);
  }

  function getCurrentProviderConfig(): ProviderConfig {
    if (providerConfigStore?.hasConfig()) {
      return providerConfigStore.getConfig();
    }

    if (envProviderConfig) {
      logTelemetry(
        "provider_config_loaded",
        createProviderTelemetryPayload(envProviderConfig.providerConfig, "env")
      );
      return envProviderConfig.providerConfig;
    }

    if (managedLlamaCppProviderConfig) {
      return managedLlamaCppProviderConfig;
    }

    return providerConfigStore?.getConfig() ?? DEFAULT_PROVIDER_CONFIG;
  }

  function getCurrentProviderStatus(): ProviderStatus {
    const config = getCurrentProviderConfig();

    if (config.providerId === "fake") {
      return {
        providerId: "fake",
        displayName: config.displayName,
        isFallback: false
      };
    }

    const baseURLHost = readBaseURLHost(config.baseURL);
    const isLocalProvider = config.providerId === "local-openai-compatible";
    const keyConfigured = config.providerId === "openai-compatible" ? hasApiKey(config.apiKeyRef) : true;

    if (!baseURLHost) {
      return {
        providerId: config.providerId,
        displayName: config.displayName,
        model: config.model,
        hasApiKey: keyConfigured,
        isFallback: true,
        reason: "invalid_config"
      };
    }

    if (!isLocalProvider && !keyConfigured) {
      return {
        providerId: config.providerId,
        displayName: config.displayName,
        model: config.model,
        baseURLHost,
        hasApiKey: false,
        isFallback: true,
        reason: "missing_api_key"
      };
    }

    const status: ProviderStatus = {
      providerId: config.providerId,
      displayName: config.displayName,
      model: config.model,
      baseURLHost,
      isFallback: false
    };

    if (!isLocalProvider) {
      status.hasApiKey = true;
    }

    return status;
  }

  function readBaseURLHost(baseURL: string): string | undefined {
    try {
      return new URL(baseURL).host;
    } catch {
      return undefined;
    }
  }

  function hasApiKey(apiKeyRef: string): boolean {
    if (providerConfigStore?.hasConfig()) {
      return secureKeyStore?.hasApiKey(apiKeyRef) ?? false;
    }

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
    if (providerConfigStore?.hasConfig()) {
      return secureKeyStore?.getApiKey(apiKeyRef) ?? null;
    }

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

  function notifyChatDialogueModeChanged(modeId: DialogueModeId): void {
    if (!chatWindow || chatWindow.isDestroyed()) {
      return;
    }

    chatWindow.webContents.send("dialogueMode:changed", modeId);
  }

  function notifyPetDialogueModeChanged(modeId: DialogueModeId): void {
    if (!petWindow || petWindow.isDestroyed()) {
      return;
    }

    petWindow.webContents.send("dialogueMode:changed", modeId);
  }

  function notifyChatPresenceModeChanged(modeId: PresenceModeId): void {
    if (!chatWindow || chatWindow.isDestroyed()) {
      return;
    }

    chatWindow.webContents.send("presenceMode:changed", modeId);
  }

  function notifyPetPresenceModeChanged(modeId: PresenceModeId): void {
    if (!petWindow || petWindow.isDestroyed()) {
      return;
    }

    petWindow.webContents.send("presenceMode:changed", modeId);
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
    logAcceptanceWindowSnapshot("pet_drag_start");
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
    logAcceptanceWindowSnapshot("pet_drag_end");
    setTimeout(() => {
      triggerEdgeGlanceIfPetSettled();
    }, PET_DRAG_END_EDGE_GLANCE_DELAY_MS);
  });

  ipcMain.on("pet:first-frame", (event, info: PetFirstFrameInfo) => {
    if (!isPetSender(event)) {
      return;
    }

    logTelemetry("first_frame", sanitizeFirstFrame(info));
    console.info("[pet] first frame reported");
    scheduleInitialEdgeGlanceIfNeeded();
  });

  ipcMain.on("pet:health", (event, state: RenderHealth) => {
    if (!isPetSender(event)) {
      return;
    }

    const healthPayload = sanitizeRenderHealth(state);
    logTelemetry("pet_health", healthPayload);
    console.info("[pet] health", healthPayload);
  });

  ipcMain.on("pet:telemetry", (event, rendererEvent: unknown) => {
    const petTelemetryEvent = parsePetRendererTelemetryEvent(rendererEvent);

    if (!isPetSender(event) || !petTelemetryEvent) {
      return;
    }

    logTelemetry(petTelemetryEvent.type, petTelemetryEvent.payload);
    const activityEcho = createPetActivityEcho(petTelemetryEvent);

    if (activityEcho) {
      notifyChatPetActivityEcho(activityEcho);
    }

    if (petTelemetryEvent.type === "webgl_context_lost" || petTelemetryEvent.type === "recovery_failed") {
      const requestVersion = activeChatRequestVersion;
      transitionPetRole({ type: "renderer:failed" });
      if (requestVersion !== null) {
        chatEngine?.abortActiveStream();
        activeChatRequestVersion = null;
      }
    } else if (petTelemetryEvent.type === "recovery_succeeded") {
      transitionPetRole({ type: "renderer:recovered" });
    }
  });

  ipcMain.on("pet:presentation-ready", (event) => {
    if (isPetSender(event)) {
      publishPetPresentation(currentPetPresentationIntent);
      publishScaleWheelModifier();
    }
  });

  ipcMain.handle("shortcuts:get-scale-wheel-modifier", (event) => {
    if (!isPetSender(event)) {
      throw new Error("Unauthorized shortcut request");
    }

    return getScaleWheelModifierAccelerator(getCurrentShortcutPreferences());
  });

  ipcMain.on("chat:interaction-active", (event, isActive: unknown) => {
    if (!isChatSender(event) || typeof isActive !== "boolean") {
      return;
    }

    isChatInteractionActive = isActive;
    transitionPetRole({ type: "chat:interaction", active: isActive });
    if (isActive) {
      sendPetActionTrigger("chat_input_focus");
    }
  });

  ipcMain.on("pet:adjust-scale", (event, value: unknown) => {
    const intent = parsePetScaleAdjustmentIntent(value);

    if (
      !isPetSender(event) ||
      !intent ||
      !canApplyPetScaleAdjustment({
        hasPresentationStore: Boolean(petPresentationStore),
        isChatInteractionActive,
        isDragging: pointerController?.isDragging() ?? false,
        intent
      })
    ) {
      return;
    }

    const targetScale = getAdjustedPetScale(currentPetPresentationPreferences.petScale, intent);

    if (targetScale === null || normalizePetScale(targetScale) === null || targetScale === currentPetPresentationPreferences.petScale) {
      return;
    }

    currentPetPresentationPreferences = {
      ...currentPetPresentationPreferences,
      petScale: targetScale
    };
    if (isAcceptanceTelemetryEnabled) {
      logPetTelemetry({
        type: "pet_scale_adjusted",
        payload: {
          petScale: targetScale,
          source: "wheel"
        }
      });
    }
    petPresentationPersistence?.schedule(currentPetPresentationPreferences);

    if (petWindow && !petWindow.isDestroyed()) {
      applyPetPresentationPreferences(petWindow, currentPetPresentationPreferences);
    }
  });

  ipcMain.on("chat:send", (event, request: unknown) => {
    if (!isChatSender(event) || !isChatSendRequest(request) || !chatEngine || !historyStore || !memoryStore) {
      return;
    }

    const historyStoreForRequest = historyStore;
    const memoryStoreForRequest = memoryStore;
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
        requestVersion: request.requestVersion,
        message: getChatErrorMessage("busy"),
        errorType: "busy"
      });
      return;
    }

    if (!transitionPetRole({ type: "request:started", requestVersion: request.requestVersion })) {
      return;
    }

    activeChatRequestVersion = request.requestVersion;
    clearChatReplySustainTimer();
    sendPetActionTrigger("chat_reply_waiting");
    const submittedMessage = request.messages.at(-1);

    if (!submittedMessage) {
      return;
    }

    try {
      const historyMessage: HistoryMessage = {
        id: submittedMessage.id,
        role: "user",
        content: submittedMessage.content,
        createdAt: Date.now()
      };
      const inserted = historyStoreForRequest.appendMessage(request.conversationId, historyMessage);

      if (!inserted) {
        transitionPetRole({ type: "request:failed", requestVersion: request.requestVersion });
        activeChatRequestVersion = null;
        event.sender.send("chat:stream-error", {
          requestVersion: request.requestVersion,
          message: "重复的消息请求已忽略。",
          errorType: "failed"
        });
        return;
      }

      try {
        const autoMemoryCapture = memoryStoreForRequest.captureAutoMemoriesFromLatestUserMessage({
          conversationId: request.conversationId,
          messageId: submittedMessage.id,
          content: submittedMessage.content
        });
        logTelemetry("memory_auto_capture", {
          enabled: autoMemoryCapture.enabled,
          skippedReason: autoMemoryCapture.skippedReason,
          capturedCount: autoMemoryCapture.capturedCount,
          keyCount: autoMemoryCapture.keyCount,
          generalCount: autoMemoryCapture.generalCount,
          mergedCount: autoMemoryCapture.mergedCount,
          deduplicatedCount: autoMemoryCapture.deduplicatedCount,
          compressionTriggered: autoMemoryCapture.compressionTriggered,
          totalCards: autoMemoryCapture.totalCards,
          injectionBudget: autoMemoryCapture.injectionBudget,
          safeCategories: autoMemoryCapture.safeCategories
        });
      } catch {
        logTelemetry("memory_auto_capture_failed", {
          conversationId: request.conversationId,
          errorType: "failed"
        });
      }
    } catch {
      transitionPetRole({ type: "request:failed", requestVersion: request.requestVersion });
      activeChatRequestVersion = null;
      event.sender.send("chat:stream-error", {
        requestVersion: request.requestVersion,
        message: "无法保存本地消息，请稍后重试。",
        errorType: "failed"
      });
      return;
    }

    const memoryContext = memoryStoreForRequest.createInjection();
    const dialogueStyleContext = {
      modeId: currentDialogueModeId,
      styleId: "gentle-desktop-companion-v1" as const
    };
    const userProfileContext = createUserProfilePromptContext(userProfileStore?.getProfile() ?? null);
    const runtimeContext = createChatRuntimeContext();
    const contextBudget = budgetChatContext(request.messages);
    event.sender.send("chat:memory-injection", {
      requestVersion: request.requestVersion,
      count: memoryContext.count
    });

    logTelemetry("chat_stream_started", {
      providerId,
      conversationId: request.conversationId,
      messageCount: request.messages.length,
      originalMessageCount: contextBudget.summary.originalMessageCount,
      providerMessageCount: contextBudget.summary.providerMessageCount,
      compressed: contextBudget.summary.compressed,
      summaryMessageCount: contextBudget.summary.summaryMessageCount,
      summarizedMessageCount: contextBudget.summary.summarizedMessageCount,
      recentMessageCount: contextBudget.summary.recentMessageCount,
      memoryInjectionCount: memoryContext.count
    });

    void chatEngine.startChatStream({
      ...request,
      providerMessages: contextBudget.providerMessages,
      contextBudget: contextBudget.summary,
      memoryContext,
      dialogueStyleContext,
      runtimeContext,
      ...(userProfileContext ? { userProfileContext } : {})
    }, {
      onDelta(delta) {
        if (!transitionPetRole({ type: "reply:delta", requestVersion: request.requestVersion })) {
          return;
        }

        replyLength += delta.text.length;
        if (replyLength >= PET_CHAT_REPLY_SUSTAIN_MIN_CHARS) {
          scheduleChatReplySustainTrigger();
        }
        event.sender.send("chat:stream-delta", { ...delta, requestVersion: request.requestVersion });
      }
    }).then((result) => {
      try {
        const historyMessage: HistoryMessage = {
          id: crypto.randomUUID(),
          role: "assistant",
          content: result.text,
          createdAt: Date.now()
        };
        historyStoreForRequest.appendMessage(request.conversationId, historyMessage);
      } catch {
        transitionPetRole({ type: "request:failed", requestVersion: request.requestVersion });
        if (activeChatRequestVersion === request.requestVersion) {
          activeChatRequestVersion = null;
        }
        event.sender.send("chat:stream-error", {
          requestVersion: request.requestVersion,
          message: "无法保存本地回复，请稍后重试。",
          errorType: "failed"
        });
        return;
      }

      const expression = selectEmotionPresentation(result);
      const accepted = transitionPetRole({
        type: "reply:completed",
        requestVersion: request.requestVersion,
        expression
      });
      if (activeChatRequestVersion === request.requestVersion) {
        activeChatRequestVersion = null;
        clearChatReplySustainTimer();
      }
      if (!accepted) {
        return;
      }

      logTelemetry("chat_stream_completed", {
        providerId,
        conversationId: request.conversationId,
        messageCount: request.messages.length,
        replyLength: result.text.length,
        durationMs: Date.now() - startedAt,
        emotion: result.emotion,
        intensity: result.intensity,
        presentationMode: expression.mode,
        emphasisExpressionTriggered: expression.mode === "emphasis"
      });
      event.sender.send("chat:stream-done", { ...result, requestVersion: request.requestVersion });
    }).catch((error: unknown) => {
      const errorType = getChatErrorType(error);
      const eventType = errorType === "aborted" ? "chat_stream_aborted" : "chat_stream_failed";
      const accepted = transitionPetRole({
        type: errorType === "aborted" ? "request:cancelled" : "request:failed",
        requestVersion: request.requestVersion
      });
      if (activeChatRequestVersion === request.requestVersion) {
        activeChatRequestVersion = null;
      }
      clearChatReplySustainTimer();

      logTelemetry(eventType, {
        providerId,
        conversationId: request.conversationId,
        messageCount: request.messages.length,
        replyLength,
        durationMs: Date.now() - startedAt,
        errorType
      });
      event.sender.send("chat:stream-error", {
        requestVersion: request.requestVersion,
        message: getChatErrorMessage(errorType),
        errorType
      });

      if (errorType !== "aborted" && errorType !== "busy") {
        console.warn("[chat] stream failed", { errorType });
      }

      if (accepted && errorType === "aborted") {
        settleInterruptedRole();
      }
    });
  });

  ipcMain.on("chat:abort", (event) => {
    if (!isChatSender(event) || !chatEngine) {
      return;
    }

    if (chatEngine.abortActiveStream() && activeChatRequestVersion !== null) {
      transitionPetRole({ type: "request:cancelled", requestVersion: activeChatRequestVersion });
      activeChatRequestVersion = null;
      clearChatReplySustainTimer();
      settleInterruptedRole();
    }
  });

  ipcMain.handle("config:get-provider", (event) => {
    if (!isChatSender(event)) {
      throw new Error("Unauthorized config request");
    }

    return getCurrentProviderConfig();
  });

  ipcMain.handle("localRuntime:diagnose-local-model", async (event) => {
    if (!isChatSender(event)) {
      throw new Error("Unauthorized local runtime request");
    }

    try {
      const parsedSummary = parseLocalModelDiagnosticSafeSummary(await diagnoseLocalRuntimes({
        managedLlamaCpp: getManagedLlamaCppDiagnosticConfig()
      }));
      const summary = parsedSummary ?? createLocalModelDiagnosticFailureSummary();
      logLocalModelDiagnosticSummary(summary);
      return summary;
    } catch {
      const summary = createLocalModelDiagnosticFailureSummary();
      logLocalModelDiagnosticSummary(summary);
      return summary;
    }
  });

  ipcMain.handle("localRuntime:get-llama-cpp-settings", (event) => {
    if (!isChatSender(event) || !llamaCppRuntimeSettingsStore) {
      throw new Error("Unauthorized local runtime request");
    }

    return llamaCppRuntimeSettingsStore.getSafeSettingsView(latestLlamaCppRuntimeSummary);
  });

  ipcMain.handle("localRuntime:update-llama-cpp-settings", async (event, update: unknown) => {
    if (!isChatSender(event) || !llamaCppRuntimeSettingsStore || !isLlamaCppRuntimeSettingsUpdate(update)) {
      throw new Error("Invalid local runtime settings request");
    }

    const view = llamaCppRuntimeSettingsStore.updateSettings(update);

    if (update.enabled === false) {
      await stopLlamaCppRuntime();
      return llamaCppRuntimeSettingsStore.getSafeSettingsView(latestLlamaCppRuntimeSummary);
    }

    latestLlamaCppRuntimeSummary = view;
    return view;
  });

  ipcMain.handle("localRuntime:choose-llama-cpp-executable", async (event) => {
    if (!isChatSender(event) || !llamaCppRuntimeSettingsStore) {
      throw new Error("Unauthorized local runtime request");
    }

    const options: OpenDialogOptions = {
      title: "选择 llama.cpp 运行文件",
      properties: ["openFile"],
      filters: [
        { name: "llama.cpp server", extensions: ["exe"] },
        { name: "All files", extensions: ["*"] }
      ]
    };
    const result = chatWindow
      ? await dialog.showOpenDialog(chatWindow, options)
      : await dialog.showOpenDialog(options);

    if (result.canceled || !result.filePaths[0]) {
      return llamaCppRuntimeSettingsStore.getSafeSettingsView(latestLlamaCppRuntimeSummary);
    }

    latestLlamaCppRuntimeSummary = llamaCppRuntimeSettingsStore.setExecutablePath(result.filePaths[0]);
    return latestLlamaCppRuntimeSummary;
  });

  ipcMain.handle("localRuntime:choose-llama-cpp-model", async (event) => {
    if (!isChatSender(event) || !llamaCppRuntimeSettingsStore) {
      throw new Error("Unauthorized local runtime request");
    }

    const options: OpenDialogOptions = {
      title: "选择 GGUF 模型文件",
      properties: ["openFile"],
      filters: [
        { name: "GGUF model", extensions: ["gguf"] }
      ]
    };
    const result = chatWindow
      ? await dialog.showOpenDialog(chatWindow, options)
      : await dialog.showOpenDialog(options);

    if (result.canceled || !result.filePaths[0]) {
      return llamaCppRuntimeSettingsStore.getSafeSettingsView(latestLlamaCppRuntimeSummary);
    }

    latestLlamaCppRuntimeSummary = llamaCppRuntimeSettingsStore.setModelPath(result.filePaths[0]);
    return latestLlamaCppRuntimeSummary;
  });

  ipcMain.handle("localRuntime:start-llama-cpp", async (event) => {
    if (!isChatSender(event) || !llamaCppRuntimeSettingsStore) {
      throw new Error("Unauthorized local runtime request");
    }

    await stopLlamaCppRuntime();
    return startLlamaCppRuntimeNow(refreshCurrentProvider ? { refreshProvider: refreshCurrentProvider } : {});
  });

  ipcMain.handle("localRuntime:stop-llama-cpp", async (event) => {
    if (!isChatSender(event) || !llamaCppRuntimeSettingsStore) {
      throw new Error("Unauthorized local runtime request");
    }

    await stopLlamaCppRuntime();
    return llamaCppRuntimeSettingsStore.getSafeSettingsView(latestLlamaCppRuntimeSummary);
  });

  ipcMain.handle("localRuntime:get-llama-cpp-status", (event) => {
    if (!isChatSender(event) || !llamaCppRuntimeSettingsStore) {
      throw new Error("Unauthorized local runtime request");
    }

    const runtimeSummary = llamaCppRuntime?.getStatus() ?? latestLlamaCppRuntimeSummary;
    latestLlamaCppRuntimeSummary = llamaCppRuntimeSettingsStore.getSafeSettingsView(runtimeSummary);
    return latestLlamaCppRuntimeSummary;
  });

  ipcMain.handle("history:list", (event) => {
    if (!isChatSender(event) || !historyStore) {
      throw new Error("Unauthorized history request");
    }

    return historyStore.listConversations();
  });

  ipcMain.handle("history:get", (event, id: unknown) => {
    if (!isChatSender(event) || !historyStore || !isHistoryId(id)) {
      throw new Error("Invalid history request");
    }

    return historyStore.getConversation(id);
  });

  ipcMain.handle("history:delete", (event, id: unknown) => {
    if (!isChatSender(event) || !historyStore || !isHistoryId(id)) {
      return false;
    }

    return historyStore.deleteConversation(id);
  });

  ipcMain.handle("history:clear", (event) => {
    if (!isChatSender(event) || !historyStore) {
      throw new Error("Unauthorized history request");
    }

    historyStore.clearConversations();
  });

  ipcMain.handle("memory:get-settings", (event) => {
    if (!isChatSender(event) || !memoryStore) {
      throw new Error("Unauthorized memory request");
    }

    return memoryStore.getSettings();
  });

  ipcMain.handle("memory:set-enabled", (event, enabled: unknown) => {
    if (!isChatSender(event) || !memoryStore || typeof enabled !== "boolean") {
      throw new Error("Invalid memory request");
    }

    return memoryStore.setEnabled(enabled);
  });

  ipcMain.handle("memory:list", (event) => {
    if (!isChatSender(event) || !memoryStore) {
      throw new Error("Unauthorized memory request");
    }

    return memoryStore.listCards();
  });

  ipcMain.handle("memory:get", (event, id: unknown) => {
    if (!isChatSender(event) || !memoryStore || !isMemoryId(id)) {
      throw new Error("Invalid memory request");
    }

    return memoryStore.getCard(id);
  });

  ipcMain.handle("memory:create", (event, draft: unknown) => {
    const parsedDraft = parseMemoryCardDraft(draft);

    if (!isChatSender(event) || !memoryStore || !parsedDraft) {
      throw new Error("Invalid memory request");
    }

    return memoryStore.createCard(parsedDraft);
  });

  ipcMain.handle("memory:update", (event, id: unknown, update: unknown) => {
    const parsedUpdate: MemoryCardUpdate | null = parseMemoryCardUpdate(update);

    if (!isChatSender(event) || !memoryStore || !isMemoryId(id) || !parsedUpdate) {
      throw new Error("Invalid memory request");
    }

    return memoryStore.updateCard(id, parsedUpdate);
  });

  ipcMain.handle("memory:delete", (event, id: unknown) => {
    if (!isChatSender(event) || !memoryStore || !isMemoryId(id)) {
      return false;
    }

    return memoryStore.deleteCard(id);
  });

  ipcMain.handle("memory:clear", (event) => {
    if (!isChatSender(event) || !memoryStore) {
      throw new Error("Unauthorized memory request");
    }

    memoryStore.clearCards();
  });

  ipcMain.handle("dialogueMode:list", (event) => {
    if (!isChatSender(event)) {
      throw new Error("Unauthorized dialogue mode request");
    }

    return DIALOGUE_MODE_VIEWS;
  });

  ipcMain.handle("dialogueMode:get", (event) => {
    if (!isChatSender(event) && !isPetSender(event)) {
      throw new Error("Unauthorized dialogue mode request");
    }

    return currentDialogueModeId;
  });

  ipcMain.handle("dialogueMode:set", (event, modeId: unknown) => {
    if (!isChatSender(event) || !dialogueModeStore || !isDialogueModeId(modeId)) {
      throw new Error("Invalid dialogue mode request");
    }

    const previousModeId = currentDialogueModeId;
    currentDialogueModeId = dialogueModeStore.saveMode(modeId);

    if (previousModeId !== currentDialogueModeId) {
      logTelemetry("dialogue_mode_changed", {
        previousModeId,
        nextModeId: currentDialogueModeId,
        reason: "chat_ui"
      });
      notifyChatDialogueModeChanged(currentDialogueModeId);
      notifyPetDialogueModeChanged(currentDialogueModeId);
    }

    return currentDialogueModeId;
  });

  ipcMain.handle("presenceMode:list", (event) => {
    if (!isChatSender(event)) {
      throw new Error("Unauthorized presence mode request");
    }

    return PRESENCE_MODE_VIEWS;
  });

  ipcMain.handle("presenceMode:get", (event) => {
    if (!isChatSender(event) && !isPetSender(event)) {
      throw new Error("Unauthorized presence mode request");
    }

    return currentPresenceModeId;
  });

  ipcMain.handle("presenceMode:set", (event, modeId: unknown) => {
    if (!isChatSender(event) || !presenceModeStore || !isPresenceModeId(modeId)) {
      throw new Error("Invalid presence mode request");
    }

    const previousModeId = currentPresenceModeId;
    currentPresenceModeId = presenceModeStore.saveMode(modeId);

    if (previousModeId !== currentPresenceModeId) {
      logTelemetry("presence_mode_changed", {
        previousModeId,
        nextModeId: currentPresenceModeId,
        reason: "chat_ui"
      });
      notifyChatPresenceModeChanged(currentPresenceModeId);
      notifyPetPresenceModeChanged(currentPresenceModeId);
    }

    return currentPresenceModeId;
  });

  ipcMain.handle("userProfile:get", (event) => {
    if (!isChatSender(event) || !userProfileStore) {
      throw new Error("Unauthorized user profile request");
    }

    return userProfileStore.getProfile();
  });

  ipcMain.handle("userProfile:save", (event, profile: unknown) => {
    if (!isChatSender(event) || !userProfileStore) {
      throw new Error("Unauthorized user profile request");
    }

    return userProfileStore.saveProfile(profile);
  });

  ipcMain.handle("userProfile:clear", (event) => {
    if (!isChatSender(event) || !userProfileStore) {
      throw new Error("Unauthorized user profile request");
    }

    userProfileStore.clearProfile();
  });

  ipcMain.handle("config:get-provider-status", (event) => {
    if (!isChatSender(event)) {
      throw new Error("Unauthorized config request");
    }

    return getCurrentProviderStatus();
  });

  ipcMain.handle("config:check-provider-health", async (event, request: unknown) => {
    if (!isChatSender(event) || !isProviderHealthCheckRequest(request)) {
      throw new Error("Invalid provider health request");
    }

    return checkProviderHealth({
      request,
      apiKey: request.providerId === "openai-compatible" ? getApiKey(DEFAULT_API_KEY_REF) : null,
      logTelemetry
    });
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

  ipcMain.handle("pet-presentation:get", (event) => {
    if (!isChatSender(event)) {
      throw new Error("Unauthorized pet presentation request");
    }

    return getCurrentPetPresentationPreferences();
  });

  ipcMain.handle("pet-presentation:set-scale", (event, petScale: unknown) => {
    const normalizedScale = normalizePetScale(petScale);

    if (!isChatSender(event) || normalizedScale === null || !petPresentationStore) {
      throw new Error("Invalid pet presentation request");
    }

    currentPetPresentationPreferences = {
      ...currentPetPresentationPreferences,
      petScale: normalizedScale
    };
    const preferences = petPresentationPersistence?.saveNow(currentPetPresentationPreferences)
      ?? petPresentationStore.savePreferences(currentPetPresentationPreferences);

    if (petWindow && !petWindow.isDestroyed()) {
      applyPetPresentationPreferences(petWindow, preferences);
    }

    return preferences;
  });

  ipcMain.handle("pet-presentation:set-accessory", (event, presetId: unknown) => {
    if (!isChatSender(event) || !isPetAccessoryPresetId(presetId) || !petPresentationStore) {
      throw new Error("Invalid pet accessory preset request");
    }

    currentPetPresentationPreferences = {
      ...currentPetPresentationPreferences,
      accessoryPresetId: presetId
    };
    const preferences = petPresentationPersistence?.saveNow(currentPetPresentationPreferences)
      ?? petPresentationStore.savePreferences(currentPetPresentationPreferences);
    currentPetPresentationIntent = withCurrentAccessoryPreset(currentPetPresentationIntent);
    publishPetPresentation(currentPetPresentationIntent);

    return preferences;
  });

  ipcMain.handle("pet-lock:get", (event) => {
    if (!isChatSender(event)) {
      return { isLocked: isPetLocked };
    }

    return { isLocked: isPetLocked };
  });

  ipcMain.handle("pet-lock:set", (event, value: unknown) => {
    if (!isChatSender(event) || typeof value !== "boolean") {
      return { isLocked: isPetLocked };
    }

    return setPetLocked(value, "chat_pet_lock_toggle");
  });

  ipcMain.handle("shortcuts:get", (event) => {
    if (!isChatSender(event)) {
      throw new Error("Unauthorized shortcut request");
    }

    return shortcutRegistry?.getShortcutViews() ?? [];
  });

  ipcMain.handle("shortcuts:update", (event, actionId: unknown, accelerator: unknown) => {
    if (!isChatSender(event) || !shortcutRegistry) {
      throw new Error("Invalid shortcut update request");
    }

    return shortcutRegistry.updateShortcut(actionId, accelerator);
  });

  ipcMain.handle("shortcuts:reset", (event, actionId: unknown) => {
    if (!isChatSender(event) || !shortcutRegistry) {
      throw new Error("Invalid shortcut reset request");
    }

    return shortcutRegistry.resetShortcut(actionId);
  });
});

function createChatRuntimeContext(now = new Date()): ChatRuntimeContext {
  const locale = app.getLocale() || Intl.DateTimeFormat().resolvedOptions().locale || "zh-CN";
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  return {
    isoTime: now.toISOString(),
    localDate: formatLocalDate(now, locale, timezone),
    localTime: formatLocalTime(now, locale, timezone),
    weekday: formatLocalWeekday(now, locale, timezone),
    timezone,
    locale
  };
}

function formatLocalDate(value: Date, locale: string, timezone: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(value);
}

function formatLocalTime(value: Date, locale: string, timezone: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(value);
}

function formatLocalWeekday(value: Date, locale: string, timezone: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    weekday: "long"
  }).format(value);
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("will-quit", () => {
  stopLlamaCppRuntime();
  petPresentationPersistence?.flush();
  shortcutRegistry?.unregisterAll();
  shortcutRegistry = null;
  globalShortcut.unregisterAll();
});

app.on("activate", () => {
  ensurePetWindow("activate");
});
