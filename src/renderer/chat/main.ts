import "./styles.css";
import type { ChatMessage, ChatRole } from "../../shared/chat";
import type { Conversation, ConversationSummary } from "../../shared/chat-history";
import { DIALOGUE_MODE_LABELS, type DialogueModeId, type DialogueModeView } from "../../shared/dialogue-style";
import type { MemoryCard } from "../../shared/chat-memory";
import type { ProviderConfig, ProviderStatus } from "../../shared/provider-config";
import {
  DEFAULT_PET_PRESENTATION_PREFERENCES,
  normalizePetScale
} from "../../shared/pet-presentation";
import { isPetAccessoryPresetId, type PetAccessoryPresetId } from "../../shared/pet-accessory";
import type { ShortcutActionId, ShortcutPreferenceView } from "../../shared/shortcut-preferences";

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
const providerIdSelect = document.querySelector<HTMLSelectElement>("#provider-id");
const displayNameInput = document.querySelector<HTMLInputElement>("#provider-display-name");
const openAIFields = document.querySelector<HTMLElement>("#openai-fields");
const baseURLInput = document.querySelector<HTMLInputElement>("#provider-base-url");
const modelInput = document.querySelector<HTMLInputElement>("#provider-model");
const temperatureInput = document.querySelector<HTMLInputElement>("#provider-temperature");
const maxTokensInput = document.querySelector<HTMLInputElement>("#provider-max-tokens");
const timeoutInput = document.querySelector<HTMLInputElement>("#provider-timeout");
const localProviderNote = document.querySelector<HTMLElement>("#local-provider-note");
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
const petAccessorySelect = document.querySelector<HTMLSelectElement>("#pet-accessory");
const petAccessoryStatus = document.querySelector<HTMLElement>("#pet-accessory-status");
const savePetScaleButton = document.querySelector<HTMLButtonElement>("#save-pet-scale-button");
const savePetAccessoryButton = document.querySelector<HTMLButtonElement>("#save-pet-accessory-button");
const petLockStatus = document.querySelector<HTMLElement>("#pet-lock-status");
const togglePetLockButton = document.querySelector<HTMLButtonElement>("#toggle-pet-lock-button");
const shortcutList = document.querySelector<HTMLElement>("#shortcut-list");
const shortcutStatus = document.querySelector<HTMLElement>("#shortcut-status");
const chatTab = document.querySelector<HTMLButtonElement>("#chat-tab");
const historyTab = document.querySelector<HTMLButtonElement>("#history-tab");
const memoryTab = document.querySelector<HTMLButtonElement>("#memory-tab");
const chatPage = document.querySelector<HTMLElement>("#chat-page");
const dialogueModeControls = document.querySelector<HTMLElement>("#dialogue-mode-controls");
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
const memorySearch = document.querySelector<HTMLInputElement>("#memory-search");
const memoryList = document.querySelector<HTMLElement>("#memory-list");

