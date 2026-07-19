import "./styles.css";
import type { ChatMessage, ChatRole } from "../../shared/chat";
import type { Conversation, ConversationSummary } from "../../shared/chat-history";
import type { ChatContextTransparencyPayload, ChatMemoryActivityPayload } from "../../shared/ipc-contract";
import type { MemoryCard, MemorySummary } from "../../shared/chat-memory";
import {
  LOCAL_PROVIDER_PRESETS,
  RECOMMENDED_LOCAL_PROVIDER_CONFIG,
  type LocalProviderPresetId,
  type ProviderConfig,
  type ProviderStatus
} from "../../shared/provider-config";
import type { ProviderHealthCheckRequest } from "../../shared/provider-health";
import type { LlamaCppRuntimeSafeSummary } from "../../shared/llama-cpp-runtime";
import type {
  LocalModelDiagnosticRuntimeSummary,
  LocalModelDiagnosticSafeSummary
} from "../../shared/local-model-diagnostic";
import { polishAssistantDisplayText } from "../../shared/reply-text-polish";
import {
  DEFAULT_PET_PRESENTATION_PREFERENCES,
  normalizePetScale
} from "../../shared/pet-presentation";
import {
  PET_ACCESSORY_CATALOG,
  PET_ACCESSORY_GROUPS,
  parsePetAccessorySelection,
  type PetAccessoryGroup,
  type PetAccessoryId
} from "../../shared/pet-accessory";
import type { ShortcutActionId, ShortcutPreferenceView } from "../../shared/shortcut-preferences";
import type { UserProfile } from "../../shared/user-profile";
import {
  BUNDLED_BAIDU_SEARCH_COMMAND,
  DEFAULT_WEB_SEARCH_SETTINGS,
  type WebSearchCitationPayload,
  type WebSearchConnectionTestResult,
  type WebSearchSettings,
  type WebSearchStatus
} from "../../shared/web-search";
import {
  DEFAULT_PROACTIVE_COMPANION_SETTINGS,
  PROACTIVE_COMPANION_CADENCE_DESCRIPTIONS,
  PROACTIVE_COMPANION_CADENCE_LABELS,
  PROACTIVE_COMPANION_CADENCES,
  type ProactiveCompanionCadence,
  type ProactiveCompanionSettings
} from "../../shared/proactive-companion-settings";
import {
  DEFAULT_ENVIRONMENT_ACTION_SETTINGS,
  type EnvironmentActionRuntimeStatus,
  type EnvironmentActionSettings
} from "../../shared/environment-action-settings";
import {
  applyChatTurnDelta,
  createInitialChatTurnState,
  finishChatTurn,
  formatChatTurnFinish,
  shouldAcceptChatTurnEvent,
  startChatTurn,
  type ChatTurnLifecycleEcho,
  type ChatTurnState
} from "./chat-turn-state";
import {
  ACTIVITY_ECHO_ACTIVE_MS,
  ACTIVITY_ECHO_DEDUPE_MS,
  ACTIVITY_ECHO_FADING_MESSAGE,
  ACTIVITY_ECHO_FADING_MS,
  ACTIVITY_ECHO_IDLE_MESSAGE,
  formatCompanionShelf,
  formatContextTransparency,
  formatDailyCompanionRhythm,
  formatHistoryContextPreview,
  formatMemoryActivity,
  formatMemoryRibbon,
  formatProviderHealthResult,
  formatProviderStatus,
  type ActivityEchoState
} from "./partner-presence-presenter";
import {
  createReplyInteractionLockState,
  type ReplyLockControlId
} from "./interaction-lock";

const form = document.querySelector<HTMLFormElement>("#chat-form");
const input = document.querySelector<HTMLInputElement>("#chat-input");
const messages = document.querySelector<HTMLElement>("#messages");
const sendButton = document.querySelector<HTMLButtonElement>("#send-button");
const abortButton = document.querySelector<HTMLButtonElement>("#abort-button");
const partnerStatus = document.querySelector<HTMLElement>("#partner-status");
const providerStatus = document.querySelector<HTMLElement>("#provider-status");
const memorySessionStatus = document.querySelector<HTMLElement>("#memory-session-status");
const settingsButton = document.querySelector<HTMLButtonElement>("#settings-button");
const settingsPanel = document.querySelector<HTMLElement>("#settings-panel");
const settingsCloseButton = document.querySelector<HTMLButtonElement>("#settings-close-button");
const settingsForm = document.querySelector<HTMLFormElement>("#settings-form");
const settingsBackRow = document.querySelector<HTMLElement>("#settings-back-row");
const settingsBackButton = document.querySelector<HTMLButtonElement>("#settings-back-button");
const settingsNestedTitle = document.querySelector<HTMLElement>("#settings-nested-title");
const settingsBasicTab = document.querySelector<HTMLButtonElement>("#settings-basic-tab");
const settingsMemoryTab = document.querySelector<HTMLButtonElement>("#settings-memory-tab");
const settingsHistoryTab = document.querySelector<HTMLButtonElement>("#settings-history-tab");
const settingsAppearanceTab = document.querySelector<HTMLButtonElement>("#settings-appearance-tab");
const settingsModelTab = document.querySelector<HTMLButtonElement>("#settings-model-tab");
const settingsAdvancedTab = document.querySelector<HTMLButtonElement>("#settings-advanced-tab");
const settingsBasicPage = document.querySelector<HTMLElement>("#settings-basic-page");
const settingsAppearancePage = document.querySelector<HTMLElement>("#settings-appearance-page");
const settingsModelPage = document.querySelector<HTMLElement>("#settings-model-page");
const settingsModelDetailPage = document.querySelector<HTMLElement>("#settings-model-detail-page");
const settingsModelDetailButton = document.querySelector<HTMLButtonElement>("#settings-model-detail-button");
const settingsAdvancedPage = document.querySelector<HTMLElement>("#settings-advanced-page");
const settingsMemoryDetailPage = document.querySelector<HTMLElement>("#settings-memory-detail-page");
const memoryDetail = document.querySelector<HTMLElement>("#memory-detail");
const settingsHistoryDetailPage = document.querySelector<HTMLElement>("#settings-history-detail-page");
const providerIdSelect = document.querySelector<HTMLSelectElement>("#provider-id");
const displayNameInput = document.querySelector<HTMLInputElement>("#provider-display-name");
const openAIFields = document.querySelector<HTMLElement>("#openai-fields");
const baseURLInput = document.querySelector<HTMLInputElement>("#provider-base-url");
const modelInput = document.querySelector<HTMLInputElement>("#provider-model");
const temperatureInput = document.querySelector<HTMLInputElement>("#provider-temperature");
const maxTokensInput = document.querySelector<HTMLInputElement>("#provider-max-tokens");
const timeoutInput = document.querySelector<HTMLInputElement>("#provider-timeout");
const localProviderPresetContainer = document.querySelector<HTMLElement>("#local-provider-preset-field");
const localProviderPresetSelect = document.querySelector<HTMLSelectElement>("#local-provider-preset");
const localProviderNote = document.querySelector<HTMLElement>("#local-provider-note");
const localModelDiagnosticSection = document.querySelector<HTMLElement>("#local-model-diagnostic-section");
const localModelDiagnosticStatus = document.querySelector<HTMLElement>("#local-model-diagnostic-status");
const localModelDiagnosticSummary = document.querySelector<HTMLElement>("#local-model-diagnostic-summary");
const localModelDiagnosticRuntimes = document.querySelector<HTMLElement>("#local-model-diagnostic-runtimes");
const localModelDiagnosticButton = document.querySelector<HTMLButtonElement>("#local-model-diagnostic-button");
const llamaCppRuntimeSection = document.querySelector<HTMLElement>("#llama-cpp-runtime-section");
const llamaCppRuntimeStatus = document.querySelector<HTMLElement>("#llama-cpp-runtime-status");
const llamaCppRuntimeFiles = document.querySelector<HTMLElement>("#llama-cpp-runtime-files");
const llamaCppRuntimeEnabled = document.querySelector<HTMLInputElement>("#llama-cpp-runtime-enabled");
const llamaCppRuntimeHost = document.querySelector<HTMLInputElement>("#llama-cpp-runtime-host");
const llamaCppRuntimePort = document.querySelector<HTMLInputElement>("#llama-cpp-runtime-port");
const llamaCppRuntimeCtx = document.querySelector<HTMLInputElement>("#llama-cpp-runtime-ctx");
const llamaCppRuntimeAlias = document.querySelector<HTMLInputElement>("#llama-cpp-runtime-alias");
const llamaCppRuntimeSaveButton = document.querySelector<HTMLButtonElement>("#llama-cpp-runtime-save-button");
const llamaCppRuntimeExecutableButton = document.querySelector<HTMLButtonElement>("#llama-cpp-runtime-executable-button");
const llamaCppRuntimeModelButton = document.querySelector<HTMLButtonElement>("#llama-cpp-runtime-model-button");
const llamaCppRuntimeStartButton = document.querySelector<HTMLButtonElement>("#llama-cpp-runtime-start-button");
const llamaCppRuntimeStopButton = document.querySelector<HTMLButtonElement>("#llama-cpp-runtime-stop-button");
const llamaCppRuntimeRefreshButton = document.querySelector<HTMLButtonElement>("#llama-cpp-runtime-refresh-button");
const providerResetLocalButton = document.querySelector<HTMLButtonElement>("#provider-reset-local-button");
const providerHealthCheckButton = document.querySelector<HTMLButtonElement>("#provider-health-check-button");
const providerHealthStatus = document.querySelector<HTMLElement>("#provider-health-status");
const apiKeyInput = document.querySelector<HTMLInputElement>("#provider-api-key");
const apiKeyStatus = document.querySelector<HTMLElement>("#api-key-status");
const connectionSafeSection = document.querySelector<HTMLElement>("#connection-safe-section");
const deleteApiKeyButton = document.querySelector<HTMLButtonElement>("#delete-api-key-button");
const deleteKeyConfirmation = document.querySelector<HTMLElement>("#delete-key-confirmation");
const cancelDeleteApiKeyButton = document.querySelector<HTMLButtonElement>("#cancel-delete-api-key-button");
const confirmDeleteApiKeyButton = document.querySelector<HTMLButtonElement>("#confirm-delete-api-key-button");
const settingsFeedback = document.querySelector<HTMLElement>("#settings-feedback");
const petScaleInput = document.querySelector<HTMLInputElement>("#pet-scale");
const petScaleValue = document.querySelector<HTMLOutputElement>("#pet-scale-value");
const petAccessoryGroups = document.querySelector<HTMLElement>("#pet-accessory-groups");
const petAccessoryStatus = document.querySelector<HTMLElement>("#pet-accessory-status");
const savePetScaleButton = document.querySelector<HTMLButtonElement>("#save-pet-scale-button");
const savePetAccessoryButton = document.querySelector<HTMLButtonElement>("#save-pet-accessory-button");
const petLockStatus = document.querySelector<HTMLElement>("#pet-lock-status");
const togglePetLockButton = document.querySelector<HTMLButtonElement>("#toggle-pet-lock-button");
const userProfileSummary = document.querySelector<HTMLElement>("#user-profile-summary");
const settingsUserDisplayName = document.querySelector<HTMLInputElement>("#settings-user-display-name");
const settingsUserPreferredName = document.querySelector<HTMLInputElement>("#settings-user-preferred-name");
const saveUserProfileButton = document.querySelector<HTMLButtonElement>("#save-user-profile-button");
const clearUserProfileButton = document.querySelector<HTMLButtonElement>("#clear-user-profile-button");
const proactiveCompanionStatus = document.querySelector<HTMLElement>("#proactive-companion-status");
const proactiveCadenceControls = document.querySelector<HTMLElement>("#proactive-cadence-controls");
const proactiveMemorySourceBubbles = document.querySelector<HTMLInputElement>("#proactive-memory-source-bubbles");
const proactiveSearchSourceBubbles = document.querySelector<HTMLInputElement>("#proactive-search-source-bubbles");
const saveProactiveCompanionSettingsButton = document.querySelector<HTMLButtonElement>("#save-proactive-companion-settings-button");
const environmentActionStatus = document.querySelector<HTMLElement>("#environment-action-status");
const environmentMusicEnabled = document.querySelector<HTMLInputElement>("#environment-music-enabled");
const environmentGameEnabled = document.querySelector<HTMLInputElement>("#environment-game-enabled");
const saveEnvironmentActionSettingsButton = document.querySelector<HTMLButtonElement>("#save-environment-action-settings-button");
const shortcutList = document.querySelector<HTMLElement>("#shortcut-list");
const shortcutStatus = document.querySelector<HTMLElement>("#shortcut-status");
const webSearchStatus = document.querySelector<HTMLElement>("#web-search-status");
const webSearchEnabled = document.querySelector<HTMLInputElement>("#web-search-enabled");
const webSearchProfile = document.querySelector<HTMLSelectElement>("#web-search-profile");
const webSearchProfileNote = document.querySelector<HTMLElement>("#web-search-profile-note");
const webSearchTimeout = document.querySelector<HTMLInputElement>("#web-search-timeout");
const webSearchMaxResults = document.querySelector<HTMLInputElement>("#web-search-max-results");
const webSearchSaveButton = document.querySelector<HTMLButtonElement>("#web-search-save-button");
const webSearchRefreshButton = document.querySelector<HTMLButtonElement>("#web-search-refresh-button");
const webSearchTestButton = document.querySelector<HTMLButtonElement>("#web-search-test-button");
const chatTab = document.querySelector<HTMLButtonElement>("#chat-tab");
const historyTab = document.querySelector<HTMLButtonElement>("#history-tab");
const memoryTab = document.querySelector<HTMLButtonElement>("#memory-tab");
const chatPage = document.querySelector<HTMLElement>("#chat-page");
const companionControlShelf = document.querySelector<HTMLElement>("#companion-control-shelf");
const shelfAccessoryButton = document.querySelector<HTMLButtonElement>("#shelf-accessory-button");
const shelfScaleButton = document.querySelector<HTMLButtonElement>("#shelf-scale-button");
const shelfLockButton = document.querySelector<HTMLButtonElement>("#shelf-lock-button");
const shelfActionEcho = document.querySelector<HTMLElement>("#shelf-action-echo");
const historyPage = document.querySelector<HTMLElement>("#history-page");
const memoryPage = document.querySelector<HTMLElement>("#memory-page");
const chatSessionNote = document.querySelector<HTMLElement>("#chat-session-note");
const memoryDraftPanel = document.querySelector<HTMLElement>("#memory-draft-panel");
const memoryDraftTitle = document.querySelector<HTMLInputElement>("#memory-draft-title");
const memoryDraftContent = document.querySelector<HTMLTextAreaElement>("#memory-draft-content");
const memoryDraftTags = document.querySelector<HTMLInputElement>("#memory-draft-tags");
const cancelMemoryDraftButton = document.querySelector<HTMLButtonElement>("#cancel-memory-draft-button");
const saveMemoryDraftButton = document.querySelector<HTMLButtonElement>("#save-memory-draft-button");
const newConversationButton = document.querySelector<HTMLButtonElement>("#new-conversation-button");
const clearHistoryButton = document.querySelector<HTMLButtonElement>("#clear-history-button");
const clearHistoryConfirmation = document.querySelector<HTMLElement>("#clear-history-confirmation");
const cancelClearHistoryButton = document.querySelector<HTMLButtonElement>("#cancel-clear-history-button");
const confirmClearHistoryButton = document.querySelector<HTMLButtonElement>("#confirm-clear-history-button");
const historyFeedback = document.querySelector<HTMLElement>("#history-feedback");
const conversationList = document.querySelector<HTMLOListElement>("#conversation-list");
const historyDetail = document.querySelector<HTMLElement>("#history-detail");
const enableMemoryButton = document.querySelector<HTMLButtonElement>("#enable-memory-button");
const clearMemoryButton = document.querySelector<HTMLButtonElement>("#clear-memory-button");
const clearMemoryConfirmation = document.querySelector<HTMLElement>("#clear-memory-confirmation");
const cancelClearMemoryButton = document.querySelector<HTMLButtonElement>("#cancel-clear-memory-button");
const confirmClearMemoryButton = document.querySelector<HTMLButtonElement>("#confirm-clear-memory-button");
const memoryFeedback = document.querySelector<HTMLElement>("#memory-feedback");
const memoryOverviewStatus = document.querySelector<HTMLElement>("#memory-overview-status");
const memoryNextInjectionStatus = document.querySelector<HTMLElement>("#memory-next-injection-status");
const memorySafeStats = document.querySelector<HTMLElement>("#memory-safe-stats");
const memoryFilterTabs = [...document.querySelectorAll<HTMLButtonElement>("[data-memory-filter]")];
const memorySearch = document.querySelector<HTMLInputElement>("#memory-search");
const memoryList = document.querySelector<HTMLElement>("#memory-list");
const userWelcomePanel = document.querySelector<HTMLElement>("#user-welcome-panel");
const welcomeUserDisplayName = document.querySelector<HTMLInputElement>("#welcome-user-display-name");
const welcomeUserPreferredName = document.querySelector<HTMLInputElement>("#welcome-user-preferred-name");
const welcomeSaveUserProfileButton = document.querySelector<HTMLButtonElement>("#welcome-save-user-profile-button");
const userWelcomeFeedback = document.querySelector<HTMLElement>("#user-welcome-feedback");

