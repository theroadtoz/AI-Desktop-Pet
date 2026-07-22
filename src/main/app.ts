import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  powerMonitor,
  protocol,
  screen,
  type OpenDialogOptions,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from "electron";
import { randomUUID } from "node:crypto";
import { release as getOsRelease } from "node:os";
import { isAbsolute, join } from "node:path";
import type { ChatContextBudgetSummary, ChatProviderId, ChatRequest, ChatRuntimeContext } from "../shared/chat-provider";
import type {
  ChatContextTransparencyPayload,
  ConfigApiKeyRequest,
  ConfigSetApiKeyRequest,
  ChatMemoryActivityPayload,
  ChatStreamErrorType,
  ChatSendRequest,
  PetActivityEcho,
  PetDragDelta,
  PetFirstFrameInfo,
  PetOverlayHitRegion,
  PetPointerHitState,
  PetTelemetryEvent,
  RenderHealth
} from "../shared/ipc-contract";
import { isChatMessage } from "../shared/ipc-contract";
import {
  PROACTIVE_BUBBLE_CANDIDATE_IDS,
  DEFAULT_PROACTIVE_SPEECH_BUBBLE_DURATION_MS,
  getProactiveSpeechBubbleTimeBand,
  isProactiveSpeechBubbleTimeBand,
  selectProactiveSpeechBubbleLineId,
  type ProactiveSpeechBubbleReason,
  type ProactiveSpeechBubblePayload,
  type ProactiveSpeechBubbleSafeContextTag,
  type ProactiveSpeechBubbleTimeBand
} from "../shared/proactive-speech-bubble";
import {
  DEFAULT_PROACTIVE_COMPANION_SETTINGS,
  getProactiveCompanionIdleIntervalMs,
  shouldQueueProactiveCompanionSourceBubble,
  type ProactiveCompanionSettings
} from "../shared/proactive-companion-settings";
import {
  DEFAULT_ENVIRONMENT_ACTION_SETTINGS,
  type EnvironmentActionSettings
} from "../shared/environment-action-settings";
import {
  selectLowFrequencyCompanionEvent,
  type LowFrequencyCompanionEventId,
  type LowFrequencyCompanionEvent
} from "../shared/daily-state-orchestration";
import { isHistoryId, type HistoryMessage } from "../shared/chat-history";
import { isMemoryId, parseMemoryCardDraft, parseMemoryCardUpdate, type MemoryCardUpdate } from "../shared/chat-memory";
import type { DialogueModeId } from "../shared/dialogue-style";
import type { PresenceModeId } from "../shared/presence-mode";
import type { AutomaticSituationSnapshot } from "../shared/automatic-situation-context";
import { selectEmotionPresentation } from "../shared/emotion-presentation";
import {
  getPetInteractionActionSafeEchoMessage,
  getPetWindowMotionFeedbackSafeEchoMessage
} from "../shared/interaction-action-catalog";
import {
  getAccessoryIdsForLegacyPreset,
  getPetAccessoryModeLayer,
  isPetAccessoryPresetId,
  parsePetAccessorySelection,
  resolvePetAccessorySelection,
  type PetAccessoryId
} from "../shared/pet-accessory";
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
  BAIDU_SEARCH_VERIFICATION_REQUIRED_ERROR,
  getWebSearchFailurePrompt,
  type WebSearchCitationPayload,
  type WebSearchContext,
  type WebSearchErrorType,
  type WebSearchReasonCode
} from "../shared/web-search";
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
  isPetActionTriggerReason,
  isPetNearWorkAreaEdge,
  type PetActionTriggerReason
} from "../shared/pet-action-trigger";
import {
  getPetActionStateActionType,
  getPetActionStateTriggerReason,
  selectPetActionStateForModeChange,
  selectPetActionTriggerForChatReplyWaiting,
  type PetActionStateId
} from "../shared/pet-action-state-machine";
import { ChatEngineBusyError, createChatEngine, type ChatEngine } from "./services/chat/chat-engine";
import { budgetChatContext } from "./services/chat/chat-context-budget";
import { createChatReplySustainTriggerController } from "./services/chat/chat-reply-sustain-trigger";
import {
  createPetActionRuntimePolicy,
  shouldTriggerReplyWarmSettle
} from "./services/pet-action-runtime-policy";
import { createHistoryStore, type HistoryStore } from "./services/chat/history-store";
import { createMemoryStore, type AutoMemoryCaptureSummary, type MemoryStore } from "./services/chat/memory-store";
import { createChatProviderFromConfig } from "./services/chat/provider-factory";
import { checkProviderHealth } from "./services/chat/provider-health";
import {
  createMcpSearchProvider,
  mcpSearchSessionRegistry,
  testMcpSearchConnection
} from "./services/search/mcp-search-client";
import { createSearchPrivacyDecision } from "./services/search/search-privacy-gateway";
import { createWebSearchCitationPayload, createWebSearchContext } from "./services/search/web-search-provider";
import { readEnvProviderConfig, type EnvProviderConfig } from "./services/config/env-config";
import {
  createProactiveCompanionSettingsStore,
  type ProactiveCompanionSettingsStore
} from "./services/config/proactive-companion-settings-store";
import {
  createEnvironmentActionSettingsStore,
  type EnvironmentActionSettingsStore
} from "./services/config/environment-action-settings-store";
import { createDesktopContextMonitor } from "./services/desktop-context/desktop-context-monitor";
import { createWindowsDesktopContextProvider } from "./services/desktop-context/windows-desktop-context-provider";
import {
  createAutomaticSituationCoordinator,
  type AutomaticSituationCoordinator
} from "./services/automatic-situation/automatic-situation-coordinator";
import { createBundledLocalSituationClassifier } from "./services/automatic-situation/bundled-local-situation-classifier";
import {
  createCoarseUserStateCoordinator,
  type CoarseUserStateCoordinator
} from "./services/automatic-situation/coarse-user-state-coordinator";
import {
  createProactiveBubbleCoordinator,
  type ProactiveBubbleCoordinator,
  type ProactiveBubbleRuntimeGates
} from "./services/proactive-companion/proactive-bubble-coordinator";
import {
  createProactiveBubbleLedgerStore,
  type ProactiveBubbleLedgerStore
} from "./services/config/proactive-bubble-ledger-store";
import {
  createWebSearchSettingsStore,
  normalizeWebSearchSettings,
  type WebSearchSettingsStore
} from "./services/config/web-search-settings-store";
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
  createPetActionDispatchCoordinator,
  type PetActionDispatchCoordinator,
  type PetActionDispatchPolicy
} from "./services/pet-action-dispatch-coordinator";
import { isTrustedIpcSender } from "./ipc/trusted-ipc-sender";
import { createAppShutdownCoordinator } from "./lifecycle/app-shutdown-coordinator";
import {
  createLlamaCppRuntime,
  readLlamaCppRuntimeConfigFromEnv,
  type LlamaCppRuntimeConfig,
  type LlamaCppRuntimeSummary,
  type LlamaCppRuntime
} from "./services/local-runtime/llama-cpp-runtime";
import {
  resolveBundledLlamaCppRuntime,
  type BundledLlamaCppRuntimeSafeSummary
} from "./services/local-runtime/bundled-llama-cpp-runtime";
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
let bundledLlamaCppProviderConfig: LocalOpenAICompatibleConfig | null = null;
let managedLlamaCppProviderConfig: LocalOpenAICompatibleConfig | null = null;
let petPresentationStore: PetPresentationStore | null = null;
let petPresentationPersistence: PetPresentationPersistence | null = null;
let historyStore: HistoryStore | null = null;
let memoryStore: MemoryStore | null = null;
let webSearchSettingsStore: WebSearchSettingsStore | null = null;
let proactiveCompanionSettingsStore: ProactiveCompanionSettingsStore | null = null;
let proactiveBubbleLedgerStore: ProactiveBubbleLedgerStore | null = null;
let proactiveBubbleCoordinator: ProactiveBubbleCoordinator | null = null;
let environmentActionSettingsStore: EnvironmentActionSettingsStore | null = null;
let shortcutPreferencesStore: ShortcutPreferencesStore | null = null;
let userProfileStore: UserProfileStore | null = null;
let shortcutRegistry: ShortcutRegistry | null = null;
let llamaCppRuntime: LlamaCppRuntime | null = null;
let bundledLlamaCppRuntime: LlamaCppRuntime | null = null;
let llamaCppRuntimeSettingsStore: LlamaCppRuntimeSettingsStore | null = null;
let latestLlamaCppRuntimeSummary: LlamaCppRuntimeSummary | null = null;
let latestBundledLlamaCppRuntimeSummary: BundledLlamaCppRuntimeSafeSummary | null = null;
let bundledLlamaCppRuntimeStartupPromise: Promise<BundledLlamaCppRuntimeSafeSummary> | null = null;
let refreshCurrentProvider: (() => void) | null = null;
let openChatWindowAdapter: (() => void) | null = null;
let pendingChatWindowOpen = false;
let automaticSituationCoordinator: AutomaticSituationCoordinator | null = null;
let removeAutomaticSituationListener: (() => void) | null = null;
let coarseUserStateCoordinator: CoarseUserStateCoordinator | null = null;
let removeCoarseUserStateListener: (() => void) | null = null;
let removeDesktopContextSnapshotListener: (() => void) | null = null;
let currentPetPresentationPreferences: PetPresentationPreferences = DEFAULT_PET_PRESENTATION_PREFERENCES;
let isChatInteractionActive = false;
let petRoleSnapshot: PetRoleSnapshot = INITIAL_PET_ROLE_SNAPSHOT;
let currentPetPresentationIntent: PetPresentationIntent = createPetPresentationIntent(petRoleSnapshot);
let activeChatRequestVersion: number | null = null;
let currentDialogueModeId: DialogueModeId = "default";
let currentPresenceModeId: PresenceModeId = "default";
let currentProactiveCompanionSettings: ProactiveCompanionSettings = DEFAULT_PROACTIVE_COMPANION_SETTINGS;
let currentEnvironmentActionSettings: EnvironmentActionSettings = DEFAULT_ENVIRONMENT_ACTION_SETTINGS;
let performanceHeartbeat: NodeJS.Timeout | null = null;
let isPetLocked = false;
let initialEdgeGlanceTimer: NodeJS.Timeout | null = null;
let pendingModeActionStateTriggerTimer: NodeJS.Timeout | null = null;
let startupProactiveSpeechBubbleTimer: NodeJS.Timeout | null = null;
let idleProactiveSpeechBubbleTimer: NodeJS.Timeout | null = null;
let hasHandledStartupProactiveSpeechBubble = false;
let proactiveSpeechBubbleTick = 0;
let proactiveSpeechBubbleVisibleUntil = 0;
let hasPetFirstFrame = false;
let lastLowFrequencyCompanionEventAt: number | null = null;
let lastLowFrequencyCompanionEventId: LowFrequencyCompanionEvent["eventId"] | null = null;
let pendingSourcedLowFrequencyCompanionEvents: SourcedLowFrequencyCompanionEvent[] = [];
let petActionDispatchCoordinator: PetActionDispatchCoordinator | null = createPetActionDispatchCoordinator({
  send(trigger) {
    if (!petWindow || petWindow.isDestroyed()) {
      throw new Error("Pet window unavailable");
    }

    petWindow.webContents.send("pet:action-trigger", trigger);
  },
  now: () => Date.now(),
  createRequestId: () => randomUUID().replaceAll("-", "")
});

type SourcedLowFrequencyCompanionEvent = {
  eventId: LowFrequencyCompanionEventId;
  actionStateId: PetActionStateId;
  queuedAtMs: number;
};