if (
  !form || !input || !messages || !sendButton || !abortButton || !partnerStatus || !providerStatus ||
  !memorySessionStatus || !settingsButton || !settingsPanel || !settingsCloseButton || !settingsForm || !providerIdSelect ||
  !displayNameInput || !openAIFields || !baseURLInput || !modelInput || !temperatureInput ||
  !maxTokensInput || !timeoutInput || !localProviderNote || !apiKeyInput || !apiKeyStatus || !connectionSafeSection || !deleteApiKeyButton ||
  !deleteKeyConfirmation || !cancelDeleteApiKeyButton || !confirmDeleteApiKeyButton || !settingsFeedback ||
  !petScaleInput || !petScaleValue || !petAccessorySelect || !petAccessoryStatus || !savePetScaleButton ||
  !savePetAccessoryButton || !petLockStatus || !togglePetLockButton || !shortcutList || !shortcutStatus ||
  !chatTab || !historyTab || !memoryTab || !chatPage || !dialogueModeControls || !historyPage ||
  !memoryPage || !chatSessionNote || !memoryDraftPanel || !memoryDraftTitle || !memoryDraftContent || !memoryDraftTags ||
  !cancelMemoryDraftButton || !saveMemoryDraftButton || !newConversationButton || !clearHistoryButton || !clearHistoryConfirmation ||
  !cancelClearHistoryButton || !confirmClearHistoryButton || !historyFeedback || !conversationList || !historyDetail ||
  !enableMemoryButton || !clearMemoryButton || !clearMemoryConfirmation || !cancelClearMemoryButton ||
  !confirmClearMemoryButton || !memoryFeedback || !memorySearch || !memoryList
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
const providerIdField = providerIdSelect;
const displayNameField = displayNameInput;
const openAIFieldsContainer = openAIFields;
const baseURLField = baseURLInput;
const modelField = modelInput;
const temperatureField = temperatureInput;
const maxTokensField = maxTokensInput;
const timeoutField = timeoutInput;
const localProviderNoteBox = localProviderNote;
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
const petAccessoryField = petAccessorySelect;
const petAccessoryStatusBox = petAccessoryStatus;
const savePetScaleAction = savePetScaleButton;
const savePetAccessoryAction = savePetAccessoryButton;
const petLockStatusBox = petLockStatus;
const togglePetLockAction = togglePetLockButton;
const shortcutListElement = shortcutList;
const shortcutStatusBox = shortcutStatus;
const chatTabAction = chatTab;
const historyTabAction = historyTab;
const memoryTabAction = memoryTab;
const chatPageContainer = chatPage;
const dialogueModeControlsElement = dialogueModeControls;
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
const memorySearchField = memorySearch;
const memoryListElement = memoryList;
const chatHistory: ChatMessage[] = [];
let conversationId: string = crypto.randomUUID();
const DEFAULT_API_KEY_REF = "openai-compatible-default";
const DEFAULT_OPENAI_CONFIG = {
  displayName: "DeepSeek",
  baseURL: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  temperature: 0.7,
  maxTokens: 1024,
  timeoutMs: 60000
};
const DEFAULT_LOCAL_OPENAI_CONFIG = {
  displayName: "Ollama 本地模型",
  baseURL: "http://localhost:11434/v1",
  model: "qwen3:1.7b",
  temperature: 0.7,
  maxTokens: 240,
  timeoutMs: 60000
};

let activeReplyMessage: ChatMessage | null = null;
let activeReplyElement: HTMLElement | null = null;
let isReplying = false;
let activeRequestVersion: number | null = null;
let latestRequestVersion = 0;
let activePage: "chat" | "history" | "memory" = "chat";
let selectedHistoryConversation: Conversation | null = null;
let providerContextEnabled = false;
let memoryCards: MemoryCard[] = [];
let memoryEnabled = false;
let memoryDraftSourceMessage: ChatMessage | null = null;
let isPetLocked = false;
let shortcutViews: ShortcutPreferenceView[] = [];
let dialogueModes: DialogueModeView[] = [];
let currentDialogueModeId: DialogueModeId = "default";
let recordingShortcutActionId: ShortcutActionId | null = null;
let pendingWheelModifierRecordTimeout: number | null = null;

function formatProviderStatus(status: ProviderStatus): string {
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

function setProviderStatus(status: ProviderStatus): void {
  providerStatusBox.textContent = formatProviderStatus(status);
  providerStatusBox.dataset.state = status.isFallback ? "fallback" : "ready";
}

function setPartnerStatus(message: string): void {
  partnerStatusBox.textContent = message;
  partnerStatusBox.dataset.state = "ready";
}

function setDialogueMode(modeId: DialogueModeId): void {
  currentDialogueModeId = modeId;
  const label = DIALOGUE_MODE_LABELS[modeId];
  setPartnerStatus(`桌面伙伴 · ${label}${modeId === "default" ? "" : "模式"}`);

  for (const button of dialogueModeControlsElement.querySelectorAll<HTMLButtonElement>(".mode-button")) {
    const isActive = button.dataset.modeId === modeId;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  }
}

function renderDialogueModes(modes: DialogueModeView[]): void {
  dialogueModeControlsElement.replaceChildren();

  for (const mode of modes) {
    const button = document.createElement("button");
    button.className = "button-light mode-button";
    button.type = "button";
    button.dataset.modeId = mode.id;
    button.textContent = mode.label;
    button.setAttribute("aria-pressed", String(mode.id === currentDialogueModeId));
    button.addEventListener("click", () => {
      void setDialogueModeFromUi(mode.id);
    });
    dialogueModeControlsElement.append(button);
  }
}

async function refreshDialogueMode(): Promise<void> {
  if (!window.dialogueModeApi) {
    return;
  }

  dialogueModes = window.dialogueModeApi.listModes();
  renderDialogueModes(dialogueModes);

  try {
    setDialogueMode(await window.dialogueModeApi.getMode());
  } catch {
    setDialogueMode("default");
  }
}

async function setDialogueModeFromUi(modeId: DialogueModeId): Promise<void> {
  if (!window.dialogueModeApi || isReplying || modeId === currentDialogueModeId) {
    return;
  }

  try {
    setDialogueMode(await window.dialogueModeApi.setMode(modeId));
  } catch {
    setChatSessionNote("无法切换对话模式，请稍后重试。");
  }
}

function setMemorySessionStatus(count: number | null): void {
  memorySessionStatusBox.textContent = count && count > 0
    ? `本次使用 ${count} 条记忆`
    : "本次未使用记忆";
  memorySessionStatusBox.dataset.state = count && count > 0 ? "ready" : "fallback";
}

function appendMessage(message: ChatMessage): HTMLElement {
  const item = document.createElement("p");
  const authorClass = message.role === "user" ? "user" : "pet";
  item.className = `message message-${authorClass}`;
  const content = document.createElement("span");
  content.className = "message-content";
  content.textContent = message.content;
  item.append(content);

  if (message.role === "user") {
    const actions = document.createElement("span");
    actions.className = "message-actions";
    const rememberButton = document.createElement("button");
    rememberButton.className = "button-light message-action";
    rememberButton.type = "button";
    rememberButton.textContent = "记住这点";
    rememberButton.addEventListener("click", () => {
      openMemoryDraft(message);
    });
    actions.append(rememberButton);
    item.append(actions);
  }

  messageList.append(item);
  messageList.scrollTop = messageList.scrollHeight;
  return item;
}

function createMessage(role: ChatRole, content: string): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role,
    content
  };
}