if (
  !form || !input || !messages || !sendButton || !abortButton || !partnerStatus || !providerStatus ||
  !memorySessionStatus || !settingsButton || !settingsPanel || !settingsCloseButton || !settingsForm ||
  !settingsBackRow || !settingsBackButton || !settingsNestedTitle || !settingsBasicTab || !settingsMemoryTab ||
  !settingsHistoryTab || !settingsAppearanceTab || !settingsModelTab || !settingsAdvancedTab || !settingsBasicPage ||
  !settingsAppearancePage || !settingsModelPage || !settingsModelDetailPage || !settingsModelDetailButton ||
  !settingsAdvancedPage || !settingsMemoryDetailPage || !memoryDetail || !settingsHistoryDetailPage || !providerIdSelect ||
  !displayNameInput || !openAIFields || !baseURLInput || !modelInput || !temperatureInput ||
  !maxTokensInput || !timeoutInput || !localProviderPresetContainer || !localProviderPresetSelect || !localProviderNote ||
  !localModelDiagnosticSection || !localModelDiagnosticStatus || !localModelDiagnosticSummary ||
  !localModelDiagnosticRuntimes || !localModelDiagnosticButton ||
  !llamaCppRuntimeSection || !llamaCppRuntimeStatus || !llamaCppRuntimeFiles || !llamaCppRuntimeEnabled ||
  !llamaCppRuntimeHost || !llamaCppRuntimePort || !llamaCppRuntimeCtx || !llamaCppRuntimeAlias ||
  !llamaCppRuntimeSaveButton || !llamaCppRuntimeExecutableButton || !llamaCppRuntimeModelButton ||
  !llamaCppRuntimeStartButton || !llamaCppRuntimeStopButton || !llamaCppRuntimeRefreshButton ||
  !providerResetLocalButton || !providerHealthCheckButton || !providerHealthStatus || !apiKeyInput || !apiKeyStatus || !connectionSafeSection || !deleteApiKeyButton ||
  !deleteKeyConfirmation || !cancelDeleteApiKeyButton || !confirmDeleteApiKeyButton || !settingsFeedback ||
  !petScaleInput || !petScaleValue || !petAccessoryGroups || !petAccessoryStatus || !savePetScaleButton ||
  !savePetAccessoryButton || !petLockStatus || !togglePetLockButton || !userProfileSummary ||
  !settingsUserDisplayName || !settingsUserPreferredName || !saveUserProfileButton || !clearUserProfileButton ||
  !proactiveCompanionStatus || !proactiveCadenceControls ||
  !proactiveMemorySourceBubbles || !proactiveSearchSourceBubbles || !saveProactiveCompanionSettingsButton ||
  !environmentActionStatus || !environmentMusicEnabled || !environmentGameEnabled || !saveEnvironmentActionSettingsButton ||
  !shortcutList || !shortcutStatus ||
  !webSearchStatus || !webSearchEnabled || !webSearchProfile || !webSearchProfileNote ||
  !webSearchTimeout || !webSearchMaxResults || !webSearchSaveButton || !webSearchRefreshButton || !webSearchTestButton ||
  !chatTab || !historyTab || !memoryTab || !chatPage || !companionControlShelf ||
  !shelfAccessoryButton || !shelfScaleButton || !shelfLockButton || !shelfActionEcho || !historyPage ||
  !memoryPage || !chatSessionNote || !memoryDraftPanel || !memoryDraftTitle || !memoryDraftContent || !memoryDraftTags ||
  !cancelMemoryDraftButton || !saveMemoryDraftButton || !newConversationButton || !clearHistoryButton || !clearHistoryConfirmation ||
  !cancelClearHistoryButton || !confirmClearHistoryButton || !historyFeedback || !conversationList || !historyDetail ||
  !enableMemoryButton || !clearMemoryButton || !clearMemoryConfirmation || !cancelClearMemoryButton ||
  !confirmClearMemoryButton || !memoryFeedback || !memoryOverviewStatus || !memoryNextInjectionStatus || !memorySafeStats || !memorySearch || !memoryList || !userWelcomePanel ||
  !welcomeUserDisplayName || !welcomeUserPreferredName || !welcomeSaveUserProfileButton || !userWelcomeFeedback
) {
  throw new Error("chat elements missing");
}

const chatForm = form;
const chatInput = input;
const messageList = messages;
const sendAction = sendButton;
const abortAction = abortButton;
const partnerStatusBox = partnerStatus;
const providerStatusBox = providerStatus;
const memorySessionStatusBox = memorySessionStatus;
const settingsAction = settingsButton;
const providerSettingsPanel = settingsPanel;
const settingsCloseAction = settingsCloseButton;
const providerSettingsForm = settingsForm;
const settingsBackRowBox = settingsBackRow;
const settingsBackAction = settingsBackButton;
const settingsNestedTitleBox = settingsNestedTitle;
const settingsRootTabs = {
  basic: settingsBasicTab,
  memory: settingsMemoryTab,
  history: settingsHistoryTab,
  appearance: settingsAppearanceTab,
  model: settingsModelTab,
  advanced: settingsAdvancedTab
};
const settingsModelDetailAction = settingsModelDetailButton;
const memoryDetailElement = memoryDetail;
const providerIdField = providerIdSelect;
const displayNameField = displayNameInput;
const openAIFieldsContainer = openAIFields;
const baseURLField = baseURLInput;
const modelField = modelInput;
const temperatureField = temperatureInput;
const maxTokensField = maxTokensInput;
const timeoutField = timeoutInput;
const localProviderPresetFieldBox = localProviderPresetContainer;
const localProviderPresetField = localProviderPresetSelect;
const localProviderNoteBox = localProviderNote;
const localModelDiagnosticSectionBox = localModelDiagnosticSection;
const localModelDiagnosticStatusBox = localModelDiagnosticStatus;
const localModelDiagnosticSummaryBox = localModelDiagnosticSummary;
const localModelDiagnosticRuntimesBox = localModelDiagnosticRuntimes;
const localModelDiagnosticAction = localModelDiagnosticButton;
const llamaCppRuntimeSectionBox = llamaCppRuntimeSection;
const llamaCppRuntimeStatusBox = llamaCppRuntimeStatus;
const llamaCppRuntimeFilesBox = llamaCppRuntimeFiles;
const llamaCppRuntimeEnabledField = llamaCppRuntimeEnabled;
const llamaCppRuntimeHostField = llamaCppRuntimeHost;
const llamaCppRuntimePortField = llamaCppRuntimePort;
const llamaCppRuntimeCtxField = llamaCppRuntimeCtx;
const llamaCppRuntimeAliasField = llamaCppRuntimeAlias;
const llamaCppRuntimeSaveAction = llamaCppRuntimeSaveButton;
const llamaCppRuntimeExecutableAction = llamaCppRuntimeExecutableButton;
const llamaCppRuntimeModelAction = llamaCppRuntimeModelButton;
const llamaCppRuntimeStartAction = llamaCppRuntimeStartButton;
const llamaCppRuntimeStopAction = llamaCppRuntimeStopButton;
const llamaCppRuntimeRefreshAction = llamaCppRuntimeRefreshButton;
const providerResetLocalAction = providerResetLocalButton;
const providerHealthCheckAction = providerHealthCheckButton;
const providerHealthStatusBox = providerHealthStatus;
const apiKeyField = apiKeyInput;
const apiKeyStatusBox = apiKeyStatus;
const connectionSafeSectionBox = connectionSafeSection;
const deleteApiKeyAction = deleteApiKeyButton;
const deleteKeyConfirmationBox = deleteKeyConfirmation;
const cancelDeleteApiKeyAction = cancelDeleteApiKeyButton;
const confirmDeleteApiKeyAction = confirmDeleteApiKeyButton;
const settingsFeedbackBox = settingsFeedback;
const petScaleField = petScaleInput;
const petScaleValueBox = petScaleValue;
const petAccessoryGroupsBox = petAccessoryGroups;
const petAccessoryStatusBox = petAccessoryStatus;
const savePetScaleAction = savePetScaleButton;
const savePetAccessoryAction = savePetAccessoryButton;
const petLockStatusBox = petLockStatus;
const togglePetLockAction = togglePetLockButton;
const userProfileSummaryBox = userProfileSummary;
const settingsUserDisplayNameField = settingsUserDisplayName;
const settingsUserPreferredNameField = settingsUserPreferredName;
const saveUserProfileAction = saveUserProfileButton;
const clearUserProfileAction = clearUserProfileButton;
const proactiveCompanionStatusBox = proactiveCompanionStatus;
const proactiveCadenceControlsElement = proactiveCadenceControls;
const proactiveMemorySourceBubblesField = proactiveMemorySourceBubbles;
const proactiveSearchSourceBubblesField = proactiveSearchSourceBubbles;
const saveProactiveCompanionSettingsAction = saveProactiveCompanionSettingsButton;
const environmentActionStatusBox = environmentActionStatus;
const environmentMusicEnabledField = environmentMusicEnabled;
const environmentGameEnabledField = environmentGameEnabled;
const saveEnvironmentActionSettingsAction = saveEnvironmentActionSettingsButton;
const shortcutListElement = shortcutList;
const shortcutStatusBox = shortcutStatus;
const webSearchStatusBox = webSearchStatus;
const webSearchEnabledField = webSearchEnabled;
const webSearchProfileField = webSearchProfile;
const webSearchProfileNoteBox = webSearchProfileNote;
const webSearchTimeoutField = webSearchTimeout;
const webSearchMaxResultsField = webSearchMaxResults;
const webSearchSaveAction = webSearchSaveButton;
const webSearchRefreshAction = webSearchRefreshButton;
const webSearchTestAction = webSearchTestButton;
const chatTabAction = chatTab;
const historyTabAction = historyTab;
const memoryTabAction = memoryTab;
const chatPageContainer = chatPage;
const companionControlShelfBox = companionControlShelf;
const shelfAccessoryAction = shelfAccessoryButton;
const shelfScaleAction = shelfScaleButton;
const shelfLockAction = shelfLockButton;
const shelfActionEchoBox = shelfActionEcho;
const historyPageContainer = historyPage;
const memoryPageContainer = memoryPage;
const chatSessionNoteBox = chatSessionNote;
const memoryDraftPanelBox = memoryDraftPanel;
const memoryDraftTitleField = memoryDraftTitle;
const memoryDraftContentField = memoryDraftContent;
const memoryDraftTagsField = memoryDraftTags;
const cancelMemoryDraftAction = cancelMemoryDraftButton;
const saveMemoryDraftAction = saveMemoryDraftButton;
const newConversationAction = newConversationButton;
const clearHistoryAction = clearHistoryButton;
const clearHistoryConfirmationBox = clearHistoryConfirmation;
const cancelClearHistoryAction = cancelClearHistoryButton;
const confirmClearHistoryAction = confirmClearHistoryButton;
const historyFeedbackBox = historyFeedback;
const conversationListElement = conversationList;
const historyDetailElement = historyDetail;
const enableMemoryAction = enableMemoryButton;
const clearMemoryAction = clearMemoryButton;
const clearMemoryConfirmationBox = clearMemoryConfirmation;
const cancelClearMemoryAction = cancelClearMemoryButton;
const confirmClearMemoryAction = confirmClearMemoryButton;
const memoryFeedbackBox = memoryFeedback;
const memoryOverviewStatusBox = memoryOverviewStatus;
const memoryNextInjectionStatusBox = memoryNextInjectionStatus;
const memorySafeStatsBox = memorySafeStats;
const memorySearchField = memorySearch;
const memoryListElement = memoryList;
const userWelcomePanelBox = userWelcomePanel;
const welcomeUserDisplayNameField = welcomeUserDisplayName;
const welcomeUserPreferredNameField = welcomeUserPreferredName;
const welcomeSaveUserProfileAction = welcomeSaveUserProfileButton;
const userWelcomeFeedbackBox = userWelcomeFeedback;
const settingsPages = {
  basic: settingsBasicPage,
  memory: memoryPageContainer,
  history: historyPageContainer,
  appearance: settingsAppearancePage,
  model: settingsModelPage,
  advanced: settingsAdvancedPage,
  "memory-detail": settingsMemoryDetailPage,
  "history-detail": settingsHistoryDetailPage,
  "model-detail": settingsModelDetailPage
};
type DisableableChatControl = HTMLButtonElement | HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
const replyLockControlElements: Record<ReplyLockControlId, DisableableChatControl> = {
  "chat-input": chatInput,
  "abort-button": abortAction,
  "settings-button": settingsAction,
  "chat-tab": chatTabAction,
  "history-tab": historyTabAction,
  "memory-tab": memoryTabAction,
  "new-conversation-button": newConversationAction,
  "clear-history-button": clearHistoryAction,
  "enable-memory-button": enableMemoryAction,
  "clear-memory-button": clearMemoryAction,
  "save-memory-draft-button": saveMemoryDraftAction,
  "save-user-profile-button": saveUserProfileAction,
  "clear-user-profile-button": clearUserProfileAction,
  "welcome-save-user-profile-button": welcomeSaveUserProfileAction,
  "save-proactive-companion-settings-button": saveProactiveCompanionSettingsAction,
  "shelf-accessory-button": shelfAccessoryAction,
  "shelf-scale-button": shelfScaleAction,
  "shelf-lock-button": shelfLockAction
};
const chatHistory: ChatMessage[] = [];
let conversationId: string = crypto.randomUUID();
const DEFAULT_API_KEY_REF = "openai-compatible-default";
const DEFAULT_OPENAI_CONFIG = {
  displayName: "外部 OpenAI-compatible",
  baseURL: "",
  model: "",
  temperature: 0.7,
  maxTokens: 1024,
  timeoutMs: 60000
};
const DEFAULT_LOCAL_OPENAI_CONFIG = {
  displayName: RECOMMENDED_LOCAL_PROVIDER_CONFIG.displayName,
  baseURL: RECOMMENDED_LOCAL_PROVIDER_CONFIG.baseURL,
  model: RECOMMENDED_LOCAL_PROVIDER_CONFIG.model,
  localPresetId: RECOMMENDED_LOCAL_PROVIDER_CONFIG.localPresetId,
  temperature: RECOMMENDED_LOCAL_PROVIDER_CONFIG.temperature,
  maxTokens: RECOMMENDED_LOCAL_PROVIDER_CONFIG.maxTokens,
  timeoutMs: RECOMMENDED_LOCAL_PROVIDER_CONFIG.timeoutMs
};

type SettingsRootPageId = "basic" | "memory" | "history" | "appearance" | "model" | "advanced";
type SettingsNestedPageId = "memory-detail" | "history-detail" | "model-detail";
type SettingsPageId = SettingsRootPageId | SettingsNestedPageId;
type MemoryFilter = "all" | "key" | "general" | "auto" | "manual" | "disabled";

const settingsNestedParents: Record<SettingsNestedPageId, SettingsRootPageId> = {
  "memory-detail": "memory",
  "history-detail": "history",
  "model-detail": "model"
};

const settingsPageLabels: Record<SettingsPageId, string> = {
  basic: "基础",
  memory: "记忆",
  history: "历史",
  appearance: "外观",
  model: "模型",
  advanced: "高级",
  "memory-detail": "记忆内容",
  "history-detail": "历史详情",
  "model-detail": "模型连接详情"
};

let chatTurnState: ChatTurnState = createInitialChatTurnState();
let activeReplyMessage: ChatMessage | null = null;
let activeReplyElement: HTMLElement | null = null;
let activePage: "chat" | "history" | "memory" = "chat";
let activeSettingsPage: SettingsPageId = "basic";
let selectedHistoryConversation: Conversation | null = null;
let selectedMemoryCardId: string | null = null;
let providerContextEnabled = true;
let memoryCards: MemoryCard[] = [];
let memorySummary: MemorySummary | null = null;
let memoryEnabled = false;
let activeMemoryFilter: MemoryFilter = "all";
let memoryDraftSourceMessage: ChatMessage | null = null;
let isPetLocked = false;
let currentPetScale = DEFAULT_PET_PRESENTATION_PREFERENCES.petScale;
let currentPetAccessoryIds: PetAccessoryId[] = [...DEFAULT_PET_PRESENTATION_PREFERENCES.accessoryIds];
let shortcutViews: ShortcutPreferenceView[] = [];
let currentProactiveCompanionSettings: ProactiveCompanionSettings = DEFAULT_PROACTIVE_COMPANION_SETTINGS;
let currentUserProfile: UserProfile | null = null;
let currentMemoryInjectionCount: number | null = null;
let latestMemoryActivity: ReturnType<typeof formatMemoryActivity> | null = null;
let latestMemoryActivityPayload: ChatMemoryActivityPayload | null = null;
let latestMemoryActivityRequestVersion: number | null = null;
let latestContextTransparency: ReturnType<typeof formatContextTransparency> | null = null;
let latestContextTransparencyPayload: ChatContextTransparencyPayload | null = null;
let latestContextTransparencyRequestVersion: number | null = null;
let latestLocalModelDiagnosticSummary: LocalModelDiagnosticSafeSummary | null = null;
let isLocalModelDiagnosticRunning = false;

let currentActivityEcho = ACTIVITY_ECHO_IDLE_MESSAGE;
let currentActivityEchoState: ActivityEchoState = "idle";
let currentRibbonEcho = ACTIVITY_ECHO_IDLE_MESSAGE;
let lastActivityEchoMessage: string | null = null;
let lastActivityEchoAt = 0;
let activityEchoActiveTimer: number | null = null;
let activityEchoIdleTimer: number | null = null;
let recordingShortcutActionId: ShortcutActionId | null = null;
let pendingWheelModifierRecordTimeout: number | null = null;