const PET_RENDERER_RECOVERY_WINDOW_MS = 60_000;
const DEFAULT_API_KEY_REF = "openai-compatible-default";
const PET_RENDERER_MAX_RECOVERIES = 3;
const STARTUP_LOCAL_FALLBACK_PROVIDER_CONFIG: ProviderConfig = {
  providerId: "fake",
  displayName: "本地即时对话"
};
const PET_WINDOW_TITLE = "Desktop Pet";
const PET_ACTION_TRIGGER_THROTTLE_MS = 700;
const PET_MODE_ACTION_STATE_TRIGGER_DELAY_MS = 2_000;
const PET_INITIAL_EDGE_GLANCE_DELAY_MS = 2_350;
const PET_DRAG_END_EDGE_GLANCE_DELAY_MS = 100;
const PET_CHAT_REPLY_SUSTAIN_MIN_CHARS = 42;
const PET_CHAT_REPLY_SUSTAIN_DELAY_MS = 1_250;
const PET_STARTUP_PROACTIVE_SPEECH_BUBBLE_DELAY_MS = 3_500;
const isAcceptanceTelemetryEnabled = process.env.AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY === "1";
const isP283aAcceptanceInjectionOnly = isAcceptanceTelemetryEnabled &&
  process.env.AI_DESKTOP_PET_P2_83A_SAFE_INJECTION === "1";
const isP245AcceptanceSafeActive = isAcceptanceTelemetryEnabled &&
  process.env.AI_DESKTOP_PET_P2_45_SAFE_ACTIVE_CONTEXT === "1";
const p283aAcceptanceScenario = isP283aAcceptanceInjectionOnly
  ? process.env.AI_DESKTOP_PET_P2_83A_SCENARIO
  : undefined;
const PET_IDLE_PROACTIVE_SPEECH_BUBBLE_BASE_INTERVAL_MS = readProactiveSpeechBubbleIdleIntervalMs(
  process.env.AI_DESKTOP_PET_PROACTIVE_SPEECH_BUBBLE_IDLE_INTERVAL_MS,
  isAcceptanceTelemetryEnabled
);
const BASE_RUNTIME_LOW_FREQUENCY_COMPANION_EVENT_IDS = [
  "idle-presence-check",
  "mode-presence-echo",
  "context-settle"
] as const satisfies readonly LowFrequencyCompanionEventId[];
const SOURCED_LOW_FREQUENCY_COMPANION_EVENT_TTL_MS = 15 * 60 * 1_000;
const LOW_FREQUENCY_COMPANION_EVENT_ACCEPTANCE_MINIMUM_INTERVAL_MS = readLowFrequencyCompanionEventAcceptanceMinimumIntervalMs(
  process.env.AI_DESKTOP_PET_LOW_FREQUENCY_COMPANION_EVENT_MINIMUM_INTERVAL_MS,
  isAcceptanceTelemetryEnabled
);
const ACCEPTANCE_PROACTIVE_SPEECH_BUBBLE_TIME_BAND = readAcceptanceProactiveSpeechBubbleTimeBand(
  process.env.AI_DESKTOP_PET_PROACTIVE_SPEECH_BUBBLE_TIME_BAND,
  isAcceptanceTelemetryEnabled
);
let petRendererRecoveryTimes: number[] = [];
const lastPetActionTriggerAtByReason: Partial<Record<PetActionTriggerReason, number>> = {};
const chatReplySustainTrigger = createChatReplySustainTriggerController({
  minChars: PET_CHAT_REPLY_SUSTAIN_MIN_CHARS,
  delayMs: PET_CHAT_REPLY_SUSTAIN_DELAY_MS,
  sendReason(reason) {
    sendPetActionTrigger(reason);
  }
});
const petActionRuntimePolicy = createPetActionRuntimePolicy({
  persistEveningDateKey(dateKey) {
    environmentActionSettingsStore?.saveEveningDateKey(dateKey);
  }
});
const windowsDesktopContextProvider = createWindowsDesktopContextProvider();
const desktopContextMonitor = createDesktopContextMonitor({
  provider: windowsDesktopContextProvider,
  getSystemIdleTime() {
    return powerMonitor.getSystemIdleTime();
  },
  sendReason() {
    // P2-83A owns environment action delivery after the coordinator handshake.
    return true;
  }
});
const handleSystemLock = (): void => desktopContextMonitor.lock();
const handleSystemUnlock = (): void => desktopContextMonitor.unlock();
const handleSystemSuspend = (): void => desktopContextMonitor.suspend();
const handleSystemResume = (): void => desktopContextMonitor.resume();

const shutdownCoordinator = createAppShutdownCoordinator({
  quiesce: quiesceApp,
  stopAsyncResources: stopAsyncResourcesForShutdown,
  destroyWindows: destroyAppWindows,
  finalQuit() {
    app.quit();
  },
  reportError(error) {
    console.error("[app] shutdown step failed", error);
  }
});

const userDataPathOverride = process.env.AI_DESKTOP_PET_USER_DATA_PATH;
const allowPackagedUserDataOverride =
  process.env.AI_DESKTOP_PET_ACCEPTANCE_TELEMETRY === "1" &&
  process.env.AI_DESKTOP_PET_ALLOW_PACKAGED_USER_DATA_OVERRIDE === "1";