function setChatSessionNote(message: string): void {
  chatSessionNoteBox.textContent = message;
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

function setActivePage(page: "chat" | "history" | "memory"): void {
  activePage = page;
  const isChatPage = page === "chat";
  const isHistoryPage = page === "history";
  const isMemoryPage = page === "memory";
  chatPageContainer.hidden = !isChatPage;
  historyPageContainer.hidden = !isHistoryPage;
  memoryPageContainer.hidden = !isMemoryPage;
  chatTabAction.classList.toggle("is-active", isChatPage);
  historyTabAction.classList.toggle("is-active", isHistoryPage);
  memoryTabAction.classList.toggle("is-active", isMemoryPage);

  if (isHistoryPage) {
    closeSettings();
    void refreshHistoryList();
  } else if (isMemoryPage) {
    closeSettings();
    void refreshMemory();
  } else {
    chatInput.focus();
  }
}

function setMemoryFeedback(message: string): void {
  memoryFeedbackBox.textContent = message;
}

function parseTagsInput(value: string): string[] {
  return value
    .split(/[,，]/)
    .map((tag) => tag.trim())
    .filter((tag, index, tags) => tag.length > 0 && tags.indexOf(tag) === index)
    .slice(0, 8);
}

function openMemoryDraft(message: ChatMessage): void {
  if (isReplying) {
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
    const [settings, cards] = await Promise.all([
      window.memoryApi.getSettings(),
      window.memoryApi.listCards()
    ]);
    memoryEnabled = settings.enabled;
    memoryCards = cards;
    enableMemoryAction.textContent = memoryEnabled ? "关闭记忆" : "开启记忆";
    renderMemoryList();
    const enabledCount = cards.filter((card) => card.enabled).length;
    setMemoryFeedback(
      memoryEnabled
        ? enabledCount > 0
          ? `记忆已开启；只有已启用事实卡会临时加入 Provider 请求，当前 ${enabledCount} 条。`
          : "记忆已开启；当前没有已启用事实卡，发送时不会加入记忆。"
        : "记忆默认关闭；只有启用事实卡才会临时加入 Provider 请求。"
    );
  } catch {
    setMemoryFeedback("无法读取本地记忆，请稍后重试。");
  }
}

function renderMemoryList(): void {
  const query = memorySearchField.value.trim().toLowerCase();
  const cards = memoryCards.filter((card) => {
    if (!query) {
      return true;
    }

    return [card.title, card.content, card.tags.join(" ")].some((text) => text.toLowerCase().includes(query));
  });

  memoryListElement.replaceChildren();

  if (cards.length === 0) {
    const empty = document.createElement("p");
    empty.className = "selection-note";
    empty.textContent = memoryCards.length === 0 ? "暂无事实卡。" : "没有匹配的事实卡。";
    memoryListElement.append(empty);
    return;
  }

  cards.forEach((card) => {
    memoryListElement.append(createMemoryCardElement(card));
  });
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
  const meta = document.createElement("p");
  meta.className = "selection-note";
  meta.textContent = `${card.enabled ? "已启用" : "已停用"} · ${formatHistoryTime(card.updatedAt)}`;
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
  actions.append(saveButton, toggleButton, deleteButton);
  item.append(title, content, tags, meta, actions, confirmation);
  return item;
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
  historyDetailElement.append(title, boundary, messageItems, actions, confirmation);
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
  } catch {
    setHistoryFeedback("无法打开该会话，请稍后重试。");
  }
}