function setProviderStatus(status: ProviderStatus): void {
  providerStatusBox.textContent = formatProviderStatus(status);
  providerStatusBox.dataset.state = status.isFallback ? "fallback" : "ready";
}

function setWebSearchStatus(status: WebSearchStatus): void {
  const usesBundledProfile = status.commandName === BUNDLED_BAIDU_SEARCH_COMMAND && status.argsCount === 0;
  webSearchStatusBox.dataset.state = status.enabled ? "ready" : "fallback";
  webSearchStatusBox.textContent = status.enabled
    ? `内置百度搜索已启用 · 结果 ${status.maxResults} 条 · 超时 ${status.timeoutMs}ms`
    : usesBundledProfile
      ? "内置百度搜索已配置，当前未启用。"
      : status.commandConfigured
        ? "检测到历史自定义搜索配置，已停用且不受支持。"
        : "尚未配置联网搜索。";
}

function setWebSearchFields(settings: WebSearchSettings): void {
  const usesBundledProfile = settings.command === BUNDLED_BAIDU_SEARCH_COMMAND && settings.args.length === 0;
  webSearchProfileField.replaceChildren();

  if (!usesBundledProfile) {
    const unsupportedOption = document.createElement("option");
    unsupportedOption.value = "unsupported";
    unsupportedOption.textContent = "历史自定义配置（不受支持）";
    unsupportedOption.disabled = true;
    webSearchProfileField.append(unsupportedOption);
  }

  const bundledOption = document.createElement("option");
  bundledOption.value = BUNDLED_BAIDU_SEARCH_COMMAND;
  bundledOption.textContent = "内置百度网页搜索（兼容适配器）";
  webSearchProfileField.append(bundledOption);
  webSearchProfileField.value = usesBundledProfile ? BUNDLED_BAIDU_SEARCH_COMMAND : "unsupported";
  webSearchProfileNoteBox.textContent = usesBundledProfile
    ? "使用应用内置且经过批准的百度搜索配置，无需填写命令或参数。"
    : "检测到历史自定义配置。该配置已停用且不受支持；保存后会安全迁移到内置百度搜索，不会显示原命令或参数。";
  webSearchProfileNoteBox.dataset.state = usesBundledProfile ? "ready" : "error";
  webSearchEnabledField.checked = settings.enabled;
  webSearchTimeoutField.value = String(settings.timeoutMs);
  webSearchMaxResultsField.value = String(settings.maxResults);
}

function formatProactiveCompanionStatus(settings: ProactiveCompanionSettings): string {
  const cadenceLabel = PROACTIVE_COMPANION_CADENCE_LABELS[settings.cadence];
  if (settings.cadence === "off") {
    return "主动气泡：关闭。她仍会正常聊天和动作，只是不自动冒出短气泡。";
  }

  const sourceLabels = [
    settings.memorySourceBubbles ? "记忆整理回声开启" : "记忆整理回声关闭",
    settings.searchSourceBubbles ? "搜索引用回声开启" : "搜索引用回声关闭"
  ];
  return `主动气泡：${cadenceLabel} · ${sourceLabels.join(" · ")}`;
}

function renderProactiveCompanionSettings(settings: ProactiveCompanionSettings): void {
  currentProactiveCompanionSettings = settings;
  proactiveCompanionStatusBox.textContent = formatProactiveCompanionStatus(settings);
  proactiveCompanionStatusBox.dataset.state = settings.cadence === "normal" ? "ready" : "fallback";
  proactiveMemorySourceBubblesField.checked = settings.memorySourceBubbles;
  proactiveSearchSourceBubblesField.checked = settings.searchSourceBubbles;

  for (const button of proactiveCadenceControlsElement.querySelectorAll<HTMLButtonElement>(".mode-button")) {
    const isActive = button.dataset.cadence === settings.cadence;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
    button.disabled = chatTurnState.isReplying;
  }
}

function renderProactiveCadenceControls(): void {
  proactiveCadenceControlsElement.replaceChildren();

  for (const cadence of PROACTIVE_COMPANION_CADENCES) {
    const button = document.createElement("button");
    button.className = "button-light mode-button";
    button.type = "button";
    button.dataset.cadence = cadence;
    button.textContent = PROACTIVE_COMPANION_CADENCE_LABELS[cadence];
    button.title = PROACTIVE_COMPANION_CADENCE_DESCRIPTIONS[cadence];
    button.disabled = chatTurnState.isReplying;
    button.setAttribute("aria-pressed", String(cadence === currentProactiveCompanionSettings.cadence));
    button.addEventListener("click", () => {
      renderProactiveCompanionSettings({
        ...currentProactiveCompanionSettings,
        cadence
      });
    });
    proactiveCadenceControlsElement.append(button);
  }
}

async function refreshProactiveCompanionSettings(): Promise<void> {
  renderProactiveCadenceControls();

  if (!window.proactiveCompanionApi) {
    renderProactiveCompanionSettings(DEFAULT_PROACTIVE_COMPANION_SETTINGS);
    proactiveCompanionStatusBox.dataset.state = "fallback";
    proactiveCompanionStatusBox.textContent = "主动气泡设置不可用。";
    return;
  }

  try {
    renderProactiveCompanionSettings(await window.proactiveCompanionApi.getSettings());
  } catch {
    proactiveCompanionStatusBox.dataset.state = "fallback";
    proactiveCompanionStatusBox.textContent = "无法读取主动气泡设置。";
  }
}

async function saveProactiveCompanionSettings(): Promise<void> {
  if (!window.proactiveCompanionApi || chatTurnState.isReplying) {
    return;
  }

  try {
    const settings = await window.proactiveCompanionApi.setSettings({
      cadence: currentProactiveCompanionSettings.cadence,
      memorySourceBubbles: proactiveMemorySourceBubblesField.checked,
      searchSourceBubbles: proactiveSearchSourceBubblesField.checked
    });
    renderProactiveCompanionSettings(settings);
    setSettingsFeedback("主动气泡设置已保存。", "ready");
  } catch {
    setSettingsFeedback("无法保存主动气泡设置，请稍后重试。", "fallback");
  }
}

function renderEnvironmentActionSettings(
  settings: EnvironmentActionSettings,
  runtimeStatus?: EnvironmentActionRuntimeStatus
): void {
  environmentMusicEnabledField.checked = settings.musicEnabled;
  environmentGameEnabledField.checked = settings.gameEnabled;
  const enabledLabels = [
    settings.musicEnabled ? "媒体开启" : null,
    settings.gameEnabled ? "游戏开启" : null
  ].filter((value): value is string => value !== null);
  if (enabledLabels.length === 0) {
    environmentActionStatusBox.textContent = "环境动作感知：关闭。";
    environmentActionStatusBox.dataset.state = "fallback";
    return;
  }

  const monitorLabel = runtimeStatus?.monitorStatus === "backoff"
    ? "探测退避中"
    : runtimeStatus?.monitorStatus === "waiting-for-renderer"
      ? "等待桌宠就绪"
      : runtimeStatus?.monitorStatus === "polling"
        ? "探测运行中"
        : "状态待确认";
  const capabilityLabels = runtimeStatus
    ? [
        `媒体${runtimeStatus.mediaCapability === "available" ? "可用" : "不可用"}`,
        `游戏${runtimeStatus.gameCapability === "available" ? "可用" : "不可用"}`
      ]
    : [];
  environmentActionStatusBox.textContent = `环境动作感知：${enabledLabels.join(" · ")}。${monitorLabel}${
    capabilityLabels.length > 0 ? `，${capabilityLabels.join(" · ")}` : ""
  }。`;
  environmentActionStatusBox.dataset.state = runtimeStatus?.monitorStatus === "backoff" ? "fallback" : "ready";
}

async function refreshEnvironmentActionSettings(): Promise<void> {
  if (!window.environmentActionApi) {
    renderEnvironmentActionSettings(DEFAULT_ENVIRONMENT_ACTION_SETTINGS);
    environmentActionStatusBox.textContent = "环境动作感知设置不可用。";
    return;
  }
  try {
    const [settings, runtimeStatus] = await Promise.all([
      window.environmentActionApi.getSettings(),
      window.environmentActionApi.getStatus()
    ]);
    renderEnvironmentActionSettings(settings, runtimeStatus);
  } catch {
    renderEnvironmentActionSettings(DEFAULT_ENVIRONMENT_ACTION_SETTINGS);
    environmentActionStatusBox.textContent = "无法读取环境动作感知设置。";
  }
}

async function saveEnvironmentActionSettings(): Promise<void> {
  if (!window.environmentActionApi || chatTurnState.isReplying) {
    return;
  }
  try {
    const settings = await window.environmentActionApi.setSettings({
      musicEnabled: environmentMusicEnabledField.checked,
      gameEnabled: environmentGameEnabledField.checked
    });
    renderEnvironmentActionSettings(settings, await window.environmentActionApi.getStatus());
    setSettingsFeedback("环境动作感知设置已保存。", "ready");
  } catch {
    setSettingsFeedback("无法保存环境动作感知设置，请稍后重试。", "fallback");
  }
}

async function refreshWebSearchSettings(): Promise<void> {
  if (!window.webSearchApi) {
    webSearchStatusBox.dataset.state = "fallback";
    webSearchStatusBox.textContent = "MCP 搜索设置不可用。";
    setWebSearchFields(DEFAULT_WEB_SEARCH_SETTINGS);
    return;
  }

  try {
    const [settings, status] = await Promise.all([
      window.webSearchApi.getSettings(),
      window.webSearchApi.getStatus()
    ]);
    setWebSearchFields(settings);
    setWebSearchStatus(status);
  } catch {
    webSearchStatusBox.dataset.state = "fallback";
    webSearchStatusBox.textContent = "无法读取 MCP 搜索设置。";
  }
}

function buildWebSearchSettings(): WebSearchSettings | null {
  const timeoutMs = parsePositiveInteger(webSearchTimeoutField, "搜索超时时间");
  const maxResults = parsePositiveInteger(webSearchMaxResultsField, "搜索结果数");

  if (timeoutMs === null || maxResults === null) {
    return null;
  }

  return {
    enabled: webSearchEnabledField.checked,
    command: BUNDLED_BAIDU_SEARCH_COMMAND,
    args: [],
    toolName: DEFAULT_WEB_SEARCH_SETTINGS.toolName,
    timeoutMs,
    maxResults
  };
}

async function saveWebSearchSettings(): Promise<void> {
  if (!window.webSearchApi) {
    setSettingsFeedback("MCP 搜索设置不可用。");
    return;
  }

  const settings = buildWebSearchSettings();

  if (!settings) {
    return;
  }

  try {
    const savedSettings = await window.webSearchApi.setSettings(settings);
    setWebSearchFields(savedSettings);
    setWebSearchStatus(await window.webSearchApi.getStatus());
    setSettingsFeedback(savedSettings.enabled ? "内置百度搜索已启用。" : "内置百度搜索设置已保存，当前仍关闭。", "ready");
  } catch {
    setSettingsFeedback("无法保存内置百度搜索设置，请稍后重试。");
  }
}

async function testWebSearchConnection(): Promise<void> {
  if (!window.webSearchApi) {
    setSettingsFeedback("MCP 搜索设置不可用。");
    return;
  }

  const settings = buildWebSearchSettings();

  if (!settings) {
    return;
  }

  webSearchTestAction.disabled = true;
  webSearchStatusBox.dataset.state = "fallback";
  webSearchStatusBox.textContent = "正在测试 MCP 工具...";

  try {
    const result = await window.webSearchApi.testConnection(settings);
    webSearchStatusBox.textContent = formatWebSearchConnectionTestResult(result);
    webSearchStatusBox.dataset.state = result.status === "tool_available" ? "ready" : "fallback";
    setSettingsFeedback(
      result.status === "tool_available" ? "MCP 工具可用。" : "MCP 连接测试完成，请查看状态摘要。",
      result.status === "tool_available" ? "ready" : "fallback"
    );
  } catch {
    webSearchStatusBox.dataset.state = "fallback";
    webSearchStatusBox.textContent = "MCP 连接测试失败。";
    setSettingsFeedback("MCP 连接测试失败；未发送用户消息或搜索查询。");
  } finally {
    webSearchTestAction.disabled = false;
  }
}

function formatWebSearchConnectionTestResult(result: WebSearchConnectionTestResult): string {
  switch (result.status) {
    case "not_configured":
      return "未配置 MCP 命令。";
    case "configured_disabled":
      return "内置百度搜索已配置，当前未启用。";
    case "tool_available":
      return `工具可用 · ${result.toolName} · 已发现 ${result.toolCount} 个工具。`;
    case "tool_missing":
      return `找不到工具 · ${result.toolName} · 已发现 ${result.toolCount} 个工具。`;
    case "spawn_failed":
      return "启动失败；请检查 MCP 命令是否可运行。";
    case "timeout":
      return "连接超时；请检查 MCP server 是否能响应 initialize/tools/list。";
    case "failed":
      return "测试失败；只运行了 initialize 和 tools/list。";
  }
}

function resetProviderHealthStatus(): void {
  providerHealthStatusBox.textContent = "连接检查尚未运行。";
  providerHealthStatusBox.dataset.state = "fallback";
}

function setProviderHealthStatus(message: string, state: "ready" | "fallback" = "fallback"): void {
  providerHealthStatusBox.textContent = message;
  providerHealthStatusBox.dataset.state = state;
}

function resetLocalModelDiagnosticSummary(): void {
  latestLocalModelDiagnosticSummary = null;
  localModelDiagnosticStatusBox.textContent = "本地模型诊断尚未运行。";
  localModelDiagnosticStatusBox.dataset.state = "fallback";
  localModelDiagnosticSummaryBox.textContent = "运行后会显示内置 local-llm、托管 llama.cpp 和兼容运行时的安全摘要。";
  localModelDiagnosticRuntimesBox.replaceChildren();
  localModelDiagnosticAction.disabled = false;
  localModelDiagnosticAction.textContent = "运行本地诊断";
}

function setLocalModelDiagnosticPending(): void {
  localModelDiagnosticStatusBox.textContent = "正在运行本地模型诊断...";
  localModelDiagnosticStatusBox.dataset.state = "fallback";
  localModelDiagnosticSummaryBox.textContent = "正在检查命令、进程、端口、模型列表和最小聊天探测。";
  localModelDiagnosticAction.disabled = true;
  localModelDiagnosticAction.textContent = "诊断中...";
}

function formatLocalModelDiagnosticStatus(status: LocalModelDiagnosticRuntimeSummary["status"]): string {
  const labels: Record<LocalModelDiagnosticRuntimeSummary["status"], string> = {
    ready: "已就绪",
    not_installed_or_unreachable: "未安装或不可达",
    model_missing: "缺少模型",
    chat_failed: "聊天探测失败",
    missing_resources: "缺少资源",
    env_configured: "已配置，待启动",
    skipped: "未配置"
  };

  return labels[status];
}

function formatLocalModelDiagnosticNextAction(runtime: LocalModelDiagnosticRuntimeSummary): string {
  if (runtime.status === "ready") {
    return "可以用于真实本地模型验收。";
  }

  if (runtime.id === "llama-cpp-managed" && runtime.reason === "missing_local_paths") {
    return "先在托管 llama.cpp 区选择运行文件和 GGUF 模型。";
  }

  if (runtime.id === "llama-cpp-bundled" && runtime.status === "missing_resources") {
    return runtime.nextAction ?? "安装包需要包含 local-llm 运行时与 GGUF 模型资源。";
  }

  if (runtime.reason === "command_missing") {
    return runtime.id === "ollama"
      ? "Ollama 仅作为高级兼容路径；默认使用内置本地模型。"
      : "该兼容运行时未就绪；默认使用内置本地模型。";
  }

  if (runtime.reason === "tcp_unreachable") {
    return "启动对应本地服务，并确认端口正在监听。";
  }

  if (runtime.reason === "model_missing") {
    return "准备目标模型后重新诊断。";
  }

  if (runtime.status === "chat_failed") {
    return "检查本地服务控制台和模型兼容性后重试。";
  }

  return runtime.nextAction ?? "按运行时提示完成本地服务准备后重试。";
}

function formatLocalModelDiagnosticRuntime(runtime: LocalModelDiagnosticRuntimeSummary): string {
  const details = [
    `${runtime.label}：${formatLocalModelDiagnosticStatus(runtime.status)}`,
    runtime.baseURLHost ? `Host：${runtime.baseURLHost}` : null,
    runtime.model ? `模型：${runtime.model}` : null,
    typeof runtime.modelCount === "number" ? `模型数：${runtime.modelCount}` : null,
    typeof runtime.firstTokenMs === "number" ? `首 token：${runtime.firstTokenMs}ms` : null,
    typeof runtime.replyLength === "number" ? `回复长度：${runtime.replyLength}` : null,
    `下一步：${formatLocalModelDiagnosticNextAction(runtime)}`
  ].filter(Boolean);

  return details.join(" · ");
}