if (
  userDataPathOverride &&
  isAbsolute(userDataPathOverride) &&
  (!app.isPackaged || allowPackagedUserDataOverride)
) {
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
  if (openChatWindowAdapter) {
    openChatWindowAdapter();
  } else {
    pendingChatWindowOpen = true;
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

  nextPetWindow.on("closed", () => {
    if (petWindow === nextPetWindow) {
      desktopContextMonitor.setRendererReady(false);
    }
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
  desktopContextMonitor.setRendererReady(false);
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

function readProactiveSpeechBubbleIdleIntervalMs(value: string | undefined, isAcceptance: boolean): number {
  const fallback = 12 * 60_000;
  const minimum = isAcceptance ? 900 : 5 * 60_000;
  const maximum = 60 * 60_000;
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(maximum, Math.max(minimum, Math.round(parsed)));
}

function readAcceptanceProactiveSpeechBubbleTimeBand(
  value: string | undefined,
  isAcceptance: boolean
): ProactiveSpeechBubbleTimeBand | null {
  if (!isAcceptance || !isProactiveSpeechBubbleTimeBand(value)) {
    return null;
  }

  return value;
}

function readLowFrequencyCompanionEventAcceptanceMinimumIntervalMs(
  value: string | undefined,
  isAcceptance: boolean
): number | null {
  if (!isAcceptance) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return Math.min(60 * 60_000, Math.max(100, Math.round(parsed)));
}

function startBundledLlamaCppRuntimeIfAvailable(options: {
  refreshProvider?: () => void;
} = {}): void {
  const startup = startBundledLlamaCppRuntimeNow(options);
  bundledLlamaCppRuntimeStartupPromise = startup;
  void startup.catch(() => undefined).finally(() => {
    if (bundledLlamaCppRuntimeStartupPromise === startup) {
      bundledLlamaCppRuntimeStartupPromise = null;
    }
  });
}

async function startBundledLlamaCppRuntimeNow(options: {
  refreshProvider?: () => void;
} = {}): Promise<BundledLlamaCppRuntimeSafeSummary> {
  const resolved = resolveBundledLlamaCppRuntime();
  latestBundledLlamaCppRuntimeSummary = resolved.safeSummary;
  logTelemetry("bundled_llama_cpp_runtime_resolved", resolved.safeSummary);

  if (!resolved.config) {
    if (bundledLlamaCppProviderConfig) {
      bundledLlamaCppProviderConfig = null;
    }
    options.refreshProvider?.();
    return resolved.safeSummary;
  }

  const runtime = createLlamaCppRuntime(resolved.config);
  bundledLlamaCppRuntime = runtime;

  try {
    const summary = await runtime.start();
    const bundledSummary = mergeBundledRuntimeSummary(resolved.safeSummary, summary);
    latestBundledLlamaCppRuntimeSummary = bundledSummary;
    logTelemetry("bundled_llama_cpp_runtime_status", bundledSummary);

    if (bundledLlamaCppRuntime !== runtime) {
      return latestBundledLlamaCppRuntimeSummary;
    }

    const handoff = createLlamaCppProviderHandoff(summary, runtime.getBaseURL(), {
      displayName: "内置本地模型",
      localPresetId: "embedded-llama-cpp"
    });

    if (!handoff) {
      if (bundledLlamaCppProviderConfig) {
        bundledLlamaCppProviderConfig = null;
        options.refreshProvider?.();
      }
      return bundledSummary;
    }

    bundledLlamaCppProviderConfig = handoff.providerConfig;
    logTelemetry("bundled_llama_cpp_provider_handoff", handoff.safeSummary);
    options.refreshProvider?.();
    return bundledSummary;
  } catch {
    if (bundledLlamaCppRuntime === runtime && bundledLlamaCppProviderConfig) {
      bundledLlamaCppProviderConfig = null;
    }
    options.refreshProvider?.();

    const errorSummary = mergeBundledRuntimeSummary(resolved.safeSummary, {
      runtime: "llama.cpp",
      enabled: true,
      status: "error",
      safeSummaryOnly: true,
      executableConfigured: true,
      modelConfigured: true
    });
    latestBundledLlamaCppRuntimeSummary = errorSummary;
    logTelemetry("bundled_llama_cpp_runtime_status", errorSummary);
    return errorSummary;
  }
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

  managedLlamaCppProviderConfig = null;
  refreshCurrentProvider?.();
  return runtime.stop()
    .then((summary) => {
      if (summary.status !== "timeout" && llamaCppRuntime === runtime) {
        llamaCppRuntime = null;
      }
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

function mergeBundledRuntimeSummary(
  bundledSummary: BundledLlamaCppRuntimeSafeSummary,
  runtimeSummary: LlamaCppRuntimeSummary
): BundledLlamaCppRuntimeSafeSummary {
  return removeUndefinedBundledRuntimeSummary({
    ...bundledSummary,
    status: runtimeSummary.status,
    enabled: runtimeSummary.enabled,
    executableConfigured: runtimeSummary.executableConfigured,
    modelConfigured: runtimeSummary.modelConfigured,
    ...(runtimeSummary.baseURLHost ? { baseURLHost: runtimeSummary.baseURLHost } : {}),
    ...(runtimeSummary.alias ? { alias: runtimeSummary.alias } : {}),
    ...(typeof runtimeSummary.durationMs === "number" ? { durationMs: runtimeSummary.durationMs } : {}),
    ...(typeof runtimeSummary.startupMs === "number" ? { startupMs: runtimeSummary.startupMs } : {}),
    ...(typeof runtimeSummary.exitCode !== "undefined" ? { exitCode: runtimeSummary.exitCode } : {}),
    ...(typeof runtimeSummary.signal !== "undefined" ? { signal: runtimeSummary.signal } : {}),
    ...(typeof runtimeSummary.stdoutBytes === "number" ? { stdoutBytes: runtimeSummary.stdoutBytes } : {}),
    ...(typeof runtimeSummary.stderrBytes === "number" ? { stderrBytes: runtimeSummary.stderrBytes } : {}),
    ...(runtimeSummary.reason ? { reason: runtimeSummary.reason } : {})
  });
}

function removeUndefinedBundledRuntimeSummary(
  summary: BundledLlamaCppRuntimeSafeSummary
): BundledLlamaCppRuntimeSafeSummary {
  return Object.fromEntries(
    Object.entries(summary).filter(([, value]) => typeof value !== "undefined")
  ) as BundledLlamaCppRuntimeSafeSummary;
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

function getBundledLlamaCppDiagnosticConfig() {
  return latestBundledLlamaCppRuntimeSummary ?? resolveBundledLlamaCppRuntime().safeSummary;
}

function createLocalModelDiagnosticFailureSummary(): LocalModelDiagnosticSafeSummary {
  return {
    ok: false,
    status: "script_failed",
    recommendedRuntime: "llama-cpp-bundled",
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
      bundled: runtime.bundled,
      resourceSource: runtime.resourceSource,
      manifestFound: runtime.manifestFound,
      executableConfigured: runtime.executableConfigured,
      modelConfigured: runtime.modelConfigured
    }))
  });
}

function logPetTelemetry(event: { type: PetTelemetryEventType; payload?: unknown }): void {
  const safeEvent = sanitizePetTelemetryEvent(event);
  logTelemetry(safeEvent.type, safeEvent.payload);
}

function requestPetActionTrigger(
  reason: PetActionTriggerReason,
  policy?: PetActionDispatchPolicy
): string | null {
  if (!petActionDispatchCoordinator) {
    return null;
  }

  const now = Date.now();
  const lastTriggeredAt = lastPetActionTriggerAtByReason[reason] ?? 0;
  if (now - lastTriggeredAt < PET_ACTION_TRIGGER_THROTTLE_MS) {
    return null;
  }

  const result = petActionDispatchCoordinator.dispatch(reason, policy);
  if (!result.accepted) {
    return null;
  }

  lastPetActionTriggerAtByReason[reason] = now;
  return result.requestId;
}

function sendPetActionTrigger(reason: PetActionTriggerReason, policy?: PetActionDispatchPolicy): boolean {
  return requestPetActionTrigger(reason, policy) !== null;
}

function syncAutomaticPresenceLifecycle(): AutomaticSituationSnapshot | null {
  if (!automaticSituationCoordinator) {
    return null;
  }

  let systemIdleMs = 0;
  try {
    systemIdleMs = Math.max(0, powerMonitor.getSystemIdleTime() * 1_000);
  } catch {
    systemIdleMs = 0;
  }

  return automaticSituationCoordinator.updatePresenceLifecycle({
    appActive: isChatInteractionActive || activeChatRequestVersion !== null,
    quietRequested: currentProactiveCompanionSettings.cadence === "off",
    localTimeBand: getRuntimeProactiveSpeechBubbleTimeBand(),
    systemIdleMs
  });
}

function applyAutomaticSituationSnapshot(snapshot: AutomaticSituationSnapshot): void {
  const previousDialogueContextId = currentDialogueModeId;
  const previousPresenceStateId = currentPresenceModeId;
  currentDialogueModeId = snapshot.conversationContextId;
  currentPresenceModeId = snapshot.presenceStateId;
  proactiveBubbleCoordinator?.updateDialogueMode(currentDialogueModeId);

  if (previousDialogueContextId !== currentDialogueModeId) {
    const runtimeActionReason = petActionRuntimePolicy.onDialogueModeChanged(
      currentDialogueModeId,
      previousPresenceStateId
    );
    currentPetPresentationIntent = withCurrentAccessorySelection(currentPetPresentationIntent);
    publishPetPresentation(currentPetPresentationIntent);
    const actionState = selectPetActionStateForModeChange({
      dialogueModeId: currentDialogueModeId,
      presenceModeId: currentPresenceModeId
    });
    if (actionState && actionState.stateId !== "idle") {
      schedulePetModeActionStateTrigger(actionState.triggerReason);
    }
    void runtimeActionReason;
  }

  if (previousPresenceStateId !== currentPresenceModeId) {
    petActionRuntimePolicy.onPresenceModeChanged(currentPresenceModeId);
    if (currentPresenceModeId === "sleep") {
      cancelStartupProactiveSpeechBubbleTimer();
      cancelIdleProactiveSpeechBubbleTimer();
      markProactiveSpeechBubbleHidden();
      clearSourcedLowFrequencyCompanionEvents();
    }

    const actionState = selectPetActionStateForModeChange({
      dialogueModeId: currentDialogueModeId,
      presenceModeId: currentPresenceModeId
    });
    if (actionState && (
      actionState.stateId !== "idle" ||
      previousPresenceStateId === "sleep" && currentPresenceModeId === "default"
    )) {
      schedulePetModeActionStateTrigger(actionState.triggerReason);
    }
    if (currentPresenceModeId !== "sleep") {
    }
  }

  if (petWindow && !petWindow.isDestroyed()) {
    petWindow.webContents.send("automaticSituation:changed", snapshot);
  }
  if (previousDialogueContextId !== currentDialogueModeId || previousPresenceStateId !== currentPresenceModeId) {
    logTelemetry("automatic_situation_changed", {
      previousConversationContextId: previousDialogueContextId,
      conversationContextId: currentDialogueModeId,
      conversationSource: snapshot.conversationSource,
      previousPresenceStateId,
      presenceStateId: currentPresenceModeId,
      presenceSource: snapshot.presenceSource,
      revision: snapshot.revision
    });
    scheduleIdleProactiveSpeechBubble();
  }
  refreshProactiveBubbleRuntimeGates();
}

function cancelPendingModeActionStateTrigger(): void {
  if (!pendingModeActionStateTriggerTimer) {
    return;
  }

  clearTimeout(pendingModeActionStateTriggerTimer);
  pendingModeActionStateTriggerTimer = null;
}

function schedulePetModeActionStateTrigger(reason: PetActionTriggerReason): void {
  cancelPendingModeActionStateTrigger();
  if (isP283aAcceptanceInjectionOnly) return;
  pendingModeActionStateTriggerTimer = setTimeout(() => {
    pendingModeActionStateTriggerTimer = null;
    const payload = createProactiveSpeechBubblePayload("mode_presence");
    proactiveBubbleCoordinator?.queuePresence("mode_presence", payload, reason);
  }, PET_MODE_ACTION_STATE_TRIGGER_DELAY_MS);
}

function logProactiveSpeechBubbleDecision(
  status: "shown" | "skipped",
  payload: Pick<ProactiveSpeechBubblePayload, "lineId" | "reason" | "durationMs">,
  extra: Record<string, unknown> = {}
): void {
  logTelemetry("proactive_speech_bubble", {
    status,
    lineId: payload.lineId,
    reason: payload.reason,
    durationMs: payload.durationMs,
    presenceModeId: currentPresenceModeId,
    dialogueModeId: currentDialogueModeId,
    cadence: currentProactiveCompanionSettings.cadence,
    ...extra
  });
}

function logLowFrequencyCompanionEventDecision(
  status: "queued" | "shown" | "skipped",
  event: LowFrequencyCompanionEvent | null,
  extra: {
    skipReason?: string | undefined;
    durationMs?: number | undefined;
    elapsedSinceLastEventMs?: number | undefined;
    minimumIntervalMs?: number | undefined;
    actionStateId?: PetActionStateId | undefined;
  } = {}
): void {
  const actionStateId = event
    ? extra.actionStateId ?? getEffectiveLowFrequencyCompanionActionStateId(event)
    : null;
  logTelemetry("low_frequency_companion_event", {
    eventId: event?.eventId ?? lastLowFrequencyCompanionEventId ?? null,
    reason: event?.bubbleReason ?? "idle_presence",
    stateId: actionStateId,
    actionType: actionStateId ? getPetActionStateActionType(actionStateId) : null,
    modeId: currentDialogueModeId,
    presenceModeId: currentPresenceModeId,
    status,
    skipReason: extra.skipReason,
    safeSummaryLabel: event?.safeSummaryLabel ?? null,
    interruptPolicy: event?.interruptPolicy ?? null,
    durationMs: extra.durationMs,
    elapsedSinceLastEventMs: extra.elapsedSinceLastEventMs,
    minimumIntervalMs: extra.minimumIntervalMs ?? event?.minimumIntervalMs
  });
}

function isChatVisible(): boolean {
  return Boolean(chatWindow && !chatWindow.isDestroyed() && chatWindow.isVisible());
}

function getProactiveBubbleRuntimeGates(): ProactiveBubbleRuntimeGates {
  const actionDispatchState = petActionDispatchCoordinator?.getState();
  return {
    petReady: hasPetFirstFrame,
    petWindowAvailable: Boolean(petWindow && !petWindow.isDestroyed()),
    chatVisible: isChatVisible(),
    interactionActive: isChatInteractionActive,
    modelBusy: p283aAcceptanceScenario === "busy" ||
      activeChatRequestVersion !== null || Boolean(chatEngine?.hasActiveStream()),
    highPriorityActionActive: actionDispatchState?.busy ?? false,
    highPriorityActionReason: actionDispatchState?.activeMainRequest?.reason ?? null
  };
}

function refreshProactiveBubbleRuntimeGates(): void {
  proactiveBubbleCoordinator?.updateRuntimeGates(getProactiveBubbleRuntimeGates());
}

function cancelStartupProactiveSpeechBubbleTimer(): void {
  if (!startupProactiveSpeechBubbleTimer) {
    return;
  }

  clearTimeout(startupProactiveSpeechBubbleTimer);
  startupProactiveSpeechBubbleTimer = null;
}

function cancelIdleProactiveSpeechBubbleTimer(): void {
  if (!idleProactiveSpeechBubbleTimer) {
    return;
  }

  clearTimeout(idleProactiveSpeechBubbleTimer);
  idleProactiveSpeechBubbleTimer = null;
}

function markProactiveSpeechBubbleHidden(): void {
  proactiveSpeechBubbleVisibleUntil = 0;
}

function clearPetProactiveSpeechBubble(): void {
  markProactiveSpeechBubbleHidden();
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }

  petWindow.webContents.send("pet:clear-proactive-speech-bubble");
}

function getRuntimeProactiveSpeechBubbleTimeBand(): ProactiveSpeechBubbleTimeBand {
  return ACCEPTANCE_PROACTIVE_SPEECH_BUBBLE_TIME_BAND ?? getProactiveSpeechBubbleTimeBand(new Date());
}

function getLowFrequencyCompanionSafeContextTag(
  event: LowFrequencyCompanionEvent | null
): ProactiveSpeechBubbleSafeContextTag | undefined {
  if (event?.eventId === "context-settle") {
    return "context_settle";
  }

  if (event?.eventId === "history-summary-pulse") {
    return "history_summary_safe";
  }

  if (event?.eventId === "memory-safe-pulse") {
    return "memory_safe_pulse";
  }

  if (event?.eventId === "search-citation-pulse") {
    return "search_citation_pulse";
  }

  return undefined;
}

function selectMemorySafePulseActionStateId(input: {
  autoCaptureSkippedReason: ChatMemoryActivityPayload["autoCapture"]["skippedReason"];
  memoryInjectionCount: number;
  capturedCount: number;
  mergedCount: number;
  deduplicatedCount: number;
  compressionTriggered: boolean;
}): PetActionStateId | null {
  if (input.autoCaptureSkippedReason === "sensitive" || input.autoCaptureSkippedReason === "capture_failed") {
    return "memory-skipped";
  }

  if (input.memoryInjectionCount > 0) {
    return "memory-injected";
  }

  if (
    input.capturedCount > 0 ||
    input.mergedCount > 0 ||
    input.deduplicatedCount > 0 ||
    input.compressionTriggered
  ) {
    return "proactive-bubble-visible";
  }

  return null;
}

function queueSourcedLowFrequencyCompanionEvent(
  eventId: LowFrequencyCompanionEventId,
  options: { actionStateId: PetActionStateId; now?: number }
): void {
  if (isP283aAcceptanceInjectionOnly) return;
  if (
    eventId !== "history-summary-pulse" &&
    eventId !== "memory-safe-pulse" &&
    eventId !== "search-citation-pulse"
  ) {
    return;
  }

  if (
    eventId === "memory-safe-pulse" &&
    !shouldQueueProactiveCompanionSourceBubble(currentProactiveCompanionSettings, "memory")
  ) {
    return;
  }

  if (
    eventId === "search-citation-pulse" &&
    !shouldQueueProactiveCompanionSourceBubble(currentProactiveCompanionSettings, "search")
  ) {
    return;
  }

  if (
    eventId === "history-summary-pulse" &&
    currentProactiveCompanionSettings.cadence === "off"
  ) {
    return;
  }

  if (proactiveBubbleCoordinator) {
    const sourceEventId = eventId === "memory-safe-pulse"
      ? "memory_safe"
      : eventId === "search-citation-pulse"
        ? "search_citation_safe"
        : "history_summary_safe";
    proactiveBubbleCoordinator.queueSource(
      sourceEventId,
      getPetActionStateTriggerReason(options.actionStateId)
    );
    return;
  }

  const now = options.now ?? Date.now();
  pruneExpiredSourcedLowFrequencyCompanionEvents(now);
  pendingSourcedLowFrequencyCompanionEvents = pendingSourcedLowFrequencyCompanionEvents
    .filter((candidate) => candidate.eventId !== eventId);
  pendingSourcedLowFrequencyCompanionEvents.push({
    eventId,
    actionStateId: options.actionStateId,
    queuedAtMs: now
  });
}

function pruneExpiredSourcedLowFrequencyCompanionEvents(now = Date.now()): void {
  if (pendingSourcedLowFrequencyCompanionEvents.length === 0) {
    return;
  }

  pendingSourcedLowFrequencyCompanionEvents = pendingSourcedLowFrequencyCompanionEvents
    .filter((candidate) => now - candidate.queuedAtMs <= SOURCED_LOW_FREQUENCY_COMPANION_EVENT_TTL_MS);
}

function clearQueuedSourcedLowFrequencyCompanionEvent(eventId: LowFrequencyCompanionEventId): void {
  pendingSourcedLowFrequencyCompanionEvents = pendingSourcedLowFrequencyCompanionEvents
    .filter((candidate) => candidate.eventId !== eventId);
}

function clearSourcedLowFrequencyCompanionEvents(): void {
  pendingSourcedLowFrequencyCompanionEvents = [];
  proactiveBubbleCoordinator?.clear();
}

function getPendingSourcedLowFrequencyCompanionEvent(
  eventId: LowFrequencyCompanionEventId
): SourcedLowFrequencyCompanionEvent | null {
  pruneExpiredSourcedLowFrequencyCompanionEvents();
  return pendingSourcedLowFrequencyCompanionEvents.find((event) => event.eventId === eventId) ?? null;
}

function getEffectiveLowFrequencyCompanionActionStateId(event: LowFrequencyCompanionEvent): PetActionStateId {
  return getPendingSourcedLowFrequencyCompanionEvent(event.eventId)?.actionStateId ?? event.actionStateId;
}

function getRuntimeLowFrequencyCompanionEventIds(): readonly LowFrequencyCompanionEventId[] {
  pruneExpiredSourcedLowFrequencyCompanionEvents();
  if (pendingSourcedLowFrequencyCompanionEvents.length > 0) {
    return pendingSourcedLowFrequencyCompanionEvents.map((event) => event.eventId);
  }

  return [
    ...BASE_RUNTIME_LOW_FREQUENCY_COMPANION_EVENT_IDS
  ];
}

function createProactiveSpeechBubblePayload(
  reason: ProactiveSpeechBubbleReason,
  options: { safeContextTag?: ProactiveSpeechBubbleSafeContextTag | undefined } = {}
): ProactiveSpeechBubblePayload {
  proactiveSpeechBubbleTick += 1;
  return {
    lineId: selectProactiveSpeechBubbleLineId({
      reason,
      presenceModeId: currentPresenceModeId,
      dialogueModeId: currentDialogueModeId,
      tick: proactiveSpeechBubbleTick,
      timeBand: getRuntimeProactiveSpeechBubbleTimeBand(),
      safeContextTag: options.safeContextTag
    }),
    reason,
    durationMs: DEFAULT_PROACTIVE_SPEECH_BUBBLE_DURATION_MS
  };
}

function getNextIdleProactiveSpeechBubbleDelayMs(): number | null {
  const cadenceIntervalMs = getProactiveCompanionIdleIntervalMs(
    currentProactiveCompanionSettings,
    PET_IDLE_PROACTIVE_SPEECH_BUBBLE_BASE_INTERVAL_MS,
    { acceptance: isAcceptanceTelemetryEnabled }
  );
  if (cadenceIntervalMs === null) {
    return null;
  }

  const visibleRemainingMs = Math.max(0, proactiveSpeechBubbleVisibleUntil - Date.now());
  return visibleRemainingMs + cadenceIntervalMs;
}

function getLowFrequencyCompanionEventElapsedMs(now: number): number | undefined {
  return lastLowFrequencyCompanionEventAt === null
    ? undefined
    : Math.max(0, now - lastLowFrequencyCompanionEventAt);
}

function selectRuntimeLowFrequencyCompanionEvent(now: number): {
  event: LowFrequencyCompanionEvent | null;
  elapsedSinceLastEventMs?: number | undefined;
  minimumIntervalMs?: number | undefined;
  skipReason?: string | undefined;
} {
  const elapsedSinceLastEventMs = getLowFrequencyCompanionEventElapsedMs(now);
  const input = {
    dialogueModeId: currentDialogueModeId,
    presenceModeId: currentPresenceModeId,
    tick: proactiveSpeechBubbleTick + 1,
    elapsedSinceLastEventMs,
    allowedEventIds: getRuntimeLowFrequencyCompanionEventIds()
  };
  const event = selectLowFrequencyCompanionEvent(input);

  if (event) {
    return {
      event,
      elapsedSinceLastEventMs,
      minimumIntervalMs: event.minimumIntervalMs
    };
  }

  const ungatedEvent = selectLowFrequencyCompanionEvent({
    ...input,
    elapsedSinceLastEventMs: undefined
  });
  if (!ungatedEvent) {
    return {
      event: null,
      elapsedSinceLastEventMs,
      skipReason: "not_selected"
    };
  }

  if (
    elapsedSinceLastEventMs !== undefined &&
    LOW_FREQUENCY_COMPANION_EVENT_ACCEPTANCE_MINIMUM_INTERVAL_MS !== null &&
    elapsedSinceLastEventMs >= LOW_FREQUENCY_COMPANION_EVENT_ACCEPTANCE_MINIMUM_INTERVAL_MS
  ) {
    return {
      event: ungatedEvent,
      elapsedSinceLastEventMs,
      minimumIntervalMs: LOW_FREQUENCY_COMPANION_EVENT_ACCEPTANCE_MINIMUM_INTERVAL_MS
    };
  }

  return {
    event: ungatedEvent,
    elapsedSinceLastEventMs,
    minimumIntervalMs: LOW_FREQUENCY_COMPANION_EVENT_ACCEPTANCE_MINIMUM_INTERVAL_MS ?? ungatedEvent.minimumIntervalMs,
    skipReason: "minimum_interval"
  };
}

function scheduleIdleProactiveSpeechBubble(): void {
  cancelIdleProactiveSpeechBubbleTimer();
  refreshProactiveBubbleRuntimeGates();
  if (isP283aAcceptanceInjectionOnly) return;
  proactiveBubbleCoordinator?.tick();

  if (currentPresenceModeId === "sleep" || currentProactiveCompanionSettings.cadence === "off") {
    return;
  }

  const nextDelayMs = getNextIdleProactiveSpeechBubbleDelayMs();
  if (nextDelayMs === null) {
    return;
  }

  idleProactiveSpeechBubbleTimer = setTimeout(() => {
    idleProactiveSpeechBubbleTimer = null;
    const now = Date.now();
    const selection = selectRuntimeLowFrequencyCompanionEvent(now);
    if (!selection.event || selection.skipReason) {
      logLowFrequencyCompanionEventDecision("skipped", selection.event, {
        skipReason: selection.skipReason,
        elapsedSinceLastEventMs: selection.elapsedSinceLastEventMs,
        minimumIntervalMs: selection.minimumIntervalMs
      });
      scheduleIdleProactiveSpeechBubble();
      return;
    }

    const payload = createProactiveSpeechBubblePayload(selection.event.bubbleReason, {
      safeContextTag: getLowFrequencyCompanionSafeContextTag(selection.event)
    });
    const actionStateId = getEffectiveLowFrequencyCompanionActionStateId(selection.event);
    proactiveBubbleCoordinator?.queuePresence(
      "idle_presence",
      payload,
      getPetActionStateTriggerReason(actionStateId)
    );
    lastLowFrequencyCompanionEventAt = now;
    lastLowFrequencyCompanionEventId = selection.event.eventId;
    clearQueuedSourcedLowFrequencyCompanionEvent(selection.event.eventId);
    logLowFrequencyCompanionEventDecision("queued", selection.event, {
      durationMs: payload.durationMs,
      elapsedSinceLastEventMs: selection.elapsedSinceLastEventMs,
      minimumIntervalMs: selection.minimumIntervalMs,
      actionStateId
    });
    scheduleIdleProactiveSpeechBubble();
  }, nextDelayMs);
}

function scheduleStartupProactiveSpeechBubbleIfNeeded(): void {
  if (isP283aAcceptanceInjectionOnly) {
    hasHandledStartupProactiveSpeechBubble = true;
    cancelStartupProactiveSpeechBubbleTimer();
    cancelIdleProactiveSpeechBubbleTimer();
    refreshProactiveBubbleRuntimeGates();
    return;
  }
  if (hasHandledStartupProactiveSpeechBubble) {
    scheduleIdleProactiveSpeechBubble();
    return;
  }

  cancelStartupProactiveSpeechBubbleTimer();
  startupProactiveSpeechBubbleTimer = setTimeout(() => {
    startupProactiveSpeechBubbleTimer = null;
    flushStartupProactiveSpeechBubbleCandidate();
  }, PET_STARTUP_PROACTIVE_SPEECH_BUBBLE_DELAY_MS);
  startupProactiveSpeechBubbleTimer.unref?.();
}

function flushStartupProactiveSpeechBubbleCandidate(): void {
  if (hasHandledStartupProactiveSpeechBubble || isP283aAcceptanceInjectionOnly) return;
  hasHandledStartupProactiveSpeechBubble = true;
  cancelStartupProactiveSpeechBubbleTimer();
  refreshProactiveBubbleRuntimeGates();
  proactiveBubbleCoordinator?.onFirstFrame();
  scheduleIdleProactiveSpeechBubble();
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
  chatReplySustainTrigger.clear();
}

function scheduleChatReplySustainTrigger(replyLength: number): void {
  chatReplySustainTrigger.observeReplyLength(replyLength);
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
    onOverlayRegionHitChanged: (isHit) => {
      logTelemetry("proactive_bubble_overlay_hit_changed", {
        overlayHitState: isHit ? "active" : "inactive",
        overlayHitAuthority: "main_poll"
      });
    },
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

function parsePetOverlayHitRegion(
  value: unknown,
  contentWidth: number,
  contentHeight: number
): PetOverlayHitRegion | null {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    !Number.isFinite(contentWidth) || !Number.isFinite(contentHeight) ||
    contentWidth <= 0 || contentHeight <= 0) {
    return null;
  }
  const region = value as Partial<PetOverlayHitRegion>;
  if (Object.keys(region).length !== 4 ||
    ![region.left, region.top, region.right, region.bottom].every((item) =>
      typeof item === "number" && Number.isFinite(item) && item >= 0) ||
    region.right! <= region.left! || region.bottom! <= region.top! ||
    region.right! > contentWidth || region.bottom! > contentHeight) {
    return null;
  }
  return {
    left: region.left!,
    top: region.top!,
    right: region.right!,
    bottom: region.bottom!
  };
}

function publishPetPresentation(intent: PetPresentationIntent): void {
  if (!petWindow || petWindow.isDestroyed()) {
    return;
  }

  petWindow.webContents.send("pet:apply-presentation", intent);
}

function withCurrentAccessorySelection(intent: PetPresentationIntent): PetPresentationIntent {
  const accessorySelection = resolvePetAccessorySelection({
    userAccessoryIds: currentPetPresentationPreferences.accessoryIds,
    modeLayer: getPetAccessoryModeLayer(currentDialogueModeId)
  });

  return {
    ...intent,
    accessorySelection
  };
}

function savePetAccessorySelection(accessoryIds: readonly PetAccessoryId[]): PetPresentationPreferences {
  if (!petPresentationStore) {
    throw new Error("Pet presentation store unavailable");
  }

  currentPetPresentationPreferences = {
    ...currentPetPresentationPreferences,
    accessoryIds: [...accessoryIds]
  };
  const preferences = petPresentationPersistence?.saveNow(currentPetPresentationPreferences)
    ?? petPresentationStore.savePreferences(currentPetPresentationPreferences);
  currentPetPresentationPreferences = preferences;
  currentPetPresentationIntent = withCurrentAccessorySelection(currentPetPresentationIntent);
  publishPetPresentation(currentPetPresentationIntent);
  return preferences;
}

function transitionPetRole(event: PetRoleEvent): boolean {
  const transition = reducePetRoleState(petRoleSnapshot, event);

  if (!transition.accepted) {
    return false;
  }

  petRoleSnapshot = transition.snapshot;
  currentPetPresentationIntent = withCurrentAccessorySelection(transition.intent);
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
    syncAutomaticPresenceLifecycle();
    refreshProactiveBubbleRuntimeGates();
    proactiveBubbleCoordinator?.tick();
    petActionRuntimePolicy.onCompanionTick({
      presenceModeId: currentPresenceModeId,
      timeBand: getRuntimeProactiveSpeechBubbleTimeBand()
    });

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

function toChatMemoryActivityAutoCapture(summary: AutoMemoryCaptureSummary): ChatMemoryActivityPayload["autoCapture"] {
  return {
    enabled: summary.enabled,
    skippedReason: summary.skippedReason,
    capturedCount: summary.capturedCount,
    keyCount: summary.keyCount,
    generalCount: summary.generalCount,
    mergedCount: summary.mergedCount,
    deduplicatedCount: summary.deduplicatedCount,
    compressionTriggered: summary.compressionTriggered,
    totalCards: summary.totalCards,
    injectionBudget: summary.injectionBudget
  };
}

function createFailedMemoryActivityAutoCapture(memoryStoreForRequest: MemoryStore): ChatMemoryActivityPayload["autoCapture"] {
  try {
    const summary = memoryStoreForRequest.getSummary();

    return {
      enabled: summary.enabled,
      skippedReason: summary.enabled ? "capture_failed" : "disabled",
      capturedCount: 0,
      keyCount: 0,
      generalCount: 0,
      mergedCount: 0,
      deduplicatedCount: 0,
      compressionTriggered: false,
      totalCards: summary.totalCards,
      injectionBudget: summary.injectionBudget
    };
  } catch {
    return {
      enabled: false,
      skippedReason: "capture_failed",
      capturedCount: 0,
      keyCount: 0,
      generalCount: 0,
      mergedCount: 0,
      deduplicatedCount: 0,
      compressionTriggered: false,
      totalCards: 0,
      injectionBudget: 0
    };
  }
}

function createChatMemoryActivityPayload(input: {
  requestVersion: number;
  autoCapture: ChatMemoryActivityPayload["autoCapture"];
  memoryInjectionCount: number;
  contextBudgetSummary: ChatContextBudgetSummary;
}): ChatMemoryActivityPayload {
  return {
    requestVersion: input.requestVersion,
    autoCapture: input.autoCapture,
    injection: {
      count: input.memoryInjectionCount
    },
    contextBudget: {
      compressed: input.contextBudgetSummary.compressed,
      summaryMessageCount: input.contextBudgetSummary.summaryMessageCount,
      summarizedMessageCount: input.contextBudgetSummary.summarizedMessageCount,
      recentMessageCount: input.contextBudgetSummary.recentMessageCount
    }
  };
}

function selectMainPetActionTriggerForMemorySafeChatReply(input: {
  providerId: ChatProviderId;
  autoCaptureSkippedReason: ChatMemoryActivityPayload["autoCapture"]["skippedReason"];
  memoryInjectionCount: number;
}): PetActionTriggerReason {
  if (input.autoCaptureSkippedReason === "sensitive" || input.autoCaptureSkippedReason === "capture_failed") {
    return "state_memory_skipped";
  }

  const replyWaitingReason = selectPetActionTriggerForChatReplyWaiting(input.providerId);
  if (replyWaitingReason === "state_local_model_busy") {
    return replyWaitingReason;
  }

  if (input.memoryInjectionCount > 0) {
    return "state_memory_injected";
  }

  return replyWaitingReason;
}

function createChatContextTransparencyPayload(input: {
  requestVersion: number;
  contextBudgetSummary: ChatContextBudgetSummary;
  memoryInjectionCount: number;
  webSearchIncluded: boolean;
  webSearchCitationCount: number;
}): ChatContextTransparencyPayload {
  return {
    requestVersion: input.requestVersion,
    contextBudget: {
      originalMessageCount: input.contextBudgetSummary.originalMessageCount,
      providerMessageCount: input.contextBudgetSummary.providerMessageCount,
      compressed: input.contextBudgetSummary.compressed,
      summaryMessageCount: input.contextBudgetSummary.summaryMessageCount,
      summarizedMessageCount: input.contextBudgetSummary.summarizedMessageCount,
      recentMessageCount: input.contextBudgetSummary.recentMessageCount
    },
    memory: {
      injectionCount: input.memoryInjectionCount
    },
    webSearch: {
      included: input.webSearchIncluded,
      citationCount: input.webSearchCitationCount
    }
  };
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
    return "当前不会调用外部模型：请先配置 API Key，或切换到可用的本地模型。";
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
    return "模型服务可达，但找不到当前模型；请在模型设置里确认模型名称，或等内置模型准备完成后重试。";
  }

  if (errorType === "incompatible_response") {
    return "服务响应不是兼容格式，请确认端点支持 OpenAI-compatible API。";
  }

  if (errorType === "network_error") {
    return "连接失败，请检查模型服务地址；若正在启动内置模型，准备完成后会自动切换。";
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
  desktopContextMonitor.setRendererReady(false);
  hasPetFirstFrame = false;
  petActionDispatchCoordinator?.reset();
  markProactiveSpeechBubbleHidden();
  proactiveBubbleCoordinator?.clear();

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
  if (process.env.P2_82A_1_GSMTC_PROTOTYPE === "1") {
    const {
      createGsmtcCapabilityPrototypeResult,
      isGsmtcCapabilityPrototypeTarget,
      runGsmtcCapabilityPrototype,
      writeGsmtcCapabilityPrototypeResult
    } = await import("./services/desktop-context/gsmtc-capability-prototype");
    const requestedTarget = process.env.P2_82A_1_TARGET;
    const target = isGsmtcCapabilityPrototypeTarget(requestedTarget) ? requestedTarget : "dev";
    const prototypeSettings = createEnvironmentActionSettingsStore({
      userDataPath: app.getPath("userData")
    }).getSettings();
    const result = isGsmtcCapabilityPrototypeTarget(requestedTarget)
      ? await runGsmtcCapabilityPrototype({
        target,
        musicEnabled: prototypeSettings.musicEnabled
      })
      : createGsmtcCapabilityPrototypeResult(target, {
        capability: "unknown",
        status: "unknown",
        health: "error",
        failureCode: "invalid-output"
      });
    writeGsmtcCapabilityPrototypeResult(process.cwd(), result);
    app.exit(result.health === "ready" || result.health === "stopped" ? 0 : 2);
    return;
  }

  telemetry = createTelemetryService();
  providerConfigStore = createProviderConfigStore({ logTelemetry });
  petPresentationStore = createPetPresentationStore();
  currentPetPresentationPreferences = petPresentationStore.getPreferences();
  currentPetPresentationIntent = withCurrentAccessorySelection(currentPetPresentationIntent);
  petPresentationPersistence = createPetPresentationPersistence(petPresentationStore);
  historyStore = createHistoryStore();
  memoryStore = createMemoryStore();
  webSearchSettingsStore = createWebSearchSettingsStore({
    userDataPath: app.getPath("userData")
  });
  currentDialogueModeId = "default";
  petActionRuntimePolicy.syncDialogueMode(currentDialogueModeId);
  currentPetPresentationIntent = withCurrentAccessorySelection(currentPetPresentationIntent);
  currentPresenceModeId = "default";
  petActionRuntimePolicy.syncPresenceMode(currentPresenceModeId);
  proactiveCompanionSettingsStore = createProactiveCompanionSettingsStore();
  currentProactiveCompanionSettings = proactiveCompanionSettingsStore.getSettings();
  if (p283aAcceptanceScenario === "quiet" || p283aAcceptanceScenario === "off") {
    currentProactiveCompanionSettings = {
      ...currentProactiveCompanionSettings,
      cadence: p283aAcceptanceScenario
    };
  }
  proactiveBubbleLedgerStore = createProactiveBubbleLedgerStore({
    userDataPath: app.getPath("userData")
  });
  proactiveBubbleCoordinator = createProactiveBubbleCoordinator({
    acceptanceInjectionOnly: isP283aAcceptanceInjectionOnly,
    ledger: proactiveBubbleLedgerStore,
    getRuntimeGates: getProactiveBubbleRuntimeGates,
    requestAction: requestPetActionTrigger,
    showBubble(payload) {
      if (!petWindow || petWindow.isDestroyed()) {
        return false;
      }
      petWindow.webContents.send("pet:proactive-speech-bubble", payload);
      proactiveSpeechBubbleVisibleUntil = Date.now() + payload.durationMs;
      logProactiveSpeechBubbleDecision("shown", payload);
      return true;
    },
    clearBubble() {
      proactiveSpeechBubbleVisibleUntil = 0;
      if (petWindow && !petWindow.isDestroyed()) {
        petWindow.webContents.send("pet:clear-proactive-speech-bubble");
      }
    },
    openChat() {
      openChatWindow();
    },
    reportDecision(decision) {
      logTelemetry("proactive_bubble_candidate", {
        candidateId: decision.candidateId,
        status: decision.state,
        lineId: decision.lineId,
        reason: decision.reason,
        skipReason: decision.skipReason
      });
    }
  });
  proactiveBubbleCoordinator.updateSettings(currentProactiveCompanionSettings);
  environmentActionSettingsStore = createEnvironmentActionSettingsStore();
  currentEnvironmentActionSettings = environmentActionSettingsStore.getSettings();
  automaticSituationCoordinator = createAutomaticSituationCoordinator({
    classifier: createBundledLocalSituationClassifier({
      getTarget() {
        const config = bundledLlamaCppProviderConfig;
        if (!config || config.localPresetId !== "embedded-llama-cpp") {
          return null;
        }
        return {
          baseURL: config.baseURL,
          model: config.model,
          localPresetId: "embedded-llama-cpp"
        };
      }
    })
  });
  removeAutomaticSituationListener = automaticSituationCoordinator.subscribe(applyAutomaticSituationSnapshot);
  coarseUserStateCoordinator = createCoarseUserStateCoordinator({
    explicitGameContextEnabled: currentEnvironmentActionSettings.explicitGameContextEnabled
  });
  removeCoarseUserStateListener = coarseUserStateCoordinator.subscribe((state) => {
    automaticSituationCoordinator?.updateExplicitGameContext(state.explicitGameContext === "active");
    proactiveBubbleCoordinator?.updateCoarseState(isP245AcceptanceSafeActive
      ? {
          activity: "active",
          interruptibility: "allowed",
          media: state.media,
          timeBand: state.timeBand,
          explicitGameContext: state.explicitGameContext,
          engagement: "allowed"
        }
      : state);
  });
  removeDesktopContextSnapshotListener = desktopContextMonitor.subscribe((snapshot) => {
    coarseUserStateCoordinator?.updateEnvironment(snapshot);
  });
  coarseUserStateCoordinator.updateEnvironment(desktopContextMonitor.getSnapshot());
  const initialCoarseState = coarseUserStateCoordinator.getState();
  proactiveBubbleCoordinator.updateCoarseState(isP245AcceptanceSafeActive
    ? {
        activity: "active",
        interruptibility: "allowed",
        media: initialCoarseState.media,
        timeBand: initialCoarseState.timeBand,
        explicitGameContext: initialCoarseState.explicitGameContext,
        engagement: "allowed"
      }
    : initialCoarseState);
  syncAutomaticPresenceLifecycle();
  petActionRuntimePolicy.syncEveningDateKey(environmentActionSettingsStore.getEveningDateKey());
  desktopContextMonitor.updateSettings(currentEnvironmentActionSettings);
  powerMonitor.on("lock-screen", handleSystemLock);
  powerMonitor.on("unlock-screen", handleSystemUnlock);
  powerMonitor.on("suspend", handleSystemSuspend);
  powerMonitor.on("resume", handleSystemResume);
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
  startBundledLlamaCppRuntimeIfAvailable({
    refreshProvider() {
      refreshCurrentProvider?.();
    }
  });
  startLlamaCppRuntimeIfEnabled({
    refreshProvider() {
      refreshCurrentProvider?.();
    }
  });

  ensurePetWindow("startup");
  chatWindow = createChatWindow({
    shouldClose: () => shutdownCoordinator.isQuiescing()
  });
  setTimeout(warmUpWebSearchMcpConnection, 1_500);
  function handleChatWindowInactive(): void {
    isChatInteractionActive = false;
    if (activeChatRequestVersion !== null) {
      chatEngine?.abortActiveStream();
      transitionPetRole({ type: "request:cancelled", requestVersion: activeChatRequestVersion });
      activeChatRequestVersion = null;
      clearChatReplySustainTimer();
      settleInterruptedRole();
    }
    syncAutomaticPresenceLifecycle();
    transitionPetRole({ type: "chat:closed" });
    if (petWindow) {
      restorePetWindowOnTop(petWindow);
      logWindowSnapshot("chat_hidden_pet_restored");
    }
    scheduleIdleProactiveSpeechBubble();
  }

  function attachChatWindowLifecycle(window: BrowserWindow): void {
    window.on("hide", handleChatWindowInactive);
    window.on("closed", () => {
      handleChatWindowInactive();
      if (chatWindow === window) {
        chatWindow = null;
      }
    });
  }

  attachChatWindowLifecycle(chatWindow);
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
    const wasVisible = Boolean(
      chatWindow && !chatWindow.isDestroyed() && chatWindow.isVisible()
    );
    if (!chatWindow) {
      chatWindow = createChatWindow({
        shouldClose: () => shutdownCoordinator.isQuiescing()
      });
      attachChatWindowLifecycle(chatWindow);
    }

    cancelStartupProactiveSpeechBubbleTimer();
    cancelIdleProactiveSpeechBubbleTimer();
    markProactiveSpeechBubbleHidden();
    proactiveBubbleCoordinator?.clear();
    if (!wasVisible) {
      petActionDispatchCoordinator?.reset();
      refreshProactiveBubbleRuntimeGates();
    }
    showChatWindow(chatWindow);
    focusChatInput(chatWindow);
    if (!wasVisible) {
      delete lastPetActionTriggerAtByReason.chat_opened;
      transitionPetRole({ type: "chat:opened" });
      sendPetActionTrigger("chat_opened", { supersessionPolicy: "replace_active" });
      logWindowSnapshot("chat_opened");
    }
  }

  openChatWindowAdapter = openChatWindow;
  if (pendingChatWindowOpen) {
    pendingChatWindowOpen = false;
    openChatWindowAdapter();
  }

  function isPetSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    return isTrustedIpcSender(event, petWindow, "pet", join(__dirname, "../renderer"));
  }

  function isChatSender(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
    return isTrustedIpcSender(event, chatWindow, "chat", join(__dirname, "../renderer"));
  }

  function getCurrentProviderConfig(): ProviderConfig {
    const savedConfig = providerConfigStore?.hasConfig()
      ? providerConfigStore.getConfig()
      : null;

    if (savedConfig && !isDefaultEmbeddedLlamaCppConfig(savedConfig)) {
      return savedConfig;
    }

    if (envProviderConfig) {
      logTelemetry(
        "provider_config_loaded",
        createProviderTelemetryPayload(envProviderConfig.providerConfig, "env")
      );
      return envProviderConfig.providerConfig;
    }

    if (bundledLlamaCppProviderConfig) {
      return bundledLlamaCppProviderConfig;
    }

    if (managedLlamaCppProviderConfig) {
      return managedLlamaCppProviderConfig;
    }

    return savedConfig ?? providerConfigStore?.getConfig() ?? DEFAULT_PROVIDER_CONFIG;
  }

  function getRuntimeProviderConfig(): ProviderConfig {
    const config = getCurrentProviderConfig();

    if (isDefaultEmbeddedLlamaCppConfig(config)) {
      return STARTUP_LOCAL_FALLBACK_PROVIDER_CONFIG;
    }

    return config;
  }

  function isStartupLocalFallbackConfig(config: ProviderConfig): boolean {
    return config.providerId === "fake" &&
      config.displayName === STARTUP_LOCAL_FALLBACK_PROVIDER_CONFIG.displayName;
  }

  async function waitForStartupLocalModelProviderIfPending(): Promise<void> {
    const startup = bundledLlamaCppRuntimeStartupPromise;

    if (!startup || !isStartupLocalFallbackConfig(getRuntimeProviderConfig())) {
      return;
    }

    const startedAt = Date.now();
    logTelemetry("bundled_llama_cpp_chat_wait_started", {
      providerId: "local-openai-compatible",
      localPresetId: "embedded-llama-cpp"
    });

    try {
      await startup;
    } finally {
      refreshCurrentProvider?.();
      logTelemetry("bundled_llama_cpp_chat_wait_completed", {
        providerId: chatEngine?.getProviderId() ?? "unknown",
        localPresetId: "embedded-llama-cpp",
        runtimeStatus: latestBundledLlamaCppRuntimeSummary?.status ?? "unknown",
        durationMs: Date.now() - startedAt
      });
    }
  }

  function isDefaultEmbeddedLlamaCppConfig(config: ProviderConfig): boolean {
    return config.providerId === "local-openai-compatible" &&
      config.localPresetId === "embedded-llama-cpp" &&
      config.baseURL === DEFAULT_PROVIDER_CONFIG.baseURL &&
      config.model === DEFAULT_PROVIDER_CONFIG.model;
  }

  function getCurrentProviderStatus(): ProviderStatus {
    const config = getRuntimeProviderConfig();

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
      config: getRuntimeProviderConfig(),
      getApiKey,
      logTelemetry
    });
  }

  function warmUpWebSearchMcpConnection(): void {
    const providerConfig = getRuntimeProviderConfig();
    if (providerConfig.providerId === "fake" && !isStartupLocalFallbackConfig(providerConfig)) {
      logTelemetry("web_search_startup_connection_skipped", {
        reason: "fake_provider",
        enabled: webSearchSettingsStore?.getSettings().enabled === true
      });
      return;
    }

    const settings = webSearchSettingsStore?.getSettings();
    if (!settings?.enabled || !settings.command) {
      return;
    }

    void testMcpSearchConnection(settings).then((result) => {
      logTelemetry("web_search_startup_connection_tested", {
        enabled: result.enabled,
        commandConfigured: result.commandConfigured,
        status: result.status,
        toolName: result.toolName,
        toolFound: result.toolFound,
        toolCount: result.toolCount
      });
    }).catch(() => {
      logTelemetry("web_search_startup_connection_tested", {
        enabled: settings.enabled,
        commandConfigured: Boolean(settings.command),
        status: "failed",
        toolName: settings.toolName,
        toolFound: false,
        toolCount: 0
      });
    });
  }

  type WebSearchResolution = {
    context?: WebSearchContext;
    status: "allowed" | "blocked" | "redacted" | "failed";
    reasonCodes: WebSearchReasonCode[];
    resultCount: number;
    errorType?: WebSearchErrorType;
  };

  async function resolveWebSearchForLatestMessage(latestUserMessage: string): Promise<WebSearchResolution> {
    const settings = webSearchSettingsStore?.getSettings();
    const decision = createSearchPrivacyDecision({
      text: latestUserMessage,
      enabled: settings?.enabled === true
    });

    if (!settings || decision.status === "blocked") {
      logTelemetry("web_search_blocked", {
        enabled: settings?.enabled === true,
        commandConfigured: Boolean(settings?.command),
        status: decision.status,
        reasonCodes: decision.reasonCodes
      });
      return {
        status: decision.status,
        reasonCodes: decision.reasonCodes,
        resultCount: 0
      };
    }

    const startedAt = Date.now();
    logTelemetry("web_search_started", {
      status: decision.status,
      reasonCodes: decision.reasonCodes,
      toolName: settings.toolName,
      commandConfigured: Boolean(settings.command),
      maxResults: settings.maxResults
    });

    try {
      const provider = createMcpSearchProvider(settings);
      const results = await provider.search({
        query: decision.safeQuery,
        maxResults: settings.maxResults
      });
      logTelemetry("web_search_completed", {
        status: decision.status,
        reasonCodes: decision.reasonCodes,
        toolName: settings.toolName,
        resultCount: results.length,
        durationMs: Date.now() - startedAt
      });

      return {
        ...(results.length > 0
          ? {
              context: createWebSearchContext({
                query: decision.safeQuery,
                results,
                toolName: settings.toolName
              })
            }
          : {}),
        status: decision.status,
        reasonCodes: decision.reasonCodes,
        resultCount: results.length
      };
    } catch (error: unknown) {
      const errorType = getWebSearchErrorType(error);
      logTelemetry("web_search_failed", {
        status: decision.status,
        reasonCodes: decision.reasonCodes,
        toolName: settings.toolName,
        resultCount: 0,
        durationMs: Date.now() - startedAt,
        errorType
      });

      return {
        status: "failed",
        reasonCodes: decision.reasonCodes,
        resultCount: 0,
        errorType
      };
    }
  }

  function getWebSearchErrorType(error: unknown): WebSearchErrorType {
    const name = error instanceof Error ? error.name : "mcp_search_failed";
    const supportedErrorTypes: readonly WebSearchErrorType[] = [
      "mcp_search_not_configured",
      "mcp_search_spawn_failed",
      "mcp_search_closed",
      "mcp_search_failed",
      "mcp_search_not_started",
      "mcp_search_timeout",
      "mcp_search_write_failed",
      BAIDU_SEARCH_VERIFICATION_REQUIRED_ERROR,
      "mcp_search_tool_failed",
      "mcp_search_tool_missing"
    ];

    return supportedErrorTypes.includes(name as WebSearchErrorType)
      ? name as WebSearchErrorType
      : "mcp_search_failed";
  }

  function notifyChatProactiveCompanionSettingsChanged(settings: ProactiveCompanionSettings): void {
    if (!chatWindow || chatWindow.isDestroyed()) {
      return;
    }

    chatWindow.webContents.send("proactiveCompanion:changed", settings);
  }

  function applyProactiveCompanionSettings(update: unknown): ProactiveCompanionSettings {
    if (!proactiveCompanionSettingsStore) {
      throw new Error("Proactive companion settings store unavailable");
    }

    currentProactiveCompanionSettings = proactiveCompanionSettingsStore.saveSettings(update);
    syncAutomaticPresenceLifecycle();
    proactiveBubbleCoordinator?.updateSettings(currentProactiveCompanionSettings);

    if (currentProactiveCompanionSettings.cadence === "off") {
      cancelStartupProactiveSpeechBubbleTimer();
      cancelIdleProactiveSpeechBubbleTimer();
      clearPetProactiveSpeechBubble();
    } else {
      scheduleIdleProactiveSpeechBubble();
    }

    logTelemetry("proactive_companion_settings_changed", {
      cadence: currentProactiveCompanionSettings.cadence,
      memorySourceBubbles: currentProactiveCompanionSettings.memorySourceBubbles,
      searchSourceBubbles: currentProactiveCompanionSettings.searchSourceBubbles
    });
    notifyChatProactiveCompanionSettingsChanged(currentProactiveCompanionSettings);
    return currentProactiveCompanionSettings;
  }

  ipcMain.handle("pet:open-chat", (event) => {
    if (!isPetSender(event)) {
      return;
    }

    openChatWindow();
  });

  ipcMain.handle("pet:activate-proactive-speech-bubble", (event, value: unknown) => {
    if (!isPetSender(event)) {
      return false;
    }
    return proactiveBubbleCoordinator?.activateBubble(value) ?? false;
  });

  ipcMain.handle("pet:p2-83a-inject-candidate", (event, candidateId: unknown) => {
    if (
      !isAcceptanceTelemetryEnabled ||
      process.env.AI_DESKTOP_PET_P2_83A_SAFE_INJECTION !== "1" ||
      !isPetSender(event) ||
      !PROACTIVE_BUBBLE_CANDIDATE_IDS.includes(candidateId as never)
    ) {
      return false;
    }
    proactiveBubbleCoordinator?.queueSafeCandidateForAcceptance(candidateId as never);
    return true;
  });

  ipcMain.handle("pet:p2-83a-native-window-handle", (event) => {
    if (
      process.platform !== "win32" ||
      !isAcceptanceTelemetryEnabled ||
      process.env.AI_DESKTOP_PET_P2_83A_SAFE_INJECTION !== "1" ||
      !isPetSender(event) ||
      !petWindow ||
      petWindow.isDestroyed()
    ) {
      return null;
    }
    const handle = petWindow.getNativeWindowHandle();
    return handle.length >= 8
      ? handle.readBigUInt64LE(0).toString(10)
      : String(handle.readUInt32LE(0));
  });

  ipcMain.on("pet:pointer-hit-change", (event, state: PetPointerHitState) => {
    if (!isPetSender(event) || typeof state?.isHit !== "boolean") {
      return;
    }

    pointerController?.setPointerHit(state.isHit);
  });

  ipcMain.on("pet:bubble-pointer-hit-change", (event, state: PetPointerHitState) => {
    if (!isPetSender(event) || typeof state?.isHit !== "boolean") {
      return;
    }
    pointerController?.setOverlayHit(state.isHit);
  });

  ipcMain.on("pet:bubble-hit-region-change", (event, value: unknown) => {
    if (!isPetSender(event) || !petWindow || petWindow.isDestroyed()) {
      return;
    }
    if (value === null) {
      pointerController?.setOverlayHitRegion(null);
      logTelemetry("proactive_bubble_overlay_region_changed", {
        regionState: "cleared",
        authority: "main"
      });
      return;
    }
    const [contentWidth = 0, contentHeight = 0] = petWindow.getContentSize();
    const region = parsePetOverlayHitRegion(value, contentWidth, contentHeight);
    pointerController?.setOverlayHitRegion(region);
    logTelemetry("proactive_bubble_overlay_region_changed", {
      regionState: region ? "registered" : "rejected",
      authority: "main"
    });
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
    hasPetFirstFrame = true;
    refreshProactiveBubbleRuntimeGates();
    scheduleInitialEdgeGlanceIfNeeded();
    scheduleStartupProactiveSpeechBubbleIfNeeded();
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
    const actionReason = petTelemetryEvent.payload?.reason;
    const requestId = petTelemetryEvent.payload?.requestId;
    const actionInstanceId = petTelemetryEvent.payload?.actionInstanceId;
    if (
      petTelemetryEvent.type === "pet_interaction_action_started" ||
      petTelemetryEvent.type === "pet_interaction_action_skipped" ||
      petTelemetryEvent.type === "pet_interaction_action_finished"
    ) {
      const lifecycleStatus = petTelemetryEvent.type === "pet_interaction_action_started"
        ? "started"
        : petTelemetryEvent.type === "pet_interaction_action_skipped"
          ? "skipped"
          : "finished";
      const lifecycleRequestId = typeof requestId === "string" ? requestId : undefined;
      const lifecycleActionInstanceId = typeof actionInstanceId === "string" ? actionInstanceId : undefined;
      const lifecycleResult = typeof actionReason === "string"
        ? petActionDispatchCoordinator?.onLifecycle(
          {
            status: lifecycleStatus,
            reason: actionReason,
            ...(lifecycleRequestId ? { requestId: lifecycleRequestId } : {}),
            ...(lifecycleActionInstanceId ? { actionInstanceId: lifecycleActionInstanceId } : {})
          }
        ) ?? "ignored"
        : "ignored";
      if (isPetActionTriggerReason(actionReason)) {
        if (lifecycleResult === "main_started") {
          proactiveBubbleCoordinator?.onActionLifecycle(
            lifecycleRequestId === undefined
              ? { status: "started", reason: actionReason }
              : { status: "started", reason: actionReason, requestId: lifecycleRequestId }
          );
        } else if (lifecycleResult === "main_terminal") {
          if (petTelemetryEvent.type === "pet_interaction_action_skipped") {
            proactiveBubbleCoordinator?.onActionLifecycle(
              lifecycleRequestId === undefined
                ? { status: "skipped", reason: actionReason }
                : { status: "skipped", reason: actionReason, requestId: lifecycleRequestId }
            );
          }
        }
      }
      refreshProactiveBubbleRuntimeGates();
    }
    if (
      petTelemetryEvent.payload?.reason === "startup_first_visible_frame" &&
      (petTelemetryEvent.type === "pet_interaction_action_finished" ||
        petTelemetryEvent.type === "pet_interaction_action_skipped")
    ) {
      cancelStartupProactiveSpeechBubbleTimer();
      startupProactiveSpeechBubbleTimer = setTimeout(() => {
        startupProactiveSpeechBubbleTimer = null;
        flushStartupProactiveSpeechBubbleCandidate();
      }, PET_ACTION_TRIGGER_THROTTLE_MS + 150);
      startupProactiveSpeechBubbleTimer.unref?.();
    }
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
        syncAutomaticPresenceLifecycle();
      }
    } else if (petTelemetryEvent.type === "recovery_succeeded") {
      transitionPetRole({ type: "renderer:recovered" });
    }
  });

  ipcMain.on("pet:presentation-ready", (event) => {
    if (isPetSender(event)) {
      desktopContextMonitor.setRendererReady(true);
      publishPetPresentation(currentPetPresentationIntent);
      publishScaleWheelModifier();
      const snapshot = automaticSituationCoordinator?.getSnapshot();
      if (snapshot && petWindow && !petWindow.isDestroyed()) {
        petWindow.webContents.send("automaticSituation:changed", snapshot);
      }
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
    syncAutomaticPresenceLifecycle();
    transitionPetRole({ type: "chat:interaction", active: isActive });
    if (isActive) {
      cancelStartupProactiveSpeechBubbleTimer();
      cancelIdleProactiveSpeechBubbleTimer();
      sendPetActionTrigger("chat_input_focus");
    } else {
      scheduleIdleProactiveSpeechBubble();
    }
    refreshProactiveBubbleRuntimeGates();
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
    void handleChatSend(event, request);
  });

  async function handleChatSend(event: IpcMainEvent, request: unknown): Promise<void> {
    if (!isChatSender(event) || !isChatSendRequest(request) || !chatEngine || !historyStore || !memoryStore) {
      return;
    }

    automaticSituationCoordinator?.cancelPendingClassification();
    await waitForStartupLocalModelProviderIfPending();

    if (!chatEngine || !historyStore || !memoryStore) {
      return;
    }

    const chatEngineForRequest = chatEngine;
    const historyStoreForRequest = historyStore;
    const memoryStoreForRequest = memoryStore;
    const providerId = chatEngineForRequest.getProviderId();
    const startedAt = Date.now();
    let replyLength = 0;

    if (chatEngineForRequest.hasActiveStream()) {
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

    const submittedMessage = request.messages.at(-1);
    if (!submittedMessage || !transitionPetRole({ type: "request:started", requestVersion: request.requestVersion })) {
      return;
    }

    proactiveBubbleCoordinator?.onUserMessage();
    coarseUserStateCoordinator?.handleUserMessage(submittedMessage.content);
    refreshProactiveBubbleRuntimeGates();
    activeChatRequestVersion = request.requestVersion;
    syncAutomaticPresenceLifecycle();
    clearChatReplySustainTimer();
    let autoMemoryCaptureForActivity: ChatMemoryActivityPayload["autoCapture"] =
      createFailedMemoryActivityAutoCapture(memoryStoreForRequest);

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
        syncAutomaticPresenceLifecycle();
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
        autoMemoryCaptureForActivity = toChatMemoryActivityAutoCapture(autoMemoryCapture);
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
        autoMemoryCaptureForActivity = createFailedMemoryActivityAutoCapture(memoryStoreForRequest);
        logTelemetry("memory_auto_capture_failed", {
          conversationId: request.conversationId,
          errorType: "failed"
        });
      }
    } catch {
      transitionPetRole({ type: "request:failed", requestVersion: request.requestVersion });
      activeChatRequestVersion = null;
      syncAutomaticPresenceLifecycle();
      event.sender.send("chat:stream-error", {
        requestVersion: request.requestVersion,
        message: "无法保存本地消息，请稍后重试。",
        errorType: "failed"
      });
      return;
    }

    const memoryContext = memoryStoreForRequest.createInjection();
    const memorySafePulseActionStateId = selectMemorySafePulseActionStateId({
      autoCaptureSkippedReason: autoMemoryCaptureForActivity.skippedReason,
      memoryInjectionCount: memoryContext.count,
      capturedCount: autoMemoryCaptureForActivity.capturedCount,
      mergedCount: autoMemoryCaptureForActivity.mergedCount,
      deduplicatedCount: autoMemoryCaptureForActivity.deduplicatedCount,
      compressionTriggered: autoMemoryCaptureForActivity.compressionTriggered
    });
    if (memorySafePulseActionStateId) {
      queueSourcedLowFrequencyCompanionEvent("memory-safe-pulse", {
        actionStateId: memorySafePulseActionStateId
      });
    } else {
      sendPetActionTrigger(selectMainPetActionTriggerForMemorySafeChatReply({
        providerId,
        autoCaptureSkippedReason: autoMemoryCaptureForActivity.skippedReason,
        memoryInjectionCount: memoryContext.count
      }));
    }
    const situationSnapshotForRequest = automaticSituationCoordinator?.getSnapshot() ?? {
      conversationContextId: "default" as const,
      conversationSource: "default" as const,
      presenceStateId: "default" as const,
      presenceSource: "default" as const,
      confidence: null,
      revision: 0,
      updatedAtMs: Date.now(),
      expiresAtMs: null
    };
    const userProfileContext = createUserProfilePromptContext(userProfileStore?.getProfile() ?? null);
    const runtimeContext = createChatRuntimeContext();
    const contextBudget = budgetChatContext(request.messages);
    if (
      contextBudget.summary.compressed &&
      contextBudget.summary.summaryMessageCount > 0 &&
      contextBudget.summary.summarizedMessageCount > 0
    ) {
      queueSourcedLowFrequencyCompanionEvent("history-summary-pulse", {
        actionStateId: "proactive-bubble-visible"
      });
    }

    void resolveWebSearchForLatestMessage(submittedMessage.content).then((webSearchResolution) => {
      const dialogueStyleContext = {
        modeId: situationSnapshotForRequest.conversationContextId,
        styleId: "gentle-desktop-companion-v1" as const
      };
      logTelemetry("automatic_situation_snapshot_used", {
        requestVersion: request.requestVersion,
        conversationContextId: situationSnapshotForRequest.conversationContextId,
        conversationSource: situationSnapshotForRequest.conversationSource,
        presenceStateId: situationSnapshotForRequest.presenceStateId,
        presenceSource: situationSnapshotForRequest.presenceSource
      });
      const webSearchCitation = createWebSearchCitationPayload(webSearchResolution.context);
      const webSearchCitationCount = webSearchCitation?.citations.length ?? 0;
      if (webSearchCitationCount > 0) {
        queueSourcedLowFrequencyCompanionEvent("search-citation-pulse", {
          actionStateId: "search-cited"
        });
      }

      event.sender.send("chat:context-transparency", createChatContextTransparencyPayload({
        requestVersion: request.requestVersion,
        contextBudgetSummary: contextBudget.summary,
        memoryInjectionCount: memoryContext.count,
        webSearchIncluded: Boolean(webSearchResolution.context?.results.length),
        webSearchCitationCount
      }));
      event.sender.send("chat:memory-injection", {
        requestVersion: request.requestVersion,
        count: memoryContext.count
      });
      event.sender.send("chat:memory-activity", createChatMemoryActivityPayload({
        requestVersion: request.requestVersion,
        autoCapture: autoMemoryCaptureForActivity,
        memoryInjectionCount: memoryContext.count,
        contextBudgetSummary: contextBudget.summary
      }));

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
        memoryInjectionCount: memoryContext.count,
        webSearchStatus: webSearchResolution.status,
        webSearchReasonCodes: webSearchResolution.reasonCodes,
        webSearchResultCount: webSearchResolution.resultCount,
        ...(webSearchResolution.errorType ? { webSearchErrorType: webSearchResolution.errorType } : {})
      });

      const webSearchFailurePrompt = getWebSearchFailurePrompt(webSearchResolution.errorType);
      const providerRequest: ChatRequest = {
        requestVersion: request.requestVersion,
        conversationId: request.conversationId,
        messages: request.messages,
        providerMessages: [
          ...contextBudget.providerMessages,
          ...(webSearchFailurePrompt
            ? [{ role: "system" as const, content: webSearchFailurePrompt }]
            : [])
        ],
        contextBudget: contextBudget.summary,
        memoryContext,
        dialogueStyleContext,
        runtimeContext,
        ...(webSearchResolution.context ? { webSearchContext: webSearchResolution.context } : {}),
        ...(webSearchResolution.errorType ? { webSearchErrorType: webSearchResolution.errorType } : {}),
        ...(userProfileContext ? { userProfileContext } : {})
      };

      return chatEngineForRequest.startChatStream(providerRequest, {
        onDelta(delta) {
          if (!transitionPetRole({ type: "reply:delta", requestVersion: request.requestVersion })) {
            return;
          }

          replyLength += delta.text.length;
          scheduleChatReplySustainTrigger(replyLength);
          event.sender.send("chat:stream-delta", { ...delta, requestVersion: request.requestVersion });
        }
      }).then((result) => ({ result, webSearchCitation }));
    }).then(({ result, webSearchCitation }: {
      result: Awaited<ReturnType<ChatEngine["startChatStream"]>>;
      webSearchCitation: WebSearchCitationPayload | null;
    }) => {
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
          syncAutomaticPresenceLifecycle();
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
        syncAutomaticPresenceLifecycle();
        clearChatReplySustainTimer();
      }
      if (!accepted) {
        return;
      }

      if (shouldTriggerReplyWarmSettle({
        completed: true,
        hasSearchCitation: Boolean(webSearchCitation?.citations.length),
        intensity: result.intensity
      })) {
        sendPetActionTrigger("chat_reply_completed");
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
      event.sender.send("chat:stream-done", {
        ...result,
        requestVersion: request.requestVersion,
        ...(webSearchCitation ? { webSearchCitation } : {})
      });
      void automaticSituationCoordinator?.classifyLatest({
        messageId: submittedMessage.id,
        text: submittedMessage.content
      }).then((classification) => {
        logTelemetry("automatic_situation_classified", {
          requestVersion: request.requestVersion,
          accepted: classification.accepted,
          result: classification.reason,
          conversationContextId: classification.snapshot.conversationContextId,
          conversationSource: classification.snapshot.conversationSource,
          presenceStateId: classification.snapshot.presenceStateId,
          presenceSource: classification.snapshot.presenceSource,
          confidence: classification.snapshot.confidence
        });
      });
    }).catch((error: unknown) => {
      const errorType = getChatErrorType(error);
      const eventType = errorType === "aborted" ? "chat_stream_aborted" : "chat_stream_failed";
      const accepted = transitionPetRole({
        type: errorType === "aborted" ? "request:cancelled" : "request:failed",
        requestVersion: request.requestVersion
      });
      if (activeChatRequestVersion === request.requestVersion) {
        activeChatRequestVersion = null;
        syncAutomaticPresenceLifecycle();
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
  }

  ipcMain.on("chat:abort", (event) => {
    if (!isChatSender(event) || !chatEngine) {
      return;
    }

    if (chatEngine.abortActiveStream() && activeChatRequestVersion !== null) {
      transitionPetRole({ type: "request:cancelled", requestVersion: activeChatRequestVersion });
      activeChatRequestVersion = null;
      syncAutomaticPresenceLifecycle();
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

  ipcMain.handle("webSearch:get-settings", (event) => {
    if (!isChatSender(event) || !webSearchSettingsStore) {
      throw new Error("Unauthorized web search request");
    }

    return webSearchSettingsStore.getSettings();
  });

  ipcMain.handle("webSearch:get-status", (event) => {
    if (!isChatSender(event) || !webSearchSettingsStore) {
      throw new Error("Unauthorized web search request");
    }

    return webSearchSettingsStore.getStatus();
  });

  ipcMain.handle("webSearch:test-connection", async (event, update: unknown) => {
    if (!isChatSender(event) || !webSearchSettingsStore) {
      throw new Error("Unauthorized web search request");
    }

    const settings = update === undefined
      ? webSearchSettingsStore.getSettings()
      : normalizeWebSearchSettings(update);
    const result = await testMcpSearchConnection(settings);
    logTelemetry("web_search_connection_tested", {
      enabled: result.enabled,
      commandConfigured: result.commandConfigured,
      status: result.status,
      toolName: result.toolName,
      toolFound: result.toolFound,
      toolCount: result.toolCount
    });
    return result;
  });

  ipcMain.handle("webSearch:set-settings", (event, update: unknown) => {
    if (!isChatSender(event) || !webSearchSettingsStore) {
      throw new Error("Unauthorized web search request");
    }

    const settings = webSearchSettingsStore.saveSettings(update);
    logTelemetry("web_search_settings_updated", {
      enabled: settings.enabled,
      commandConfigured: Boolean(settings.command),
      argsCount: settings.args.length,
      toolName: settings.toolName,
      timeoutMs: settings.timeoutMs,
      maxResults: settings.maxResults
    });
    return settings;
  });

  ipcMain.handle("localRuntime:diagnose-local-model", async (event) => {
    if (!isChatSender(event)) {
      throw new Error("Unauthorized local runtime request");
    }

    try {
      const parsedSummary = parseLocalModelDiagnosticSafeSummary(await diagnoseLocalRuntimes({
        bundledLlamaCpp: getBundledLlamaCppDiagnosticConfig(),
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

  ipcMain.handle("memory:get-summary", (event) => {
    if (!isChatSender(event) || !memoryStore) {
      throw new Error("Unauthorized memory request");
    }

    return memoryStore.getSummary();
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

  ipcMain.handle("automaticSituation:get", (event) => {
    if (!isPetSender(event) || !automaticSituationCoordinator) {
      throw new Error("Unauthorized automatic situation request");
    }
    return automaticSituationCoordinator.getSnapshot();
  });

  ipcMain.handle("proactiveCompanion:get-settings", (event) => {
    if (!isChatSender(event)) {
      throw new Error("Unauthorized proactive companion settings request");
    }

    return currentProactiveCompanionSettings;
  });

  ipcMain.handle("proactiveCompanion:set-settings", (event, update: unknown) => {
    if (!isChatSender(event)) {
      throw new Error("Unauthorized proactive companion settings request");
    }

    return applyProactiveCompanionSettings(update);
  });

  ipcMain.handle("environmentActions:get-settings", (event) => {
    if (!isChatSender(event)) {
      throw new Error("Unauthorized environment action settings request");
    }
    return currentEnvironmentActionSettings;
  });

  ipcMain.handle("environmentActions:get-status", (event) => {
    if (!isChatSender(event)) {
      throw new Error("Unauthorized environment action status request");
    }
    return desktopContextMonitor.getStatus();
  });

  ipcMain.handle("environmentActions:set-settings", (event, update: unknown) => {
    if (!isChatSender(event) || !environmentActionSettingsStore) {
      throw new Error("Unauthorized environment action settings request");
    }
    currentEnvironmentActionSettings = environmentActionSettingsStore.saveSettings(update);
    coarseUserStateCoordinator?.setExplicitGameContextEnabled(
      currentEnvironmentActionSettings.explicitGameContextEnabled
    );
    desktopContextMonitor.updateSettings(currentEnvironmentActionSettings);
    return currentEnvironmentActionSettings;
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

  ipcMain.handle("pet-presentation:set-accessory-selection", (event, value: unknown) => {
    const accessoryIds = parsePetAccessorySelection(value);
    if (!isChatSender(event) || !accessoryIds || !petPresentationStore) {
      throw new Error("Invalid pet accessory selection request");
    }

    return savePetAccessorySelection(accessoryIds);
  });

  ipcMain.handle("pet-presentation:set-accessory", (event, presetId: unknown) => {
    if (!isChatSender(event) || !isPetAccessoryPresetId(presetId) || !petPresentationStore) {
      throw new Error("Invalid pet accessory preset request");
    }

    return savePetAccessorySelection(getAccessoryIdsForLegacyPreset(presetId));
  });

  ipcMain.handle("pet-lock:get", (event) => {
    if (!isChatSender(event)) {
      throw new Error("Unauthorized pet lock request");
    }

    return { isLocked: isPetLocked };
  });

  ipcMain.handle("pet-lock:set", (event, value: unknown) => {
    if (!isChatSender(event)) {
      throw new Error("Unauthorized pet lock request");
    }

    if (typeof value !== "boolean") {
      throw new Error("Invalid pet lock request");
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

function quiesceApp(): void {
  openChatWindowAdapter = null;
  pendingChatWindowOpen = false;
  if (activeChatRequestVersion !== null) {
    chatEngine?.abortActiveStream();
    transitionPetRole({ type: "request:cancelled", requestVersion: activeChatRequestVersion });
    activeChatRequestVersion = null;
  }

  cancelPendingModeActionStateTrigger();
  cancelStartupProactiveSpeechBubbleTimer();
  cancelIdleProactiveSpeechBubbleTimer();
  clearChatReplySustainTimer();
  powerMonitor.removeListener("lock-screen", handleSystemLock);
  powerMonitor.removeListener("unlock-screen", handleSystemUnlock);
  powerMonitor.removeListener("suspend", handleSystemSuspend);
  powerMonitor.removeListener("resume", handleSystemResume);
  removeDesktopContextSnapshotListener?.();
  removeDesktopContextSnapshotListener = null;
  proactiveBubbleCoordinator?.dispose();
  proactiveBubbleCoordinator = null;
  petActionDispatchCoordinator?.reset();
  petActionDispatchCoordinator = null;
  proactiveBubbleLedgerStore = null;
  coarseUserStateCoordinator?.dispose();
  coarseUserStateCoordinator = null;
  removeCoarseUserStateListener?.();
  removeCoarseUserStateListener = null;
  removeAutomaticSituationListener?.();
  removeAutomaticSituationListener = null;
  automaticSituationCoordinator?.dispose();
  automaticSituationCoordinator = null;
  desktopContextMonitor.dispose();
  if (initialEdgeGlanceTimer) {
    clearTimeout(initialEdgeGlanceTimer);
    initialEdgeGlanceTimer = null;
  }
  if (performanceHeartbeat) {
    clearInterval(performanceHeartbeat);
    performanceHeartbeat = null;
  }
  petPresentationPersistence?.flush();
  shortcutRegistry?.unregisterAll();
  shortcutRegistry = null;
  globalShortcut.unregisterAll();
}

async function stopLocalRuntimesForShutdown(): Promise<void> {
  const runtimes = Array.from(new Set([
    bundledLlamaCppRuntime,
    llamaCppRuntime
  ].filter((runtime): runtime is LlamaCppRuntime => runtime !== null)));

  const results = await Promise.allSettled(runtimes.map(async (runtime) => {
    const summary = await runtime.stop();
    if (summary.status === "timeout") {
      throw new Error("llama.cpp runtime stop timed out after escalation");
    }
    if (bundledLlamaCppRuntime === runtime) {
      bundledLlamaCppRuntime = null;
    }
    if (llamaCppRuntime === runtime) {
      llamaCppRuntime = null;
    }
  }));

  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((result) => result.reason),
      "One or more local runtimes failed to stop"
    );
  }
}

async function stopAsyncResourcesForShutdown(): Promise<void> {
  const results = await Promise.allSettled([
    mcpSearchSessionRegistry.shutdown(),
    stopLocalRuntimesForShutdown()
  ]);
  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((result) => result.reason),
      "One or more async resources failed to stop"
    );
  }
}

function destroyAppWindows(): void {
  pointerController?.dispose();
  pointerController = null;
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.destroy();
    }
  }
  petWindow = null;
  chatWindow = null;
}

app.on("before-quit", (event) => {
  if (shutdownCoordinator.shouldAllowFinalQuit()) {
    return;
  }

  event.preventDefault();
  shutdownCoordinator.shutdown().catch((error: unknown) => {
    console.error("[app] shutdown coordinator failed", error);
  });
});

app.on("activate", () => {
  if (shutdownCoordinator.isQuiescing()) {
    return;
  }
  ensurePetWindow("activate");
});