function restoreSelectedHistory(includeProviderContext: boolean): void {
  if (!selectedHistoryConversation || isReplying) {
    return;
  }

  conversationId = selectedHistoryConversation.id;
  chatHistory.splice(0, chatHistory.length, ...selectedHistoryConversation.messages.map(({ id, role, content }) => ({ id, role, content })));
  providerContextEnabled = includeProviderContext;
  renderCurrentConversation();
  setChatSessionNote(
    includeProviderContext
      ? "已明确继续：下一条消息将携带当前会话上下文发送给当前 Provider。"
      : "已仅在本地打开历史：下一条消息只发送当前消息，不会自动发送历史内容。"
  );
  setActivePage("chat");
}

function startNewConversation(): void {
  if (isReplying) {
    return;
  }

  conversationId = crypto.randomUUID();
  chatHistory.splice(0, chatHistory.length);
  providerContextEnabled = false;
  renderCurrentConversation();
  setChatSessionNote("已新建本地会话；发送时只包含当前消息。");
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
  chatInput.disabled = isReplying;
  sendAction.disabled = isReplying;
  abortAction.disabled = !isReplying;
  settingsAction.disabled = isReplying;
  chatTabAction.disabled = isReplying;
  historyTabAction.disabled = isReplying;
  memoryTabAction.disabled = isReplying;
  newConversationAction.disabled = isReplying;
  clearHistoryAction.disabled = isReplying;
  enableMemoryAction.disabled = isReplying;
  clearMemoryAction.disabled = isReplying;
  saveMemoryDraftAction.disabled = isReplying;
  historyDetailElement.querySelectorAll<HTMLButtonElement>("button").forEach((control) => {
    control.disabled = isReplying;
  });
  providerSettingsForm.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input, select, button")
    .forEach((control) => {
      control.disabled = isReplying;
    });
}

function finishReplying(): void {
  activeReplyMessage = null;
  activeReplyElement = null;
  activeRequestVersion = null;
  isReplying = false;
  setReplying(false);
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
  petScaleField.value = petScale.toFixed(2);
  petScaleValueBox.value = `${petScale.toFixed(2)} 倍`;
}

function getPetAccessoryLabel(presetId: PetAccessoryPresetId): string {
  return presetId === "glasses" ? "眼镜" : "无配件";
}

function setPetAccessoryValue(presetId: PetAccessoryPresetId): void {
  petAccessoryField.value = presetId;
  petAccessoryStatusBox.textContent = `角色配件：${getPetAccessoryLabel(presetId)}`;
  petAccessoryStatusBox.dataset.state = presetId === "glasses" ? "ready" : "fallback";
}

async function refreshPetPresentationPreferences(): Promise<void> {
  const preferences = await window.petPresentationApi?.getPreferences();

  if (!preferences) {
    throw new Error("Pet presentation API unavailable");
  }

  setPetScaleValue(preferences.petScale);
  setPetAccessoryValue(preferences.accessoryPresetId);
}