function renderLocalModelDiagnosticSummary(summary: LocalModelDiagnosticSafeSummary): void {
  latestLocalModelDiagnosticSummary = summary;
  const state = summary.status === "ready" ? "ready" : "fallback";
  localModelDiagnosticStatusBox.dataset.state = state;
  localModelDiagnosticStatusBox.textContent = summary.ok
    ? `诊断完成：已有可用本地运行时 · 建议 ${summary.recommendedRuntime} · ${summary.durationMs}ms`
    : `诊断完成：本地模型尚未就绪 · 建议先看 ${summary.recommendedRuntime} · ${summary.durationMs}ms`;
  localModelDiagnosticSummaryBox.textContent = summary.ok
    ? "可以继续做真实本地模型 Chat 验收；不要用 mock 或 Fake 代替真实运行时。"
    : "诊断功能正常完成，但当前本地运行时还没准备好。";
  localModelDiagnosticRuntimesBox.replaceChildren(
    ...summary.runtimes.map((runtime) => {
      const item = document.createElement("p");
      item.className = "selection-note";
      item.dataset.state = runtime.status === "ready" ? "ready" : "fallback";
      item.textContent = formatLocalModelDiagnosticRuntime(runtime);
      return item;
    })
  );
}

function setLocalModelDiagnosticUnavailable(): void {
  latestLocalModelDiagnosticSummary = null;
  localModelDiagnosticStatusBox.textContent = "本地模型诊断功能不可用。";
  localModelDiagnosticStatusBox.dataset.state = "fallback";
  localModelDiagnosticSummaryBox.textContent = "请稍后重试，或使用命令行诊断入口。";
  localModelDiagnosticRuntimesBox.replaceChildren();
}

async function runLocalModelDiagnostic(): Promise<void> {
  if (chatTurnState.isReplying || isLocalModelDiagnosticRunning) {
    return;
  }

  if (!window.localRuntimeApi) {
    setLocalModelDiagnosticUnavailable();
    return;
  }

  isLocalModelDiagnosticRunning = true;
  setLocalModelDiagnosticPending();

  try {
    renderLocalModelDiagnosticSummary(await window.localRuntimeApi.diagnoseLocalModel());
  } catch {
    setLocalModelDiagnosticUnavailable();
  } finally {
    isLocalModelDiagnosticRunning = false;
    localModelDiagnosticAction.disabled = false;
    localModelDiagnosticAction.textContent = "运行本地诊断";
  }
}

function formatLlamaCppRuntimeStatus(status: LlamaCppRuntimeSafeSummary["status"]): string {
  const labels: Record<LlamaCppRuntimeSafeSummary["status"], string> = {
    disabled: "未启用",
    missing_binary: "缺运行文件",
    missing_model: "缺模型",
    starting: "启动中",
    ready: "已就绪",
    exited: "已退出",
    timeout: "超时",
    error: "错误"
  };

  return labels[status];
}

function renderLlamaCppRuntimeSummary(summary: LlamaCppRuntimeSafeSummary): void {
  llamaCppRuntimeEnabledField.checked = summary.enabled;
  llamaCppRuntimeHostField.value = summary.host ?? "";
  llamaCppRuntimePortField.value = typeof summary.port === "number" ? String(summary.port) : "";
  llamaCppRuntimeCtxField.value = typeof summary.ctxSize === "number" ? String(summary.ctxSize) : "";
  llamaCppRuntimeAliasField.value = summary.alias ?? "";

  const hostLabel = summary.baseURLHost ?? [
    summary.host,
    typeof summary.port === "number" ? summary.port : null
  ].filter(Boolean).join(":");
  const details = [
    `状态：${formatLlamaCppRuntimeStatus(summary.status)}`,
    summary.enabled ? "开关：已启用" : "开关：未启用",
    hostLabel ? `Host：${hostLabel}` : null,
    typeof summary.ctxSize === "number" ? `Context：${summary.ctxSize}` : null,
    summary.alias ? `Alias：${summary.alias}` : null
  ].filter(Boolean);

  llamaCppRuntimeStatusBox.textContent = details.join(" · ");
  llamaCppRuntimeStatusBox.dataset.state = summary.status === "ready" ? "ready" : "fallback";
  llamaCppRuntimeFilesBox.textContent = `运行文件：${summary.executableName ?? "未选择"} · 模型：${summary.modelName ?? "未选择"}`;
}

function setLlamaCppRuntimeStatus(message: string, state: "ready" | "fallback" = "fallback"): void {
  llamaCppRuntimeStatusBox.textContent = message;
  llamaCppRuntimeStatusBox.dataset.state = state;
}

async function refreshLlamaCppRuntimeStatus(): Promise<void> {
  if (!window.localRuntimeApi) {
    setLlamaCppRuntimeStatus("托管 llama.cpp 设置不可用。", "fallback");
    return;
  }

  try {
    renderLlamaCppRuntimeSummary(await window.localRuntimeApi.getLlamaCppStatus());
  } catch {
    setLlamaCppRuntimeStatus("托管 llama.cpp 状态不可用。", "fallback");
  }
}

function parseOptionalRuntimeInteger(field: HTMLInputElement, fieldName: string): number | undefined | null {
  if (field.value.trim() === "") {
    return undefined;
  }

  const value = Number(field.value);

  if (!Number.isInteger(value) || value <= 0) {
    setSettingsFeedback(`${fieldName}必须留空或填写正整数。`);
    return null;
  }

  return value;
}

async function saveLlamaCppRuntimeSettings(): Promise<void> {
  if (!window.localRuntimeApi) {
    setLlamaCppRuntimeStatus("托管 llama.cpp 设置不可用。", "fallback");
    return;
  }

  const port = parseOptionalRuntimeInteger(llamaCppRuntimePortField, "Port");
  const ctxSize = parseOptionalRuntimeInteger(llamaCppRuntimeCtxField, "Context");

  if (port === null || ctxSize === null) {
    return;
  }

  try {
    const summary = await window.localRuntimeApi.updateLlamaCppSettings({
      enabled: llamaCppRuntimeEnabledField.checked,
      host: llamaCppRuntimeHostField.value,
      port: typeof port === "number" ? port : null,
      ctxSize: typeof ctxSize === "number" ? ctxSize : null,
      alias: llamaCppRuntimeAliasField.value
    });
    renderLlamaCppRuntimeSummary(summary);
    setSettingsFeedback("托管 llama.cpp 设置已保存。", "ready");
  } catch {
    setLlamaCppRuntimeStatus("无法保存托管 llama.cpp 设置。", "fallback");
  }
}

async function runLlamaCppRuntimeAction(
  action: () => Promise<LlamaCppRuntimeSafeSummary>,
  pendingMessage: string
): Promise<void> {
  if (chatTurnState.isReplying) {
    return;
  }

  setLlamaCppRuntimeStatus(pendingMessage, "fallback");

  try {
    renderLlamaCppRuntimeSummary(await action());
  } catch {
    setLlamaCppRuntimeStatus("托管 llama.cpp 操作失败，请稍后重试。", "fallback");
  }
}

function setPartnerStatus(message: string): void {
  partnerStatusBox.textContent = message;
  partnerStatusBox.dataset.state = "ready";
}

function renderPartnerStatus(): void {
  const userProfileLabel = currentUserProfile
    ? currentUserProfile.preferredName ?? currentUserProfile.displayName
    : "等待本地身份";

  setPartnerStatus(`桌面伙伴：${userProfileLabel} · 自动陪伴`);
}

function renderRibbonEcho(): void {
  const ribbon = formatMemoryRibbon({
    memoryInjectionCount: currentMemoryInjectionCount,
    ribbonEcho: currentRibbonEcho
  });

  memorySessionStatusBox.textContent = ribbon.text;
  memorySessionStatusBox.dataset.state = ribbon.state;
}

function renderActivityEcho(message: string, state: ActivityEchoState): void {
  currentActivityEcho = message;
  currentActivityEchoState = state;

  if (!chatTurnState.isReplying) {
    currentRibbonEcho = message;
  }

  renderRibbonEcho();
  renderCompanionControlShelf();
}

function clearActivityEchoTimers(): void {
  if (activityEchoActiveTimer !== null) {
    window.clearTimeout(activityEchoActiveTimer);
    activityEchoActiveTimer = null;
  }

  if (activityEchoIdleTimer !== null) {
    window.clearTimeout(activityEchoIdleTimer);
    activityEchoIdleTimer = null;
  }
}

function scheduleActivityEchoLifecycle(): void {
  clearActivityEchoTimers();
  activityEchoActiveTimer = window.setTimeout(() => {
    activityEchoActiveTimer = null;
    renderActivityEcho(ACTIVITY_ECHO_FADING_MESSAGE, "fading");
    activityEchoIdleTimer = window.setTimeout(() => {
      activityEchoIdleTimer = null;
      lastActivityEchoMessage = null;
      renderActivityEcho(ACTIVITY_ECHO_IDLE_MESSAGE, "idle");
    }, ACTIVITY_ECHO_FADING_MS);
  }, ACTIVITY_ECHO_ACTIVE_MS);
}

function setPetActivityEcho(message: string): void {
  const now = Date.now();

  if (
    message === lastActivityEchoMessage &&
    currentActivityEchoState === "active" &&
    now - lastActivityEchoAt <= ACTIVITY_ECHO_DEDUPE_MS
  ) {
    lastActivityEchoAt = now;
    scheduleActivityEchoLifecycle();
    return;
  }

  lastActivityEchoMessage = message;
  lastActivityEchoAt = now;
  renderActivityEcho(message, "active");
  scheduleActivityEchoLifecycle();
}

function setChatLifecycleEcho(message: string): void {
  currentRibbonEcho = message;
  renderRibbonEcho();
}

function renderCompanionControlShelf(): void {
  const shelf = formatCompanionShelf({
    accessoryLabel: `已选 ${currentPetAccessoryIds.length} 类`,
    petScale: currentPetScale,
    isPetLocked,
    activityEcho: currentActivityEcho,
    activityEchoState: currentActivityEchoState
  });

  companionControlShelfBox.hidden = false;
  shelfAccessoryAction.textContent = shelf.accessoryText;
  shelfScaleAction.textContent = shelf.scaleText;
  shelfLockAction.textContent = shelf.lockText;
  shelfLockAction.dataset.state = shelf.lockState;
  shelfActionEchoBox.textContent = shelf.actionEchoText;
  shelfActionEchoBox.dataset.state = shelf.actionEchoState;
}

function formatUserProfileSummary(profile: UserProfile | null): string {
  if (!profile) {
    return "尚未设置本地昵称。";
  }

  return profile.preferredName
    ? `本地身份：${profile.displayName} · 称呼：${profile.preferredName}`
    : `本地身份：${profile.displayName}`;
}

function setUserWelcomeFeedback(message: string, state: "ready" | "fallback" = "fallback"): void {
  userWelcomeFeedbackBox.textContent = message;
  userWelcomeFeedbackBox.dataset.state = state;
  userWelcomeFeedbackBox.hidden = false;
}

function clearUserWelcomeFeedback(): void {
  userWelcomeFeedbackBox.textContent = "";
  userWelcomeFeedbackBox.hidden = true;
  delete userWelcomeFeedbackBox.dataset.state;
}

function normalizeUserProfileField(field: HTMLInputElement): string | null {
  if (/[\r\n<>]/.test(field.value)) {
    return null;
  }

  const value = field.value.trim().replace(/\s+/g, " ");

  if (value.length === 0 || value.length > 32) {
    return null;
  }

  return value;
}

function readUserProfileFields(displayNameField: HTMLInputElement, preferredNameField: HTMLInputElement): { displayName: string; preferredName?: string } | null {
  const displayName = normalizeUserProfileField(displayNameField);
  const preferredNameRaw = preferredNameField.value.trim();
  const preferredName = preferredNameRaw.length > 0 ? normalizeUserProfileField(preferredNameField) : undefined;

  if (!displayName || preferredName === null) {
    return null;
  }

  return {
    displayName,
    ...(preferredName ? { preferredName } : {})
  };
}

function renderUserProfile(profile: UserProfile | null): void {
  currentUserProfile = profile;
  const hasProfile = Boolean(profile);

  userWelcomePanelBox.hidden = true;
  chatSessionNoteBox.hidden = true;
  messageList.hidden = false;
  chatForm.hidden = false;
  settingsUserDisplayNameField.value = profile?.displayName ?? "";
  settingsUserPreferredNameField.value = profile?.preferredName ?? "";
  userProfileSummaryBox.textContent = formatUserProfileSummary(profile);
  userProfileSummaryBox.dataset.state = hasProfile ? "ready" : "fallback";
  renderPartnerStatus();
  renderCompanionControlShelf();
}

async function refreshUserProfile(): Promise<void> {
  if (!window.userProfileApi) {
    renderUserProfile(null);
    setSettingsFeedback("本地身份设置不可用。");
    return;
  }

  try {
    renderUserProfile(await window.userProfileApi.getUserProfile());
  } catch {
    renderUserProfile(null);
    setSettingsFeedback("无法读取本地身份，请稍后重试。");
  }
}

async function saveUserProfileFromFields(
  displayNameField: HTMLInputElement,
  preferredNameField: HTMLInputElement,
  source: "welcome" | "settings"
): Promise<void> {
  if (!window.userProfileApi || chatTurnState.isReplying) {
    return;
  }

  const profileInput = readUserProfileFields(displayNameField, preferredNameField);

  if (!profileInput) {
    if (source === "welcome") {
      setUserWelcomeFeedback("昵称和称呼需为 1 到 32 个字符，不能包含换行或尖括号。");
    } else {
      setSettingsFeedback("昵称和称呼需为 1 到 32 个字符，不能包含换行或尖括号。", "fallback");
    }
    return;
  }

  try {
    const savedProfile = await window.userProfileApi.saveUserProfile(profileInput);
    clearUserWelcomeFeedback();
    renderUserProfile(savedProfile);
    if (source === "settings") {
      setSettingsFeedback("本地身份已保存。", "ready");
    } else {
      setChatSessionNote("本地身份已设置；之后只会把清洗后的称呼加入当前回复。", "ready");
      chatInput.focus();
    }
  } catch {
    if (source === "welcome") {
      setUserWelcomeFeedback("无法保存本地身份，请稍后重试。");
    } else {
      setSettingsFeedback("无法保存本地身份，请稍后重试。", "fallback");
    }
  }
}

function setMemorySessionStatus(count: number | null): void {
  currentMemoryInjectionCount = count;
  renderRibbonEcho();
}

function renderLatestMemoryActivityFeedback(): void {
  if (!latestMemoryActivity) {
    return;
  }

  memoryFeedbackBox.textContent = `最近活动：${latestMemoryActivity.text}`;
  memoryFeedbackBox.dataset.state = latestMemoryActivity.state;
}

function setMemoryActivity(payload: ChatMemoryActivityPayload): void {
  latestMemoryActivityPayload = payload;
  latestMemoryActivity = formatMemoryActivity(payload);
  latestMemoryActivityRequestVersion = payload.requestVersion;
  setMemorySessionStatus(payload.injection.count);
  renderDailyCompanionRhythmNote(payload.requestVersion);
  renderLatestMemoryActivityFeedback();
}

function setContextTransparency(payload: ChatContextTransparencyPayload): void {
  latestContextTransparencyPayload = payload;
  latestContextTransparency = formatContextTransparency(payload);
  latestContextTransparencyRequestVersion = payload.requestVersion;
  renderDailyCompanionRhythmNote(payload.requestVersion);
}

function renderDailyCompanionRhythmNote(requestVersion: number, phaseOverride?: "complete" | "idle"): void {
  const memoryActivity = latestMemoryActivityRequestVersion === requestVersion
    ? latestMemoryActivityPayload
    : null;
  const contextTransparency = latestContextTransparencyRequestVersion === requestVersion
    ? latestContextTransparencyPayload
    : null;
  const phase = phaseOverride ?? (chatTurnState.isReplying ? "replying" : "idle");
  const rhythm = formatDailyCompanionRhythm({
    memoryActivity,
    contextTransparency,
    activityEcho: currentActivityEcho,
    activityEchoState: currentActivityEchoState,
    phase
  });
  setChatSessionNote(rhythm.text, rhythm.state);
}

function formatMessageRoleLabel(role: ChatRole): string {
  return role === "user" ? "你" : "西塔";
}

function getVisibleMessageContent(message: ChatMessage): string {
  return message.role === "assistant"
    ? polishAssistantDisplayText(message.content)
    : message.content;
}

function appendMessage(message: ChatMessage): HTMLElement {
  const item = document.createElement("p");
  const authorClass = message.role === "user" ? "user" : "pet";
  item.className = `message message-${authorClass}`;
  const role = document.createElement("span");
  role.className = "message-role";
  role.textContent = formatMessageRoleLabel(message.role);
  const content = document.createElement("span");
  content.className = "message-content";
  content.textContent = getVisibleMessageContent(message);
  item.append(role, content);

  messageList.append(item);
  messageList.scrollTop = messageList.scrollHeight;
  return item;
}

