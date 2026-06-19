import "./styles.css";
import type { ChatMessage, ChatRole } from "../../shared/chat";
import type { ProviderStatus } from "../../shared/provider-config";

const form = document.querySelector<HTMLFormElement>("#chat-form");
const input = document.querySelector<HTMLInputElement>("#chat-input");
const messages = document.querySelector<HTMLElement>("#messages");
const sendButton = document.querySelector<HTMLButtonElement>("#send-button");
const abortButton = document.querySelector<HTMLButtonElement>("#abort-button");
const providerStatus = document.querySelector<HTMLElement>("#provider-status");

if (!form || !input || !messages || !sendButton || !abortButton || !providerStatus) {
  throw new Error("chat elements missing");
}

const chatForm = form;
const chatInput = input;
const messageList = messages;
const sendAction = sendButton;
const abortAction = abortButton;
const providerStatusBox = providerStatus;
const chatHistory: ChatMessage[] = [];
const conversationId = crypto.randomUUID();

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

window.addEventListener("chat:focus-input", () => {
  chatInput.focus();
});

window.chatApi?.focusInput();
void refreshProviderStatus();