function setPetLockState(nextIsLocked: boolean): void {
  isPetLocked = nextIsLocked;
  petLockStatusBox.textContent = `桌宠锁定：${isPetLocked ? "已锁定，点击可穿透" : "未锁定"}`;
  petLockStatusBox.dataset.state = isPetLocked ? "ready" : "fallback";
  togglePetLockAction.textContent = isPetLocked ? "解除锁定" : "锁定桌宠";
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

function updateProviderFields(): void {
  const hasOpenAIFields = isProviderWithOpenAIFieldsSelected();
  const isCloudOpenAI = isOpenAICompatibleSelected();
  openAIFieldsContainer.hidden = !hasOpenAIFields;
  connectionSafeSectionBox.hidden = !isCloudOpenAI;
  localProviderNoteBox.hidden = !isLocalOpenAICompatibleSelected();
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
}

function fillLocalOpenAIDefaults(): void {
  displayNameField.value = DEFAULT_LOCAL_OPENAI_CONFIG.displayName;
  baseURLField.value = DEFAULT_LOCAL_OPENAI_CONFIG.baseURL;
  modelField.value = DEFAULT_LOCAL_OPENAI_CONFIG.model;
  temperatureField.value = String(DEFAULT_LOCAL_OPENAI_CONFIG.temperature);
  maxTokensField.value = String(DEFAULT_LOCAL_OPENAI_CONFIG.maxTokens);
  timeoutField.value = String(DEFAULT_LOCAL_OPENAI_CONFIG.timeoutMs);
}

function fillProviderForm(config: ProviderConfig): void {
  providerIdField.value = config.providerId;
  displayNameField.value = config.displayName;

  if (config.providerId === "openai-compatible" || config.providerId === "local-openai-compatible") {
    baseURLField.value = config.baseURL;
    modelField.value = config.model;
    temperatureField.value = String(config.temperature);
    maxTokensField.value = String(config.maxTokens);
    timeoutField.value = String(config.timeoutMs);
  }

  apiKeyField.value = "";
  updateProviderFields();
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

async function openSettings(): Promise<void> {
  if (isReplying || !window.configApi) {
    return;
  }

  clearSettingsFeedback();
  deleteKeyConfirmationBox.hidden = true;
  providerSettingsPanel.hidden = false;
  window.chatApi?.setInteractionActive(true);

  try {
    const config = await window.configApi.getProvider();
    fillProviderForm(config);
    await Promise.all([refreshApiKeyStatus(), refreshPetPresentationPreferences(), refreshPetLockState(), refreshShortcuts()]);
  } catch {
    setSettingsFeedback("无法读取当前设置，请稍后重试。");
  }
}

function closeSettings(): void {
  providerSettingsPanel.hidden = true;
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
      temperature,
      maxTokens,
      timeoutMs
    };
  }

  return {
    providerId: "openai-compatible",
    displayName,
    baseURL,
    model,
    apiKeyRef: getApiKeyRef(),
    temperature,
    maxTokens,
    timeoutMs
  };
}

window.chatApi?.onReplyDelta((delta) => {
  if (!activeReplyMessage || !activeReplyElement || delta.requestVersion !== activeRequestVersion) {
    return;
  }

  activeReplyMessage.content += delta.text;
  const content = activeReplyElement.querySelector<HTMLElement>(".message-content") ?? activeReplyElement;
  content.textContent = activeReplyMessage.content;
  messageList.scrollTop = messageList.scrollHeight;
});

window.chatApi?.onReplyDone((reply) => {
  if (reply.requestVersion !== activeRequestVersion) {
    return;
  }

  finishReplying();
});

window.chatApi?.onReplyError((error) => {
  if (error.requestVersion !== activeRequestVersion) {
    return;
  }

  if (activeReplyMessage && activeReplyElement) {
    const index = chatHistory.findIndex((message) => message.id === activeReplyMessage?.id);

    if (index >= 0) {
      chatHistory.splice(index, 1);
    }

    activeReplyElement.remove();
  }

  setChatSessionNote(error.errorType === "aborted" ? "回复已中断，未保存未完成的助手消息。" : error.message);

  finishReplying();
});

window.chatApi?.onMemoryInjection((payload) => {
  if (payload.requestVersion !== activeRequestVersion) {
    return;
  }

  setMemorySessionStatus(payload.count);
});