function appendWebSearchCitations(messageElement: HTMLElement, payload?: WebSearchCitationPayload): void {
  if (!payload || payload.citations.length === 0) {
    return;
  }

  messageElement.querySelector(".message-citations")?.remove();

  const wrapper = document.createElement("span");
  wrapper.className = "message-citations selection-note";
  wrapper.dataset.state = "ready";

  const heading = document.createElement("span");
  heading.className = "message-citations-heading";
  heading.textContent = "资料来源";
  wrapper.append(heading);

  for (const citation of payload.citations.slice(0, 5)) {
    const item = document.createElement("span");
    item.className = "message-citation-item";

    const title = document.createElement(citation.url ? "a" : "span");
    title.className = "message-citation-title";
    title.textContent = citation.title;
    if (citation.url && title instanceof HTMLAnchorElement) {
      title.href = citation.url;
      title.target = "_blank";
      title.rel = "noreferrer";
    }

    const meta = document.createElement("span");
    meta.className = "message-citation-meta";
    meta.textContent = citation.domain;

    item.append(title, meta);

    if (citation.snippet) {
      const snippet = document.createElement("span");
      snippet.className = "message-citation-snippet";
      snippet.textContent = citation.snippet;
      item.append(snippet);
    }

    if (citation.url) {
      const urlText = document.createElement("span");
      urlText.className = "message-citation-url";
      urlText.textContent = citation.url;
      item.append(urlText);
    }

    wrapper.append(item);
  }

  messageElement.append(wrapper);
  messageList.scrollTop = messageList.scrollHeight;
}

function createMessage(role: ChatRole, content: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content
  };
}

function setChatSessionNote(message: string, state: "ready" | "fallback" | "error" = "fallback"): void {
  chatSessionNoteBox.hidden = false;
  chatSessionNoteBox.textContent = message;
  chatSessionNoteBox.dataset.state = state;
}

function setHistoryFeedback(message: string): void {
  historyFeedbackBox.textContent = message;
}

function formatHistoryTime(timestamp: number): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function renderCurrentConversation(): void {
  messageList.replaceChildren();
  chatHistory.forEach((message) => appendMessage(message));
}

function isSettingsRootPage(page: SettingsPageId): page is SettingsRootPageId {
  return !page.includes("-");
}

function getSettingsRootForPage(page: SettingsPageId): SettingsRootPageId {
  return isSettingsRootPage(page) ? page : settingsNestedParents[page];
}

function renderSettingsNavigation(page: SettingsPageId): void {
  const activeRoot = getSettingsRootForPage(page);

  for (const [rootPage, tab] of Object.entries(settingsRootTabs) as [SettingsRootPageId, HTMLButtonElement][]) {
    const isActive = rootPage === activeRoot;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-pressed", String(isActive));
  }

  const isNested = !isSettingsRootPage(page);
  settingsBackRowBox.hidden = !isNested;
  settingsNestedTitleBox.textContent = isNested ? settingsPageLabels[page] : "";
}

function setSettingsPage(page: SettingsPageId): void {
  activeSettingsPage = page;

  for (const [pageId, pageElement] of Object.entries(settingsPages) as [SettingsPageId, HTMLElement][]) {
    pageElement.hidden = pageId !== page;
  }

  renderSettingsNavigation(page);

  if (page === "memory") {
    void refreshMemory();
  } else if (page === "history") {
    void refreshHistoryList();
  } else if (page === "history-detail") {
    renderHistoryDetail();
  } else if (page === "memory-detail") {
    renderMemoryDetail();
  } else if (page === "model") {
    void refreshProviderStatus();
  } else if (page === "model-detail") {
    void refreshLlamaCppRuntimeStatus();
  } else if (page === "advanced") {
    void refreshWebSearchSettings();
  }
}

function setActivePage(page: "chat" | "history" | "memory"): void {
  activePage = page;
  const isChatPage = page === "chat";
  const isHistoryPage = page === "history";
  const isMemoryPage = page === "memory";
  chatPageContainer.hidden = !isChatPage;
  chatTabAction.classList.toggle("is-active", isChatPage);
  historyTabAction.classList.toggle("is-active", isHistoryPage);
  memoryTabAction.classList.toggle("is-active", isMemoryPage);

  if (isHistoryPage) {
    void openSettings("history");
  } else if (isMemoryPage) {
    void openSettings("memory");
  } else {
    closeSettings();
    chatInput.focus();
  }
}

function setMemoryFeedback(message: string): void {
  memoryFeedbackBox.textContent = message;
}

function renderMemoryInjectionPreview(): void {
  const count = memorySummary?.injectableCount ?? 0;
  const budget = memorySummary?.injectionBudget ?? 0;
  memoryNextInjectionStatusBox.textContent = memorySummary?.enabled
    ? `下次发送最多带入 ${count}/${budget} 条已启用记忆。`
    : "下次发送会注入 0 条（记忆关闭）。";
  memoryNextInjectionStatusBox.dataset.state = count > 0 ? "ready" : "fallback";
}

function renderMemoryOverview(): void {
  const summary = memorySummary;

  if (!summary) {
    memoryOverviewStatusBox.textContent = "记忆状态暂不可用。";
    memoryOverviewStatusBox.dataset.state = "fallback";
    return;
  }

  memoryOverviewStatusBox.dataset.state = summary.injectableCount > 0 ? "ready" : "fallback";

  if (!summary.enabled) {
    memoryOverviewStatusBox.textContent = `记忆关闭；本机保留 ${summary.totalCards} 条事实卡，下次不会带入记忆。`;
    return;
  }

  if (summary.totalCards === 0) {
    memoryOverviewStatusBox.textContent = "记忆已开启；目前没有事实卡，下次不会带入记忆。";
    return;
  }

  if (summary.enabledCards === 0) {
    memoryOverviewStatusBox.textContent = `记忆已开启；${summary.totalCards} 条事实卡均已停用，下次不会带入记忆。`;
    return;
  }

  memoryOverviewStatusBox.textContent = `记忆已开启；${summary.totalCards} 条事实卡，${summary.enabledCards} 条启用，下次最多带入 ${summary.injectableCount} 条。`;
}

function renderMemorySafeStats(): void {
  const summary = memorySummary;
  memorySafeStatsBox.replaceChildren();

  if (!summary) {
    memorySafeStatsBox.dataset.state = "fallback";
    memorySafeStatsBox.textContent = "安全统计暂不可用。";
    return;
  }

  memorySafeStatsBox.dataset.state = summary.injectableCount > 0 ? "ready" : "fallback";
  const autoCount = summary.sourceTypeCounts["auto-local-heuristic"] + summary.sourceTypeCounts["auto-local-model"];
  const compressedCount = summary.compressionStateCounts.merged +
    summary.compressionStateCounts.deduplicated +
    summary.compressionStateCounts.budgeted;
  const stats = [
    `关键 ${summary.importanceCounts.key}`,
    `一般 ${summary.importanceCounts.general}`,
    `自动 ${autoCount}`,
    `手动 ${summary.sourceTypeCounts["manual-chat"]}`,
    `已停用 ${summary.disabledCards}`,
    `预算排序 ${summary.compressionStateCounts.budgeted}`,
    `压缩状态 ${compressedCount}`,
    `阈值 ${summary.compressionThreshold}`
  ];

  stats.forEach((text) => {
    const pill = document.createElement("span");
    pill.textContent = text;
    memorySafeStatsBox.append(pill);
  });
}

function renderMemoryFilterTabs(): void {
  memoryFilterTabs.forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.memoryFilter === activeMemoryFilter);
  });
}

function parseTagsInput(value: string): string[] {
  return value
    .split(/[,，]/)
    .map((tag) => tag.trim())
    .filter((tag, index, tags) => tag.length > 0 && tags.indexOf(tag) === index)
    .slice(0, 8);
}

function openMemoryDraft(message: ChatMessage): void {
  if (chatTurnState.isReplying) {
    return;
  }

  memoryDraftSourceMessage = message;
  memoryDraftTitleField.value = message.content.trim().slice(0, 36) || "新的事实";
  memoryDraftContentField.value = message.content.trim();
  memoryDraftTagsField.value = "";
  memoryDraftPanelBox.hidden = false;
  memoryDraftTitleField.focus();
}

function closeMemoryDraft(): void {
  memoryDraftSourceMessage = null;
  memoryDraftPanelBox.hidden = true;
  memoryDraftTitleField.value = "";
  memoryDraftContentField.value = "";
  memoryDraftTagsField.value = "";
}

async function refreshMemory(): Promise<void> {
  if (!window.memoryApi) {
    setMemoryFeedback("本地记忆不可用。");
    return;
  }

  try {
    const [settings, summary, cards] = await Promise.all([
      window.memoryApi.getSettings(),
      window.memoryApi.getSummary(),
      window.memoryApi.listCards()
    ]);
    memoryEnabled = settings.enabled;
    memorySummary = summary;
    memoryCards = cards;
    enableMemoryAction.textContent = memoryEnabled ? "关闭记忆" : "开启记忆";
    renderMemoryOverview();
    renderMemoryInjectionPreview();
    renderMemorySafeStats();
    renderMemoryFilterTabs();
    renderMemoryList();
    renderMemoryDetail();
    setMemoryFeedback(
      memoryEnabled
        ? summary.injectableCount > 0
          ? `记忆已开启；本机会从最新用户消息提取短事实，下次最多带入 ${summary.injectableCount} 条。`
          : "记忆已开启；当前没有已启用事实卡，发送时不会加入记忆。"
        : "记忆默认关闭；关闭时不会自动生成事实卡。"
    );
    renderLatestMemoryActivityFeedback();
  } catch {
    setMemoryFeedback("无法读取本地记忆，请稍后重试。");
  }
}

function renderMemoryList(): void {
  const query = memorySearchField.value.trim().toLowerCase();
  const cards = memoryCards.filter((card) => {
    if (!matchesMemoryFilter(card)) {
      return false;
    }

    if (!query) {
      return true;
    }

    return [
      card.title,
      card.content,
      card.tags.join(" "),
      card.category,
      card.importance,
      card.sourceType
    ].some((text) => text.toLowerCase().includes(query));
  });

  memoryListElement.replaceChildren();

  if (cards.length === 0) {
    const empty = document.createElement("p");
    empty.className = "selection-note";
    empty.textContent = memoryCards.length === 0
      ? "暂无事实卡。"
      : query
        ? "没有匹配的事实卡。"
        : "当前筛选下没有事实卡。";
    memoryListElement.append(empty);
    return;
  }

  cards.forEach((card) => {
    memoryListElement.append(createMemoryCardElement(card));
  });

  if (selectedMemoryCardId && !cards.some((card) => card.id === selectedMemoryCardId)) {
    selectedMemoryCardId = null;
    renderMemoryDetail();
  }
}

function matchesMemoryFilter(card: MemoryCard): boolean {
  switch (activeMemoryFilter) {
    case "key":
      return card.importance === "key";
    case "general":
      return card.importance === "general";
    case "auto":
      return card.sourceType === "auto-local-heuristic" || card.sourceType === "auto-local-model";
    case "manual":
      return card.sourceType === "manual-chat";
    case "disabled":
      return !card.enabled;
    case "all":
    default:
      return true;
  }
}

function getMemorySourceLabel(card: MemoryCard): string {
  if (card.sourceType === "auto-local-heuristic") {
    return "本地启发式自动提取";
  }

  if (card.sourceType === "auto-local-model") {
    return "本地模型自动提取";
  }

  return "手动从聊天保存";
}

function getMemoryImportanceLabel(card: MemoryCard): string {
  return card.importance === "key" ? "关键" : "一般";
}

function getMemoryCategoryLabel(card: MemoryCard): string {
  const labels: Record<string, string> = {
    addressing: "称呼",
    language: "语言",
    interaction: "互动",
    manual: "手动",
    pet_presentation: "桌宠显示",
    project_preference: "项目偏好"
  };

  return labels[card.category] ?? card.category;
}

function getMemoryCompressionLabel(card: MemoryCard): string {
  const labels: Record<MemoryCard["compressionState"], string> = {
    raw: "原始",
    merged: "已合并",
    deduplicated: "已去重",
    budgeted: "预算排序"
  };

  return labels[card.compressionState];
}

function formatMemoryConfidence(card: MemoryCard): string {
  return `${Math.round(card.confidence * 100)}%`;
}

function createMemoryCardElement(card: MemoryCard): HTMLElement {
  const item = document.createElement("section");
  item.className = "memory-card fold-body";
  const title = document.createElement("input");
  title.className = "memory-title-input";
  title.value = card.title;
  const content = document.createElement("textarea");
  content.value = card.content;
  const tags = document.createElement("input");
  tags.value = card.tags.join("，");
  const meta = document.createElement("div");
  meta.className = "memory-card-meta selection-note";
  const status = document.createElement("span");
  status.textContent = `状态：${card.enabled ? "已启用" : "已停用"}`;
  const source = document.createElement("span");
  source.textContent = `来源：${getMemorySourceLabel(card)}`;
  const importance = document.createElement("span");
  importance.textContent = `重要性：${getMemoryImportanceLabel(card)}`;
  const category = document.createElement("span");
  category.textContent = `分类：${getMemoryCategoryLabel(card)}`;
  const confidence = document.createElement("span");
  confidence.textContent = `置信度：${formatMemoryConfidence(card)}`;
  const observed = document.createElement("span");
  observed.textContent = `观察：${card.observedCount} 次`;
  const compression = document.createElement("span");
  compression.textContent = `压缩：${getMemoryCompressionLabel(card)}`;
  const created = document.createElement("span");
  created.textContent = `创建：${formatHistoryTime(card.createdAt)}`;
  const updated = document.createElement("span");
  updated.textContent = `更新：${formatHistoryTime(card.updatedAt)}`;
  const injected = document.createElement("span");
  injected.textContent = card.lastInjectedAt
    ? `使用：${formatHistoryTime(card.lastInjectedAt)} · ${card.injectionCount} 次`
    : "使用：从未注入";
  meta.append(status, source, importance, category, confidence, observed, compression, created, updated, injected);
  const actions = document.createElement("div");
  actions.className = "history-detail-actions";
  const saveButton = document.createElement("button");
  saveButton.className = "button";
  saveButton.type = "button";
  saveButton.textContent = "保存";
  saveButton.addEventListener("click", () => {
    void updateMemoryCard(card.id, {
      title: title.value,
      content: content.value,
      tags: parseTagsInput(tags.value)
    });
  });
  const toggleButton = document.createElement("button");
  toggleButton.className = "button-light";
  toggleButton.type = "button";
  toggleButton.textContent = card.enabled ? "停用" : "启用";
  toggleButton.addEventListener("click", () => {
    void updateMemoryCard(card.id, { enabled: !card.enabled });
  });
  const detailButton = document.createElement("button");
  detailButton.className = "button-light";
  detailButton.type = "button";
  detailButton.textContent = "查看内容";
  detailButton.addEventListener("click", () => {
    selectedMemoryCardId = card.id;
    renderMemoryDetail();
    setSettingsPage("memory-detail");
  });
  const deleteButton = document.createElement("button");
  deleteButton.className = "button-danger";
  deleteButton.type = "button";
  deleteButton.textContent = "删除";
  const confirmation = document.createElement("div");
  confirmation.className = "status-box delete-confirmation";
  confirmation.hidden = true;
  confirmation.append("删除后无法恢复，是否继续？");
  const confirm = document.createElement("button");
  confirm.className = "button-danger";
  confirm.type = "button";
  confirm.textContent = "确认删除";
  confirm.addEventListener("click", () => {
    void deleteMemoryCard(card.id);
  });
  confirmation.append(confirm);
  deleteButton.addEventListener("click", () => {
    confirmation.hidden = false;
  });
  actions.append(saveButton, toggleButton, detailButton, deleteButton);
  item.append(title, content, tags, meta, actions, confirmation);
  return item;
}

function renderMemoryDetail(): void {
  memoryDetailElement.replaceChildren();
  const card = memoryCards.find((item) => item.id === selectedMemoryCardId) ?? null;

  if (!card) {
    const note = document.createElement("p");
    note.className = "selection-note";
    note.textContent = "在记忆页选择一条事实卡以查看内容。";
    memoryDetailElement.append(note);
    return;
  }

  const title = document.createElement("strong");
  title.textContent = card.title;
  const content = document.createElement("p");
  content.className = "status-box";
  content.textContent = card.content;
  const meta = document.createElement("p");
  meta.className = "selection-note";
  meta.textContent = [
    card.enabled ? "已启用" : "已停用",
    getMemorySourceLabel(card),
    getMemoryImportanceLabel(card),
    getMemoryCategoryLabel(card),
    `置信度 ${formatMemoryConfidence(card)}`,
    `观察 ${card.observedCount} 次`,
    `压缩 ${getMemoryCompressionLabel(card)}`,
    card.tags.length > 0 ? card.tags.join("，") : "无标签",
    `${formatHistoryTime(card.updatedAt)} 更新`
  ].join(" · ");
  memoryDetailElement.append(title, content, meta);
}

async function updateMemoryCard(id: string, update: Partial<MemoryCard>): Promise<void> {
  try {
    const card = await window.memoryApi?.updateCard(id, update);
    setMemoryFeedback(card ? "事实卡已更新。" : "无法更新该事实卡。");
    await refreshMemory();
  } catch {
    setMemoryFeedback("无法更新事实卡，请检查内容后重试。");
  }
}

async function deleteMemoryCard(id: string): Promise<void> {
  try {
    const deleted = await window.memoryApi?.deleteCard(id);
    setMemoryFeedback(deleted ? "事实卡已删除，无法恢复。" : "该事实卡已不存在。");
    await refreshMemory();
  } catch {
    setMemoryFeedback("无法删除事实卡，请稍后重试。");
  }
}

