import "./styles.css";
import type { ChatMessage, ChatRole } from "../../shared/chat";
import type { ProviderConfig, ProviderStatus } from "../../shared/provider-config";

const form = document.querySelector<HTMLFormElement>("#chat-form");
const input = document.querySelector<HTMLInputElement>("#chat-input");
const messages = document.querySelector<HTMLElement>("#messages");
const sendButton = document.querySelector<HTMLButtonElement>("#send-button");
const abortButton = document.querySelector<HTMLButtonElement>("#abort-button");
const providerStatus = document.querySelector<HTMLElement>("#provider-status");
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
const apiKeyInput = document.querySelector<HTMLInputElement>("#provider-api-key");
const apiKeyStatus = document.querySelector<HTMLElement>("#api-key-status");
const deleteApiKeyButton = document.querySelector<HTMLButtonElement>("#delete-api-key-button");
const deleteKeyConfirmation = document.querySelector<HTMLElement>("#delete-key-confirmation");
const cancelDeleteApiKeyButton = document.querySelector<HTMLButtonElement>("#cancel-delete-api-key-button");
const confirmDeleteApiKeyButton = document.querySelector<HTMLButtonElement>("#confirm-delete-api-key-button");
const settingsFeedback = document.querySelector<HTMLElement>("#settings-feedback");

if (
  !form || !input || !messages || !sendButton || !abortButton || !providerStatus ||
  !settingsButton || !settingsPanel || !settingsCloseButton || !settingsForm || !providerIdSelect ||
  !displayNameInput || !openAIFields || !baseURLInput || !modelInput || !temperatureInput ||
  !maxTokensInput || !timeoutInput || !apiKeyInput || !apiKeyStatus || !deleteApiKeyButton ||
  !deleteKeyConfirmation || !cancelDeleteApiKeyButton || !confirmDeleteApiKeyButton || !settingsFeedback
) {
  throw new Error("chat elements missing");
}

const chatForm = form;
const chatInput = input;
const messageList = messages;
const sendAction = sendButton;
const abortAction = abortButton;
const providerStatusBox = providerStatus;
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
const apiKeyField = apiKeyInput;
const apiKeyStatusBox = apiKeyStatus;
const deleteApiKeyAction = deleteApiKeyButton;
const deleteKeyConfirmationBox = deleteKeyConfirmation;
const cancelDeleteApiKeyAction = cancelDeleteApiKeyButton;
const confirmDeleteApiKeyAction = confirmDeleteApiKeyButton;
const settingsFeedbackBox = settingsFeedback;
const chatHistory: ChatMessage[] = [];
const conversationId = crypto.randomUUID();
const DEFAULT_API_KEY_REF = "openai-compatible-default";
const DEFAULT_OPENAI_CONFIG = {
  displayName: "DeepSeek",
  baseURL: "https://api.deepseek.com",
  model: "deepseek-v4-flash",
  temperature: 0.7,
  maxTokens: 1024,
  timeoutMs: 60000
};

let activeReplyMessage: ChatMessage | null = null;
let activeReplyElement: HTMLElement | null = null;
let isReplying = false;

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

  return "本地模式：Fake Provider";
}

function setProviderStatus(status: ProviderStatus): void {
  providerStatusBox.textContent = formatProviderStatus(status);
  providerStatusBox.dataset.state = status.isFallback ? "fallback" : "ready";
}

function appendMessage(message: ChatMessage): HTMLElement {
  const item = document.createElement("p");
  const authorClass = message.role === "user" ? "user" : "pet";
  item.className = `message message-${authorClass}`;
  item.textContent = message.content;
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

function setReplying(isReplying: boolean): void {
  chatInput.disabled = isReplying;
  sendAction.disabled = isReplying;
  abortAction.disabled = !isReplying;
  settingsAction.disabled = isReplying;
  providerSettingsForm.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>("input, select, button")
    .forEach((control) => {
      control.disabled = isReplying;
    });
}

function finishReplying(): void {
  activeReplyMessage = null;
  activeReplyElement = null;
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

function isOpenAICompatibleSelected(): boolean {
  return providerIdField.value === "openai-compatible";
}

function updateProviderFields(): void {
  const isOpenAICompatible = isOpenAICompatibleSelected();
  openAIFieldsContainer.hidden = !isOpenAICompatible;
  baseURLField.required = isOpenAICompatible;
  modelField.required = isOpenAICompatible;
  temperatureField.required = isOpenAICompatible;
  maxTokensField.required = isOpenAICompatible;
  timeoutField.required = isOpenAICompatible;
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

function fillProviderForm(config: ProviderConfig): void {
  providerIdField.value = config.providerId;
  displayNameField.value = config.displayName;

  if (config.providerId === "openai-compatible") {
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

  try {
    const config = await window.configApi.getProvider();
    fillProviderForm(config);
    await refreshApiKeyStatus();
  } catch {
    setSettingsFeedback("无法读取当前设置，请稍后重试。");
  }
}

function closeSettings(): void {
  providerSettingsPanel.hidden = true;
  deleteKeyConfirmationBox.hidden = true;
  apiKeyField.value = "";
  clearSettingsFeedback();
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

  if (!isOpenAICompatibleSelected()) {
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
  if (!activeReplyMessage || !activeReplyElement) {
    return;
  }

  activeReplyMessage.content += delta.text;
  activeReplyElement.textContent = activeReplyMessage.content;
  messageList.scrollTop = messageList.scrollHeight;
});

window.chatApi?.onReplyDone((reply) => {
  window.chatApi?.reportReplyEmotion(reply.emotion);
  finishReplying();
});

window.chatApi?.onReplyError((error) => {
  if (activeReplyMessage && activeReplyElement) {
    if (error.errorType === "aborted") {
      if (!activeReplyMessage.content) {
        activeReplyMessage.content = "已中断。";
      } else {
        activeReplyMessage.content += "（已中断）";
      }
    } else {
      activeReplyMessage.content = error.message;
      console.warn("[chat] reply failed", error.errorType);
    }

    activeReplyElement.textContent = activeReplyMessage.content;
  }

  finishReplying();
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
  const requestMessages = [...chatHistory];
  appendMessage(userMessage);

  const replyMessage = createMessage("assistant", "");
  chatHistory.push(replyMessage);
  const replyElement = appendMessage(replyMessage);

  chatInput.value = "";
  activeReplyMessage = replyMessage;
  activeReplyElement = replyElement;
  isReplying = true;
  setReplying(true);

  window.chatApi?.sendMessage({
    conversationId,
    messages: requestMessages
  });
});

abortAction.addEventListener("click", () => {
  window.chatApi?.abortReply();
});

settingsAction.addEventListener("click", () => {
  void openSettings();
});

settingsCloseAction.addEventListener("click", () => {
  closeSettings();
});

providerIdField.addEventListener("change", () => {
  if (isOpenAICompatibleSelected()) {
    fillOpenAIDefaults();
    void refreshApiKeyStatus();
  }

  updateProviderFields();
  clearSettingsFeedback();
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
void refreshProviderStatus();