window.petPresentationApi?.onPetLockChanged((state) => {
  setPetLockState(state.isLocked);
});

window.dialogueModeApi?.onModeChanged((modeId) => {
  setDialogueMode(modeId);
});

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();

  if (isReplying) {
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
  activeReplyMessage = replyMessage;
  activeReplyElement = replyElement;
  activeRequestVersion = ++latestRequestVersion;
  isReplying = true;
  setReplying(true);

  window.chatApi?.sendMessage({
    requestVersion: activeRequestVersion,
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
  void openSettings();
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
  if (!memoryDraftSourceMessage || !window.memoryApi || isReplying) {
    return;
  }

  void (async () => {
    try {
      const settings = await window.memoryApi?.getSettings();

      if (!settings?.enabled) {
        setChatSessionNote("记忆未开启；请先在记忆页显式开启后再保存事实卡。");
        return;
      }

      await window.memoryApi?.createCard({
        title: memoryDraftTitleField.value,
        content: memoryDraftContentField.value,
        tags: parseTagsInput(memoryDraftTagsField.value),
        sourceConversationId: conversationId
      });
      closeMemoryDraft();
      setChatSessionNote("事实卡已保存到本机记忆。");
      await refreshMemory();
    } catch {
      setChatSessionNote("无法保存事实卡，请检查标题和正文。");
    }
  })();
});

clearHistoryAction.addEventListener("click", () => {
  if (!isReplying) {
    clearHistoryConfirmationBox.hidden = false;
  }
});

cancelClearHistoryAction.addEventListener("click", () => {
  clearHistoryConfirmationBox.hidden = true;
});

confirmClearHistoryAction.addEventListener("click", () => {
  if (isReplying || !window.historyApi) {
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
  if (!window.memoryApi || isReplying) {
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
  if (!isReplying) {
    clearMemoryConfirmationBox.hidden = false;
  }
});

cancelClearMemoryAction.addEventListener("click", () => {
  clearMemoryConfirmationBox.hidden = true;
});

confirmClearMemoryAction.addEventListener("click", () => {
  if (!window.memoryApi || isReplying) {
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
  }

  updateProviderFields();
  clearSettingsFeedback();
});

petScaleField.addEventListener("input", () => {
  const petScale = normalizePetScale(Number(petScaleField.value));

  if (petScale !== null) {
    petScaleValueBox.value = `${petScale.toFixed(2)} 倍`;
  }
});

savePetScaleAction.addEventListener("click", () => {
  if (isReplying || !window.petPresentationApi) {
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
  if (isReplying || !window.petPresentationApi) {
    return;
  }

  const presetId = petAccessoryField.value;

  if (!isPetAccessoryPresetId(presetId)) {
    setSettingsFeedback("角色配件选项无效。", "fallback");
    return;
  }

  clearSettingsFeedback();

  void window.petPresentationApi.setAccessoryPreset(presetId).then((preferences) => {
    setPetAccessoryValue(preferences.accessoryPresetId);
    setSettingsFeedback("角色配件已保存。", "ready");
  }).catch(() => {
    setSettingsFeedback("无法保存角色配件，请稍后重试。", "fallback");
  });
});

togglePetLockAction.addEventListener("click", () => {
  if (isReplying || !window.petPresentationApi) {
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

  if (isReplying || !window.configApi) {
    return;
  }

  clearSettingsFeedback();
  const config = buildProviderConfig();

  if (!config) {
    return;
  }

  void (async () => {
    const newApiKey = apiKeyField.value.trim();

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
  if (!isReplying) {
    deleteKeyConfirmationBox.hidden = false;
  }
});

cancelDeleteApiKeyAction.addEventListener("click", () => {
  deleteKeyConfirmationBox.hidden = true;
});

confirmDeleteApiKeyAction.addEventListener("click", () => {
  if (isReplying || !window.configApi) {
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
setDialogueMode("default");
setMemorySessionStatus(null);
void refreshDialogueMode();
void refreshProviderStatus();
void refreshMemory();
setPetScaleValue(DEFAULT_PET_PRESENTATION_PREFERENCES.petScale);
setPetAccessoryValue(DEFAULT_PET_PRESENTATION_PREFERENCES.accessoryPresetId);
setPetLockState(false);