function renderHistoryList(conversations: ConversationSummary[]): void {
  conversationListElement.replaceChildren();

  if (conversations.length === 0) {
    const item = document.createElement("li");
    item.className = "conversation-item";
    item.textContent = "暂无本地历史";
    conversationListElement.append(item);
    return;
  }

  conversations.forEach((conversation) => {
    const item = document.createElement("li");
    item.className = "conversation-item";
    const button = document.createElement("button");
    button.className = "conversation-select";
    button.type = "button";
    button.classList.toggle("is-selected", selectedHistoryConversation?.id === conversation.id);
    button.textContent = conversation.title;
    button.addEventListener("click", () => {
      void selectHistoryConversation(conversation.id);
    });
    const meta = document.createElement("span");
    meta.className = "conversation-meta";
    meta.textContent = `${formatHistoryTime(conversation.updatedAt)} · ${conversation.messageCount} 条`;
    button.append(meta);
    item.append(button);
    conversationListElement.append(item);
  });
}

function renderHistoryDetail(): void {
  historyDetailElement.replaceChildren();

  if (!selectedHistoryConversation) {
    const note = document.createElement("p");
    note.className = "selection-note";
    note.textContent = "选择一段历史以查看内容。";
    historyDetailElement.append(note);
    return;
  }

  const title = document.createElement("strong");
  title.textContent = selectedHistoryConversation.title;
  const boundary = document.createElement("p");
  boundary.className = "selection-note";
  boundary.textContent = "打开历史只恢复本地界面；只有选择“继续发送给当前 Provider”后，下一条消息才会携带此会话上下文。";
  const contextPreview = document.createElement("p");
  const contextPreviewPresentation = formatHistoryContextPreview({
    messageCount: selectedHistoryConversation.messages.length
  });
  contextPreview.id = "history-context-preview";
  contextPreview.className = "status-box";
  contextPreview.dataset.state = contextPreviewPresentation.state;
  contextPreview.textContent = contextPreviewPresentation.text;
  const messageItems = document.createElement("ol");
  messageItems.className = "history-message-list";

  selectedHistoryConversation.messages.forEach((message) => {
    const item = document.createElement("li");
    item.className = "history-message";
    const role = document.createElement("span");
    role.className = "history-message-role";
    role.textContent = `${message.role === "user" ? "你" : "桌宠"} · ${formatHistoryTime(message.createdAt)}`;
    const content = document.createElement("span");
    content.textContent = message.content;
    item.append(role, content);
    messageItems.append(item);
  });

  const actions = document.createElement("div");
  actions.className = "history-detail-actions";
  const openButton = document.createElement("button");
  openButton.className = "button-light";
  openButton.type = "button";
  openButton.textContent = "打开历史";
  openButton.addEventListener("click", () => restoreSelectedHistory(false));
  const continueButton = document.createElement("button");
  continueButton.className = "button";
  continueButton.type = "button";
  continueButton.textContent = "继续发送给当前 Provider";
  continueButton.addEventListener("click", () => restoreSelectedHistory(true));
  const deleteButton = document.createElement("button");
  deleteButton.className = "button-danger";
  deleteButton.type = "button";
  deleteButton.textContent = "删除此会话";
  const confirmation = document.createElement("div");
  confirmation.className = "status-box delete-confirmation";
  confirmation.hidden = true;
  const confirmationText = document.createElement("span");
  confirmationText.textContent = "删除后无法恢复，是否继续？";
  const confirmationActions = document.createElement("span");
  confirmationActions.className = "inline-actions";
  const cancelButton = document.createElement("button");
  cancelButton.className = "button-light";
  cancelButton.type = "button";
  cancelButton.textContent = "取消";
  cancelButton.addEventListener("click", () => {
    confirmation.hidden = true;
  });
  const confirmButton = document.createElement("button");
  confirmButton.className = "button-danger";
  confirmButton.type = "button";
  confirmButton.textContent = "确认删除";
  confirmButton.addEventListener("click", () => {
    void deleteSelectedHistoryConversation();
  });
  confirmationActions.append(cancelButton, confirmButton);
  confirmation.append(confirmationText, confirmationActions);
  deleteButton.addEventListener("click", () => {
    confirmation.hidden = false;
  });
  actions.append(openButton, continueButton, deleteButton);
  historyDetailElement.append(title, boundary, contextPreview, messageItems, actions, confirmation);
}

async function refreshHistoryList(): Promise<void> {
  if (!window.historyApi) {
    setHistoryFeedback("本地历史不可用。");
    return;
  }

  try {
    const conversations = await window.historyApi.listConversations();

    if (!conversations.some((conversation) => conversation.id === selectedHistoryConversation?.id)) {
      selectedHistoryConversation = null;
      renderHistoryDetail();
    }

    renderHistoryList(conversations);
  } catch {
    setHistoryFeedback("无法读取本地历史，请稍后重试。");
  }
}

async function selectHistoryConversation(id: string): Promise<void> {
  if (!window.historyApi) {
    return;
  }

  try {
    const conversation = await window.historyApi.getConversation(id);

    if (!conversation) {
      setHistoryFeedback("该会话已不存在。");
      await refreshHistoryList();
      return;
    }

    selectedHistoryConversation = conversation;
    renderHistoryDetail();
    await refreshHistoryList();
    setSettingsPage("history-detail");
  } catch {
    setHistoryFeedback("无法打开该会话，请稍后重试。");
  }
}

function restoreSelectedHistory(includeProviderContext: boolean): void {
  if (!selectedHistoryConversation || chatTurnState.isReplying) {
    return;
  }

  conversationId = selectedHistoryConversation.id;
  chatHistory.splice(0, chatHistory.length, ...selectedHistoryConversation.messages.map(({ id, role, content }) => ({ id, role, content })));
  providerContextEnabled = includeProviderContext;
  renderCurrentConversation();
  setChatSessionNote(
    includeProviderContext
      ? "已明确继续：下一条消息将携带当前会话上下文发送给当前 Provider。"
      : "已仅在本地打开历史：下一条消息只发送当前消息，不会自动发送历史内容。",
    "ready"
  );
  setActivePage("chat");
}

function startNewConversation(): void {
  if (chatTurnState.isReplying) {
    return;
  }

  conversationId = crypto.randomUUID();
  chatHistory.splice(0, chatHistory.length);
  providerContextEnabled = true;
  renderCurrentConversation();
  setChatSessionNote("已新建本地会话；下一条消息将携带当前会话上下文发送给当前 Provider。", "ready");
  setMemorySessionStatus(null);
  setActivePage("chat");
}

async function deleteSelectedHistoryConversation(): Promise<void> {
  if (!selectedHistoryConversation || !window.historyApi) {
    return;
  }

  try {
    const deleted = await window.historyApi.deleteConversation(selectedHistoryConversation.id);

    if (!deleted) {
      setHistoryFeedback("该会话已不存在。");
    } else {
      setHistoryFeedback("会话已从本机删除，无法恢复。");
    }

    selectedHistoryConversation = null;
    renderHistoryDetail();
    await refreshHistoryList();
  } catch {
    setHistoryFeedback("无法删除会话，请稍后重试。");
  }
}

function setReplying(isReplying: boolean): void {
  const lockState = createReplyInteractionLockState(isReplying);

  for (const controlState of lockState.controls) {
    replyLockControlElements[controlState.controlId].disabled = controlState.disabled;
  }

  sendAction.textContent = isReplying ? "停止" : "发送";
  sendAction.classList.toggle("button", !isReplying);
  sendAction.classList.toggle("button-danger", isReplying);
  sendAction.disabled = false;
  abortAction.hidden = true;

  historyDetailElement.querySelectorAll<HTMLButtonElement>("button").forEach((control) => {
    control.disabled = lockState.groupsDisabled;
  });
  providerSettingsForm.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input, select, button")
    .forEach((control) => {
      control.disabled = lockState.groupsDisabled;
    });

  if (isReplying) {
    setChatLifecycleEcho("正在回复");
    const note = formatChatTurnFinish("正在回复");
    setChatSessionNote(note.sessionNote, note.sessionNoteState);
  }
}

function finishReplying(requestVersion: number, activityEcho: ChatTurnLifecycleEcho = "回复完成"): void {
  const result = finishChatTurn(chatTurnState, requestVersion, activityEcho);

  if (!result.accepted) {
    return;
  }

  chatTurnState = result.state;
  activeReplyMessage = null;
  activeReplyElement = null;
  setReplying(false);
  setChatLifecycleEcho(result.lifecycleEcho);
  setChatSessionNote(result.sessionNote, result.sessionNoteState);
  if (activityEcho === "回复完成") {
    renderDailyCompanionRhythmNote(requestVersion, "complete");
  }
  chatInput.focus();
}

async function refreshProviderStatus(): Promise<void> {
  try {
    const status = await window.configApi?.getProviderStatus();

    if (status) {
      setProviderStatus(status);
      return;
    }
  } catch {
  }

  providerStatusBox.dataset.state = "fallback";
  providerStatusBox.textContent = "模型状态不可用";
}

function setSettingsFeedback(message: string, state: "ready" | "fallback" = "fallback"): void {
  settingsFeedbackBox.hidden = false;
  settingsFeedbackBox.dataset.state = state;
  settingsFeedbackBox.textContent = message;
}

function clearSettingsFeedback(): void {
  settingsFeedbackBox.hidden = true;
  settingsFeedbackBox.textContent = "";
  delete settingsFeedbackBox.dataset.state;
}

function setPetScaleValue(petScale: number): void {
  currentPetScale = petScale;
  petScaleField.value = petScale.toFixed(2);
  petScaleValueBox.value = `${petScale.toFixed(2)} 倍`;
  renderCompanionControlShelf();
}

const PET_ACCESSORY_GROUP_LABELS: Record<PetAccessoryGroup, string> = {
  companion: "伙伴",
  attire: "服饰",
  facewear: "面部",
  headwear: "头部",
  "held-prop": "手持"
};

function formatPetAccessorySelection(ids: readonly PetAccessoryId[]): string {
  const labels = ids.map((id) => PET_ACCESSORY_CATALOG.find((item) => item.id === id)?.label).filter(Boolean);
  return labels.length > 0 ? labels.join(" · ") : "无配件";
}

function renderPetAccessoryGroups(): void {
  const selectedIds = new Set(currentPetAccessoryIds);
  const groups = PET_ACCESSORY_GROUPS.map((group) => {
    const fieldset = document.createElement("fieldset");
    fieldset.className = "pet-accessory-group";

    const legend = document.createElement("legend");
    legend.textContent = PET_ACCESSORY_GROUP_LABELS[group];
    fieldset.append(legend);

    const options = document.createElement("div");
    options.className = "pet-accessory-options";
    const groupName = `pet-accessory-${group}`;
    const items = PET_ACCESSORY_CATALOG.filter((item) => item.group === group && item.availability === "available");

    for (const item of [null, ...items]) {
      const choice = document.createElement("label");
      choice.className = "pet-accessory-choice";

      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = groupName;
      radio.value = item?.id ?? "none";
      radio.checked = item ? selectedIds.has(item.id) : !items.some((availableItem) => selectedIds.has(availableItem.id));

      const label = document.createElement("span");
      label.textContent = item?.label ?? "无";
      choice.append(radio, label);
      options.append(choice);
    }

    fieldset.append(options);
    return fieldset;
  });

  petAccessoryGroupsBox.replaceChildren(...groups);
}

function getPetAccessorySelectionFromFields(): PetAccessoryId[] | null {
  const selectedIds = [...petAccessoryGroupsBox.querySelectorAll<HTMLInputElement>("input[type=radio]:checked")]
    .map((field) => field.value)
    .filter((value) => value !== "none");
  return parsePetAccessorySelection(selectedIds);
}

function setPetAccessorySelection(ids: readonly PetAccessoryId[]): void {
  currentPetAccessoryIds = [...ids];
  renderPetAccessoryGroups();
  petAccessoryStatusBox.textContent = `已保存配件：${formatPetAccessorySelection(ids)}`;
  petAccessoryStatusBox.dataset.state = ids.length > 0 ? "ready" : "fallback";
  renderCompanionControlShelf();
}

async function refreshPetPresentationPreferences(): Promise<void> {
  const preferences = await window.petPresentationApi?.getPreferences();

  if (!preferences) {
    throw new Error("Pet presentation API unavailable");
  }

  setPetScaleValue(preferences.petScale);
  setPetAccessorySelection(preferences.accessoryIds);
}

function setPetLockState(nextIsLocked: boolean): void {
  isPetLocked = nextIsLocked;
  petLockStatusBox.textContent = `桌宠锁定：${isPetLocked ? "已锁定，点击可穿透" : "未锁定"}`;
  petLockStatusBox.dataset.state = isPetLocked ? "ready" : "fallback";
  togglePetLockAction.textContent = isPetLocked ? "解除锁定" : "锁定桌宠";
  renderCompanionControlShelf();
}

async function refreshPetLockState(): Promise<void> {
  const state = await window.petPresentationApi?.getPetLockState();

  if (!state) {
    throw new Error("Pet lock API unavailable");
  }

  setPetLockState(state.isLocked);
}

function setShortcutStatus(message: string, state: "ready" | "fallback" = "fallback"): void {
  shortcutStatusBox.hidden = false;
  shortcutStatusBox.dataset.state = state;
  shortcutStatusBox.textContent = message;
}

function clearShortcutStatus(): void {
  shortcutStatusBox.hidden = true;
  shortcutStatusBox.textContent = "";
  delete shortcutStatusBox.dataset.state;
}

function clearPendingWheelModifierRecording(): void {
  if (pendingWheelModifierRecordTimeout !== null) {
    window.clearTimeout(pendingWheelModifierRecordTimeout);
    pendingWheelModifierRecordTimeout = null;
  }
}

function formatShortcutAccelerator(shortcut: ShortcutPreferenceView): string {
  return shortcut.kind === "wheelModifier"
    ? `${shortcut.accelerator}+Wheel`
    : shortcut.accelerator;
}

function renderShortcutList(): void {
  shortcutListElement.replaceChildren();

  for (const shortcut of shortcutViews) {
    const row = document.createElement("article");
    row.className = "shortcut-row";

    const copy = document.createElement("div");
    const title = document.createElement("p");
    title.className = "shortcut-title";
    title.textContent = shortcut.label;

    const description = document.createElement("p");
    description.className = "shortcut-description";
    description.textContent = shortcut.description;

    copy.append(title, description);

    const actions = document.createElement("div");
    actions.className = "shortcut-actions";

    const accelerator = document.createElement("span");
    accelerator.className = "status-box shortcut-accelerator";
    accelerator.dataset.state = shortcut.isDefault ? "fallback" : "ready";
    accelerator.textContent = recordingShortcutActionId === shortcut.id
      ? shortcut.kind === "wheelModifier" ? "等待修饰键" : "等待按键"
      : formatShortcutAccelerator(shortcut);

    const recordButton = document.createElement("button");
    recordButton.className = "button-light";
    recordButton.type = "button";
    recordButton.textContent = recordingShortcutActionId === shortcut.id ? "取消录入" : "录入快捷键";
    recordButton.addEventListener("click", () => {
      clearPendingWheelModifierRecording();
      recordingShortcutActionId = recordingShortcutActionId === shortcut.id ? null : shortcut.id;
      setShortcutStatus(
        recordingShortcutActionId
          ? shortcut.kind === "wheelModifier" ? "请按下新的滚轮缩放修饰键组合。" : "请按下新的快捷键组合。"
          : "已取消快捷键录入。",
        recordingShortcutActionId ? "ready" : "fallback"
      );
      renderShortcutList();
    });

    const resetButton = document.createElement("button");
    resetButton.className = "button-light";
    resetButton.type = "button";
    resetButton.textContent = "恢复默认";
    resetButton.disabled = shortcut.isDefault;
    resetButton.addEventListener("click", () => {
      void resetShortcut(shortcut.id);
    });

    actions.append(accelerator, recordButton, resetButton);
    row.append(copy, actions);
    shortcutListElement.append(row);
  }
}

async function refreshShortcuts(): Promise<void> {
  const shortcuts = await window.shortcutApi?.listShortcuts();

  if (!shortcuts) {
    throw new Error("Shortcut API unavailable");
  }

  shortcutViews = shortcuts;
  renderShortcutList();
}

function eventToAccelerator(event: KeyboardEvent): string | null {
  if (event.isComposing || event.key === "Process") {
    return null;
  }

  const keyMap: Record<string, string> = {
    " ": "Space",
    Esc: "Escape",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right"
  };
  const key = keyMap[event.key] ?? (event.key.length === 1 ? event.key.toUpperCase() : event.key);

  if (key === "Control" || key === "Shift" || key === "Alt" || key === "Meta") {
    return null;
  }

  const parts: string[] = [];

  if (event.ctrlKey) {
    parts.push("Ctrl");
  }

  if (event.altKey) {
    parts.push("Alt");
  }

  if (event.shiftKey) {
    parts.push("Shift");
  }

  if (event.metaKey) {
    parts.push("Meta");
  }

  parts.push(key);
  return parts.join("+");
}

function eventToWheelModifierAccelerator(event: KeyboardEvent): string | null {
  if (event.isComposing || event.key === "Process") {
    return null;
  }

  const parts: string[] = [];

  if (event.ctrlKey || event.key === "Control") {
    parts.push("Ctrl");
  }

  if (event.altKey || event.key === "Alt") {
    parts.push("Alt");
  }

  if (event.shiftKey || event.key === "Shift") {
    parts.push("Shift");
  }

  if (event.metaKey || event.key === "Meta") {
    parts.push("Meta");
  }

  return parts.length > 0 ? parts.join("+") : null;
}

async function saveRecordedShortcut(actionId: ShortcutActionId, accelerator: string): Promise<void> {
  if (!window.shortcutApi) {
    setShortcutStatus("快捷键设置不可用。", "fallback");
    return;
  }

  const result = await window.shortcutApi.updateShortcut(actionId, accelerator);
  shortcutViews = result.shortcuts;
  clearPendingWheelModifierRecording();
  recordingShortcutActionId = null;
  renderShortcutList();

  if (result.ok) {
    setShortcutStatus("快捷键已保存。", "ready");
  } else {
    setShortcutStatus(result.reason, "fallback");
  }
}

async function resetShortcut(actionId: ShortcutActionId): Promise<void> {
  if (!window.shortcutApi) {
    setShortcutStatus("快捷键设置不可用。", "fallback");
    return;
  }

  const result = await window.shortcutApi.resetShortcut(actionId);
  shortcutViews = result.shortcuts;
  clearPendingWheelModifierRecording();
  recordingShortcutActionId = null;
  renderShortcutList();
  setShortcutStatus(result.ok ? "快捷键已恢复默认。" : result.reason, result.ok ? "ready" : "fallback");
}

function isOpenAICompatibleSelected(): boolean {
  return providerIdField.value === "openai-compatible";
}

function isLocalOpenAICompatibleSelected(): boolean {
  return providerIdField.value === "local-openai-compatible";
}

function isProviderWithOpenAIFieldsSelected(): boolean {
  return isOpenAICompatibleSelected() || isLocalOpenAICompatibleSelected();
}

function isLocalProviderPresetId(value: string): value is LocalProviderPresetId {
  return value === "embedded-llama-cpp" ||
    value === "ollama" ||
    value === "lm-studio" ||
    value === "custom-local";
}

function getLocalProviderPreset(id: LocalProviderPresetId) {
  const preset = LOCAL_PROVIDER_PRESETS.find((item) => item.id === id);

  if (preset) {
    return preset;
  }

  return {
    id: DEFAULT_LOCAL_OPENAI_CONFIG.localPresetId,
    label: "内置本地模型",
    displayName: DEFAULT_LOCAL_OPENAI_CONFIG.displayName,
    baseURL: DEFAULT_LOCAL_OPENAI_CONFIG.baseURL
  };
}

function inferLocalProviderPresetId(config: ProviderConfig): LocalProviderPresetId {
  if (config.providerId === "local-openai-compatible" && config.localPresetId) {
    return config.localPresetId;
  }

  if (config.providerId === "local-openai-compatible") {
    const matchedPreset = LOCAL_PROVIDER_PRESETS.find((preset) => (
      preset.baseURL.length > 0 && preset.baseURL === config.baseURL
    ));

    return matchedPreset?.id ?? "custom-local";
  }

  return DEFAULT_LOCAL_OPENAI_CONFIG.localPresetId;
}

function getSelectedLocalProviderPresetId(): LocalProviderPresetId {
  return isLocalProviderPresetId(localProviderPresetField.value)
    ? localProviderPresetField.value
    : DEFAULT_LOCAL_OPENAI_CONFIG.localPresetId;
}

function applyLocalProviderPreset(presetId: LocalProviderPresetId): void {
  const preset = getLocalProviderPreset(presetId);
  localProviderPresetField.value = preset.id;

  if (preset.baseURL) {
    baseURLField.value = preset.baseURL;
    displayNameField.value = preset.displayName;
  } else if (!displayNameField.value.trim()) {
    displayNameField.value = preset.displayName;
  }

  resetProviderHealthStatus();
  resetLocalModelDiagnosticSummary();
}

function updateProviderFields(): void {
  const hasOpenAIFields = isProviderWithOpenAIFieldsSelected();
  const isLocalOpenAI = isLocalOpenAICompatibleSelected();
  openAIFieldsContainer.hidden = !hasOpenAIFields;
  connectionSafeSectionBox.hidden = true;
  localProviderPresetFieldBox.hidden = !isLocalOpenAI;
  localProviderNoteBox.hidden = !isLocalOpenAI;
  localModelDiagnosticSectionBox.hidden = !isLocalOpenAI;
  llamaCppRuntimeSectionBox.hidden = !isLocalOpenAI;
  providerHealthCheckAction.hidden = !hasOpenAIFields;
  providerHealthStatusBox.hidden = !hasOpenAIFields;
  baseURLField.required = hasOpenAIFields;
  modelField.required = hasOpenAIFields;
  temperatureField.required = hasOpenAIFields;
  maxTokensField.required = hasOpenAIFields;
  timeoutField.required = hasOpenAIFields;
  deleteKeyConfirmationBox.hidden = true;
}

function fillOpenAIDefaults(): void {
  displayNameField.value = DEFAULT_OPENAI_CONFIG.displayName;
  baseURLField.value = DEFAULT_OPENAI_CONFIG.baseURL;
  modelField.value = DEFAULT_OPENAI_CONFIG.model;
  temperatureField.value = String(DEFAULT_OPENAI_CONFIG.temperature);
  maxTokensField.value = String(DEFAULT_OPENAI_CONFIG.maxTokens);
  timeoutField.value = String(DEFAULT_OPENAI_CONFIG.timeoutMs);
  resetProviderHealthStatus();
  resetLocalModelDiagnosticSummary();
}

function fillLocalOpenAIDefaults(): void {
  displayNameField.value = DEFAULT_LOCAL_OPENAI_CONFIG.displayName;
  baseURLField.value = DEFAULT_LOCAL_OPENAI_CONFIG.baseURL;
  modelField.value = DEFAULT_LOCAL_OPENAI_CONFIG.model;
  localProviderPresetField.value = DEFAULT_LOCAL_OPENAI_CONFIG.localPresetId;
  temperatureField.value = String(DEFAULT_LOCAL_OPENAI_CONFIG.temperature);
  maxTokensField.value = String(DEFAULT_LOCAL_OPENAI_CONFIG.maxTokens);
  timeoutField.value = String(DEFAULT_LOCAL_OPENAI_CONFIG.timeoutMs);
  resetProviderHealthStatus();
  resetLocalModelDiagnosticSummary();
}

function fillProviderForm(config: ProviderConfig): void {
  const formConfig = config.providerId === "openai-compatible"
    ? RECOMMENDED_LOCAL_PROVIDER_CONFIG
    : config;

  providerIdField.value = formConfig.providerId;
  displayNameField.value = formConfig.displayName;

  if (formConfig.providerId === "local-openai-compatible") {
    baseURLField.value = formConfig.baseURL;
    modelField.value = formConfig.model;
    temperatureField.value = String(formConfig.temperature);
    maxTokensField.value = String(formConfig.maxTokens);
    timeoutField.value = String(formConfig.timeoutMs);
  }

  if (formConfig.providerId === "local-openai-compatible") {
    localProviderPresetField.value = inferLocalProviderPresetId(formConfig);
  } else {
    localProviderPresetField.value = DEFAULT_LOCAL_OPENAI_CONFIG.localPresetId;
  }

  apiKeyField.value = "";
  updateProviderFields();
  resetProviderHealthStatus();
  resetLocalModelDiagnosticSummary();
}

function getApiKeyRef(): string {
  return DEFAULT_API_KEY_REF;
}

async function refreshApiKeyStatus(): Promise<void> {
  try {
    const isConfigured = await window.configApi?.hasApiKey({ apiKeyRef: getApiKeyRef() });
    apiKeyStatusBox.textContent = `API Key：${isConfigured ? "已配置" : "未配置"}`;
    apiKeyStatusBox.dataset.state = isConfigured ? "ready" : "fallback";
  } catch {
    apiKeyStatusBox.textContent = "API Key：状态不可用";
    apiKeyStatusBox.dataset.state = "fallback";
  }
}

async function openSettings(page: SettingsPageId = "basic"): Promise<void> {
  if (chatTurnState.isReplying) {
    return;
  }

  clearSettingsFeedback();
  deleteKeyConfirmationBox.hidden = true;
  providerSettingsPanel.hidden = false;
  chatPageContainer.hidden = true;
  setSettingsPage(page);
  window.chatApi?.setInteractionActive(true);

  try {
    if (window.configApi) {
      const config = await window.configApi.getProvider();
      fillProviderForm(config);
      await refreshApiKeyStatus();
      if (activeSettingsPage === "model-detail") {
        await refreshLlamaCppRuntimeStatus();
      }
    } else {
      setProviderHealthStatus("Provider 设置不可用。", "fallback");
    }

    await Promise.allSettled([
      refreshPetPresentationPreferences(),
      refreshPetLockState(),
      refreshShortcuts(),
      refreshUserProfile(),
      refreshMemory(),
      refreshHistoryList()
    ]);
  } catch {
    setSettingsFeedback("无法读取当前设置，请稍后重试。");
  }
}

function closeSettings(): void {
  providerSettingsPanel.hidden = true;
  chatPageContainer.hidden = false;
  deleteKeyConfirmationBox.hidden = true;
  apiKeyField.value = "";
  recordingShortcutActionId = null;
  clearPendingWheelModifierRecording();
  clearShortcutStatus();
  renderShortcutList();
  clearSettingsFeedback();
  window.chatApi?.setInteractionActive(false);
}

function parseNonEmptyString(field: HTMLInputElement, fieldName: string): string | null {
  const value = field.value.trim();

  if (!value) {
    setSettingsFeedback(`${fieldName}不能为空。`);
    return null;
  }

  return value;
}

function parseFiniteNumber(field: HTMLInputElement, fieldName: string): number | null {
  const value = Number(field.value);

  if (field.value.trim() === "" || !Number.isFinite(value)) {
    setSettingsFeedback(`${fieldName}必须是有效数值。`);
    return null;
  }

  return value;
}

function parsePositiveInteger(field: HTMLInputElement, fieldName: string): number | null {
  const value = Number(field.value);

  if (field.value.trim() === "" || !Number.isInteger(value) || value <= 0) {
    setSettingsFeedback(`${fieldName}必须是正整数。`);
    return null;
  }

  return value;
}

function buildProviderConfig(): ProviderConfig | null {
  const displayName = parseNonEmptyString(displayNameField, "显示名称");

  if (!displayName) {
    return null;
  }

  if (!isProviderWithOpenAIFieldsSelected()) {
    return { providerId: "fake", displayName };
  }

  const baseURL = parseNonEmptyString(baseURLField, "Base URL");
  const model = parseNonEmptyString(modelField, "模型");
  const temperature = parseFiniteNumber(temperatureField, "温度");
  const maxTokens = parsePositiveInteger(maxTokensField, "最大 Token");
  const timeoutMs = parsePositiveInteger(timeoutField, "超时时间");

  if (!baseURL || !model || temperature === null || maxTokens === null || timeoutMs === null) {
    return null;
  }

  try {
    const url = new URL(baseURL);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
  } catch {
    setSettingsFeedback("Base URL 必须是有效的 HTTP(S) 地址。");
    return null;
  }

  if (isLocalOpenAICompatibleSelected()) {
    return {
      providerId: "local-openai-compatible",
      displayName,
      baseURL,
      model,
      localPresetId: getSelectedLocalProviderPresetId(),
      temperature,
      maxTokens,
      timeoutMs
    };
  }

  setSettingsFeedback("外部对话模型已停用；请使用内置本地模型，联网资料通过 MCP 搜索提供。");
  return null;
}

function buildProviderHealthRequest(): ProviderHealthCheckRequest | null {
  if (!isProviderWithOpenAIFieldsSelected()) {
    setProviderHealthStatus("Fake Provider 不需要连接检查。", "fallback");
    return null;
  }

  const baseURL = parseNonEmptyString(baseURLField, "Base URL");
  const model = parseNonEmptyString(modelField, "模型");
  const timeoutMs = parsePositiveInteger(timeoutField, "超时时间");

  if (!baseURL || !model || timeoutMs === null) {
    return null;
  }

  try {
    const url = new URL(baseURL);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error("unsupported protocol");
    }
  } catch {
    setProviderHealthStatus("Base URL 必须是有效的 HTTP(S) 地址。", "fallback");
    return null;
  }

  if (isLocalOpenAICompatibleSelected()) {
    return {
      providerId: "local-openai-compatible",
      baseURL,
      model,
      timeoutMs,
      localPresetId: getSelectedLocalProviderPresetId()
    };
  }

  setProviderHealthStatus("外部对话模型已停用；请检查本地模型连接。", "fallback");
  return null;
}

window.chatApi?.onReplyDelta((delta) => {
  const result = applyChatTurnDelta(chatTurnState, delta.requestVersion, delta.text);

  if (!result.accepted || !activeReplyMessage || !activeReplyElement) {
    return;
  }

  chatTurnState = result.state;
  activeReplyMessage.content = result.content;
  const content = activeReplyElement.querySelector<HTMLElement>(".message-content") ?? activeReplyElement;
  content.textContent = polishAssistantDisplayText(activeReplyMessage.content);
  messageList.scrollTop = messageList.scrollHeight;
});

window.chatApi?.onReplyDone((reply) => {
  if (!shouldAcceptChatTurnEvent(chatTurnState, reply.requestVersion)) {
    return;
  }

  if (activeReplyElement) {
    appendWebSearchCitations(activeReplyElement, reply.webSearchCitation);
  }

  finishReplying(reply.requestVersion);
});

window.chatApi?.onReplyError((error) => {
  if (!shouldAcceptChatTurnEvent(chatTurnState, error.requestVersion)) {
    return;
  }

  if (activeReplyMessage && activeReplyElement) {
    const index = chatHistory.findIndex((message) => message.id === activeReplyMessage?.id);

    if (index >= 0) {
      chatHistory.splice(index, 1);
    }

    activeReplyElement.remove();
  }

  const wasAborted = error.errorType === "aborted";
  finishReplying(error.requestVersion, wasAborted ? "已中断" : "回复失败");
  setChatSessionNote(
    error.message || (wasAborted ? "这轮先停在这里，未完成的回复不会保存。" : "她暂时没接上模型，稍后再试或检查连接。"),
    wasAborted ? "fallback" : "error"
  );
});

window.chatApi?.onMemoryInjection((payload) => {
  if (!shouldAcceptChatTurnEvent(chatTurnState, payload.requestVersion)) {
    return;
  }

  setMemorySessionStatus(payload.count);
});

window.chatApi?.onMemoryActivity((payload) => {
  if (!shouldAcceptChatTurnEvent(chatTurnState, payload.requestVersion)) {
    return;
  }

  setMemoryActivity(payload);
});

window.chatApi?.onContextTransparency((payload) => {
  if (!shouldAcceptChatTurnEvent(chatTurnState, payload.requestVersion)) {
    return;
  }

  setContextTransparency(payload);
});

window.chatApi?.onPetActivityEcho((echo) => {
  setPetActivityEcho(echo.message);
});

window.petPresentationApi?.onPetLockChanged((state) => {
  setPetLockState(state.isLocked);
});

window.proactiveCompanionApi?.onSettingsChanged((settings) => {
  renderProactiveCompanionSettings(settings);
});

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();

  if (chatTurnState.isReplying) {
    window.chatApi?.abortReply();
    return;
  }

  const text = chatInput.value.trim();

  if (!text) {
    return;
  }

  const userMessage = createMessage("user", text);
  chatHistory.push(userMessage);
  const requestMessages = providerContextEnabled ? [...chatHistory] : [userMessage];
  appendMessage(userMessage);

  const replyMessage = createMessage("assistant", "");
  chatHistory.push(replyMessage);
  const replyElement = appendMessage(replyMessage);

  chatInput.value = "";
  const startedTurn = startChatTurn(chatTurnState, replyMessage.id);

  chatTurnState = startedTurn.state;
  activeReplyMessage = replyMessage;
  activeReplyElement = replyElement;
  setMemorySessionStatus(null);
  setReplying(true);

  window.chatApi?.sendMessage({
    requestVersion: startedTurn.requestVersion,
    conversationId,
    messages: requestMessages
  });
});

chatInput.addEventListener("focus", () => {
  if (providerSettingsPanel.hidden) {
    window.chatApi?.setInteractionActive(true);
  }
});

chatInput.addEventListener("blur", () => {
  if (providerSettingsPanel.hidden) {
    window.chatApi?.setInteractionActive(false);
  }
});

abortAction.addEventListener("click", () => {
  window.chatApi?.abortReply();
});

settingsAction.addEventListener("click", () => {
  void openSettings("basic");
});

shelfAccessoryAction.addEventListener("click", () => {
  void openSettings("appearance").then(() => {
    petAccessoryGroupsBox.querySelector<HTMLInputElement>("input[type=radio]:checked")?.focus();
  });
});

shelfScaleAction.addEventListener("click", () => {
  void openSettings("appearance").then(() => {
    petScaleField.focus();
  });
});

shelfLockAction.addEventListener("click", () => {
  if (chatTurnState.isReplying || !window.petPresentationApi) {
    return;
  }

  void window.petPresentationApi.setPetLocked(!isPetLocked).then((state) => {
    setPetLockState(state.isLocked);
    setChatSessionNote(state.isLocked ? "桌宠已锁定，点击会穿透到后方窗口。" : "桌宠已解除锁定。", "ready");
  }).catch(() => {
    setChatSessionNote("无法切换桌宠锁定，请稍后重试。", "error");
  });
});

welcomeSaveUserProfileAction.addEventListener("click", () => {
  void saveUserProfileFromFields(welcomeUserDisplayNameField, welcomeUserPreferredNameField, "welcome");
});

saveUserProfileAction.addEventListener("click", () => {
  void saveUserProfileFromFields(settingsUserDisplayNameField, settingsUserPreferredNameField, "settings");
});

clearUserProfileAction.addEventListener("click", () => {
  if (!window.userProfileApi || chatTurnState.isReplying) {
    return;
  }

  void window.userProfileApi.clearUserProfile().then(() => {
    settingsUserDisplayNameField.value = "";
    settingsUserPreferredNameField.value = "";
    welcomeUserDisplayNameField.value = "";
    welcomeUserPreferredNameField.value = "";
    renderUserProfile(null);
    setSettingsFeedback("本地身份已清除。", "ready");
    settingsUserDisplayNameField.focus();
  }).catch(() => {
    setSettingsFeedback("无法清除本地身份，请稍后重试。", "fallback");
  });
});

settingsBackAction.addEventListener("click", () => {
  setSettingsPage(getSettingsRootForPage(activeSettingsPage));
});

for (const [page, tab] of Object.entries(settingsRootTabs) as [SettingsRootPageId, HTMLButtonElement][]) {
  tab.addEventListener("click", () => {
    setSettingsPage(page);
  });
}

settingsModelDetailAction.addEventListener("click", () => {
  setSettingsPage("model-detail");
});

llamaCppRuntimeSaveAction.addEventListener("click", () => {
  if (!chatTurnState.isReplying) {
    void saveLlamaCppRuntimeSettings();
  }
});

llamaCppRuntimeExecutableAction.addEventListener("click", () => {
  if (!window.localRuntimeApi) {
    setLlamaCppRuntimeStatus("托管 llama.cpp 设置不可用。", "fallback");
    return;
  }

  void runLlamaCppRuntimeAction(
    () => window.localRuntimeApi!.chooseLlamaCppExecutable(),
    "正在选择运行文件..."
  );
});

llamaCppRuntimeModelAction.addEventListener("click", () => {
  if (!window.localRuntimeApi) {
    setLlamaCppRuntimeStatus("托管 llama.cpp 设置不可用。", "fallback");
    return;
  }

  void runLlamaCppRuntimeAction(
    () => window.localRuntimeApi!.chooseLlamaCppModel(),
    "正在选择模型..."
  );
});

llamaCppRuntimeStartAction.addEventListener("click", () => {
  if (!window.localRuntimeApi) {
    setLlamaCppRuntimeStatus("托管 llama.cpp 设置不可用。", "fallback");
    return;
  }

  void runLlamaCppRuntimeAction(
    () => window.localRuntimeApi!.startLlamaCpp(),
    "正在启动托管 llama.cpp..."
  );
});

llamaCppRuntimeStopAction.addEventListener("click", () => {
  if (!window.localRuntimeApi) {
    setLlamaCppRuntimeStatus("托管 llama.cpp 设置不可用。", "fallback");
    return;
  }

  void runLlamaCppRuntimeAction(
    () => window.localRuntimeApi!.stopLlamaCpp(),
    "正在停止托管 llama.cpp..."
  );
});

llamaCppRuntimeRefreshAction.addEventListener("click", () => {
  void refreshLlamaCppRuntimeStatus();
});

webSearchSaveAction.addEventListener("click", () => {
  if (!chatTurnState.isReplying) {
    void saveWebSearchSettings();
  }
});

webSearchProfileField.addEventListener("change", () => {
  if (webSearchProfileField.value !== BUNDLED_BAIDU_SEARCH_COMMAND) {
    return;
  }

  webSearchProfileNoteBox.textContent = "使用应用内置且经过批准的百度搜索配置，无需填写命令或参数。";
  webSearchProfileNoteBox.dataset.state = "ready";
});

webSearchRefreshAction.addEventListener("click", () => {
  void refreshWebSearchSettings();
});

webSearchTestAction.addEventListener("click", () => {
  if (!chatTurnState.isReplying) {
    void testWebSearchConnection();
  }
});

proactiveMemorySourceBubblesField.addEventListener("change", () => {
  renderProactiveCompanionSettings({
    ...currentProactiveCompanionSettings,
    memorySourceBubbles: proactiveMemorySourceBubblesField.checked
  });
});

proactiveSearchSourceBubblesField.addEventListener("change", () => {
  renderProactiveCompanionSettings({
    ...currentProactiveCompanionSettings,
    searchSourceBubbles: proactiveSearchSourceBubblesField.checked
  });
});

saveProactiveCompanionSettingsAction.addEventListener("click", () => {
  if (!chatTurnState.isReplying) {
    void saveProactiveCompanionSettings();
  }
});

saveEnvironmentActionSettingsAction.addEventListener("click", () => {
  if (!chatTurnState.isReplying) {
    void saveEnvironmentActionSettings();
  }
});

chatTabAction.addEventListener("click", () => {
  setActivePage("chat");
});

historyTabAction.addEventListener("click", () => {
  setActivePage("history");
});

memoryTabAction.addEventListener("click", () => {
  setActivePage("memory");
});

newConversationAction.addEventListener("click", () => {
  startNewConversation();
});

cancelMemoryDraftAction.addEventListener("click", () => {
  closeMemoryDraft();
});

saveMemoryDraftAction.addEventListener("click", () => {
  if (!memoryDraftSourceMessage || !window.memoryApi || chatTurnState.isReplying) {
    return;
  }

  void (async () => {
    try {
      const settings = await window.memoryApi?.getSettings();

      if (!settings?.enabled) {
        setChatSessionNote("记忆未开启；请先在记忆页显式开启后再保存事实卡。", "fallback");
        return;
      }

      await window.memoryApi?.createCard({
        title: memoryDraftTitleField.value,
        content: memoryDraftContentField.value,
        tags: parseTagsInput(memoryDraftTagsField.value),
        sourceConversationId: conversationId
      });
      closeMemoryDraft();
      setChatSessionNote("事实卡已保存到本机记忆。", "ready");
      await refreshMemory();
    } catch {
      setChatSessionNote("无法保存事实卡，请检查标题和正文。", "error");
    }
  })();
});

clearHistoryAction.addEventListener("click", () => {
  if (!chatTurnState.isReplying) {
    clearHistoryConfirmationBox.hidden = false;
  }
});

cancelClearHistoryAction.addEventListener("click", () => {
  clearHistoryConfirmationBox.hidden = true;
});

confirmClearHistoryAction.addEventListener("click", () => {
  if (chatTurnState.isReplying || !window.historyApi) {
    return;
  }

  void (async () => {
    try {
      await window.historyApi?.clearConversations();
      selectedHistoryConversation = null;
      clearHistoryConfirmationBox.hidden = true;
      renderHistoryDetail();
      setHistoryFeedback("全部本地历史已清空，无法恢复。");
      await refreshHistoryList();
    } catch {
      setHistoryFeedback("无法清空本地历史，请稍后重试。");
    }
  })();
});

enableMemoryAction.addEventListener("click", () => {
  if (!window.memoryApi || chatTurnState.isReplying) {
    return;
  }

  void (async () => {
    try {
      const settings = await window.memoryApi?.setEnabled(!memoryEnabled);
      memoryEnabled = Boolean(settings?.enabled);
      await refreshMemory();
    } catch {
      setMemoryFeedback("无法更新记忆开关，请稍后重试。");
    }
  })();
});

clearMemoryAction.addEventListener("click", () => {
  if (!chatTurnState.isReplying) {
    clearMemoryConfirmationBox.hidden = false;
  }
});

cancelClearMemoryAction.addEventListener("click", () => {
  clearMemoryConfirmationBox.hidden = true;
});

confirmClearMemoryAction.addEventListener("click", () => {
  if (!window.memoryApi || chatTurnState.isReplying) {
    return;
  }

  void (async () => {
    try {
      await window.memoryApi?.clearCards();
      clearMemoryConfirmationBox.hidden = true;
      setMemoryFeedback("全部事实卡已清空，无法恢复。");
      await refreshMemory();
    } catch {
      setMemoryFeedback("无法清空记忆，请稍后重试。");
    }
  })();
});

memorySearchField.addEventListener("input", () => {
  renderMemoryList();
});

memoryFilterTabs.forEach((tab) => {
  tab.addEventListener("click", () => {
    const filter = tab.dataset.memoryFilter;
    if (
      filter === "all" ||
      filter === "key" ||
      filter === "general" ||
      filter === "auto" ||
      filter === "manual" ||
      filter === "disabled"
    ) {
      activeMemoryFilter = filter;
      renderMemoryFilterTabs();
      renderMemoryList();
    }
  });
});

settingsCloseAction.addEventListener("click", () => {
  closeSettings();
});

window.addEventListener("keydown", (event) => {
  if (!recordingShortcutActionId || providerSettingsPanel.hidden) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  if (event.key === "Escape") {
    clearPendingWheelModifierRecording();
    recordingShortcutActionId = null;
    setShortcutStatus("已取消快捷键录入。", "fallback");
    renderShortcutList();
    return;
  }

  const recordingShortcut = shortcutViews.find((shortcut) => shortcut.id === recordingShortcutActionId);

  if (recordingShortcut?.kind === "wheelModifier") {
    const accelerator = eventToWheelModifierAccelerator(event);

    if (!accelerator) {
      setShortcutStatus("请按下 Ctrl、Alt、Shift 或 Meta 修饰键。", "fallback");
      return;
    }

    setShortcutStatus(`已捕获：${accelerator}+Wheel`, "ready");
    clearPendingWheelModifierRecording();
    pendingWheelModifierRecordTimeout = window.setTimeout(() => {
      pendingWheelModifierRecordTimeout = null;
      if (recordingShortcutActionId) {
        void saveRecordedShortcut(recordingShortcutActionId, accelerator).catch(() => {
          recordingShortcutActionId = null;
          setShortcutStatus("无法保存快捷键，请稍后重试。", "fallback");
          renderShortcutList();
        });
      }
    }, 450);
    return;
  }

  const accelerator = eventToAccelerator(event);

  if (!accelerator) {
    setShortcutStatus("请按下包含主键的快捷键组合。", "fallback");
    return;
  }

  setShortcutStatus(`已捕获：${accelerator}`, "ready");
  void saveRecordedShortcut(recordingShortcutActionId, accelerator).catch(() => {
    recordingShortcutActionId = null;
    setShortcutStatus("无法保存快捷键，请稍后重试。", "fallback");
    renderShortcutList();
  });
}, { capture: true });

providerIdField.addEventListener("change", () => {
  if (isOpenAICompatibleSelected()) {
    fillOpenAIDefaults();
    void refreshApiKeyStatus();
  } else if (isLocalOpenAICompatibleSelected()) {
    fillLocalOpenAIDefaults();
    void refreshLlamaCppRuntimeStatus();
  }

  updateProviderFields();
  resetLocalModelDiagnosticSummary();
  clearSettingsFeedback();
});

providerResetLocalAction.addEventListener("click", () => {
  providerIdField.value = "local-openai-compatible";
  fillLocalOpenAIDefaults();
  updateProviderFields();
  resetLocalModelDiagnosticSummary();
  setSettingsFeedback("已切回内置本地模型。", "ready");
});

localProviderPresetField.addEventListener("change", () => {
  if (!isLocalOpenAICompatibleSelected()) {
    return;
  }

  applyLocalProviderPreset(getSelectedLocalProviderPresetId());
  clearSettingsFeedback();
});

for (const field of [baseURLField, modelField]) {
  field.addEventListener("input", () => {
    resetProviderHealthStatus();
    resetLocalModelDiagnosticSummary();
  });
}

timeoutField.addEventListener("input", resetProviderHealthStatus);

localModelDiagnosticAction.addEventListener("click", () => {
  void runLocalModelDiagnostic();
});

providerHealthCheckAction.addEventListener("click", () => {
  if (chatTurnState.isReplying || !window.configApi) {
    return;
  }

  const request = buildProviderHealthRequest();

  if (!request) {
    return;
  }

  setProviderHealthStatus("正在检查连接...", "fallback");

  void window.configApi.checkProviderHealth(request).then((result) => {
    setProviderHealthStatus(
      formatProviderHealthResult(result),
      result.status === "ready" ? "ready" : "fallback"
    );
  }).catch(() => {
    setProviderHealthStatus("连接检查不可用，请稍后重试。", "fallback");
  });
});

petScaleField.addEventListener("input", () => {
  const petScale = normalizePetScale(Number(petScaleField.value));

  if (petScale !== null) {
    petScaleValueBox.value = `${petScale.toFixed(2)} 倍`;
  }
});

savePetScaleAction.addEventListener("click", () => {
  if (chatTurnState.isReplying || !window.petPresentationApi) {
    return;
  }

  const petScale = normalizePetScale(Number(petScaleField.value));

  if (petScale === null) {
    setSettingsFeedback("桌宠大小必须在 0.70 到 1.35 之间，并以 0.05 为步长。", "fallback");
    return;
  }

  clearSettingsFeedback();

  void window.petPresentationApi.setPetScale(petScale).then((preferences) => {
    setPetScaleValue(preferences.petScale);
    setSettingsFeedback("桌宠大小已保存。", "ready");
  }).catch(() => {
    setSettingsFeedback("无法保存桌宠大小，请稍后重试。", "fallback");
  });
});

savePetAccessoryAction.addEventListener("click", () => {
  if (chatTurnState.isReplying || !window.petPresentationApi) {
    return;
  }

  const accessoryIds = getPetAccessorySelectionFromFields();

  if (!accessoryIds) {
    setSettingsFeedback("角色配件选择无效。", "fallback");
    return;
  }

  clearSettingsFeedback();

  void window.petPresentationApi.setAccessorySelection(accessoryIds).then((preferences) => {
    setPetAccessorySelection(preferences.accessoryIds);
    setSettingsFeedback(`角色配件已保存：${formatPetAccessorySelection(preferences.accessoryIds)}。`, "ready");
  }).catch(() => {
    setSettingsFeedback("无法保存角色配件，请稍后重试。", "fallback");
  });
});

togglePetLockAction.addEventListener("click", () => {
  if (chatTurnState.isReplying || !window.petPresentationApi) {
    return;
  }

  const nextIsLocked = !isPetLocked;
  clearSettingsFeedback();

  void window.petPresentationApi.setPetLocked(nextIsLocked).then((state) => {
    setPetLockState(state.isLocked);
    setSettingsFeedback(state.isLocked ? "桌宠已锁定，点击会穿透到后方窗口。" : "桌宠已解除锁定。", "ready");
  }).catch(() => {
    setSettingsFeedback("无法切换桌宠锁定，请稍后重试。", "fallback");
  });
});

providerSettingsForm.addEventListener("submit", (event) => {
  event.preventDefault();

  if (chatTurnState.isReplying || !window.configApi) {
    return;
  }

  clearSettingsFeedback();
  const config = buildProviderConfig();

  if (!config) {
    return;
  }

  void (async () => {
    const newApiKey = isOpenAICompatibleSelected() ? apiKeyField.value.trim() : "";

    try {
      if (newApiKey) {
        const keySaved = await window.configApi?.setApiKey({
          apiKeyRef: getApiKeyRef(),
          apiKey: newApiKey
        });

        if (!keySaved) {
          setSettingsFeedback("无法更新 API Key，请稍后重试。");
          return;
        }
      }

      await window.configApi?.setProvider(config);
      apiKeyField.value = "";
      await Promise.all([refreshApiKeyStatus(), refreshProviderStatus()]);
      setSettingsFeedback("设置已保存。", "ready");
    } catch {
      setSettingsFeedback("无法保存设置，请检查输入后重试。");
    }
  })();
});

deleteApiKeyAction.addEventListener("click", () => {
  if (!chatTurnState.isReplying) {
    deleteKeyConfirmationBox.hidden = false;
  }
});

cancelDeleteApiKeyAction.addEventListener("click", () => {
  deleteKeyConfirmationBox.hidden = true;
});

confirmDeleteApiKeyAction.addEventListener("click", () => {
  if (chatTurnState.isReplying || !window.configApi) {
    return;
  }

  void (async () => {
    try {
      const deleted = await window.configApi?.deleteApiKey({ apiKeyRef: getApiKeyRef() });

      if (!deleted) {
        setSettingsFeedback("未找到可删除的 API Key。", "fallback");
        return;
      }

      apiKeyField.value = "";
      deleteKeyConfirmationBox.hidden = true;
      await Promise.all([refreshApiKeyStatus(), refreshProviderStatus()]);
      setSettingsFeedback("API Key 已删除。", "ready");
    } catch {
      setSettingsFeedback("无法删除 API Key，请稍后重试。");
    }
  })();
});

window.addEventListener("chat:focus-input", () => {
  chatInput.focus();
});

window.chatApi?.focusInput();
setMemorySessionStatus(null);
void refreshProactiveCompanionSettings();
void refreshEnvironmentActionSettings();
void refreshUserProfile();
void refreshProviderStatus();
void refreshWebSearchSettings();
void refreshMemory();
setPetScaleValue(DEFAULT_PET_PRESENTATION_PREFERENCES.petScale);
setPetAccessorySelection(DEFAULT_PET_PRESENTATION_PREFERENCES.accessoryIds);
setPetLockState(false);
void refreshPetPresentationPreferences().catch(() => {
  setChatSessionNote("无法读取伙伴外观摘要；请稍后打开设置重试。", "fallback");
});
void refreshPetLockState().catch(() => {
  setChatSessionNote("无法读取桌宠锁定摘要；请稍后打开设置重试。", "fallback");
});
