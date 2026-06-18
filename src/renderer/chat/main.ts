import "./styles.css";
import type { ChatMessage, ChatRole } from "../../shared/chat";
import { streamFakeReply } from "./fake-provider";

const form = document.querySelector<HTMLFormElement>("#chat-form");
const input = document.querySelector<HTMLInputElement>("#chat-input");
const messages = document.querySelector<HTMLElement>("#messages");
const sendButton = document.querySelector<HTMLButtonElement>("#send-button");
const abortButton = document.querySelector<HTMLButtonElement>("#abort-button");

if (!form || !input || !messages || !sendButton || !abortButton) {
  throw new Error("chat elements missing");
}

const chatForm = form;
const chatInput = input;
const messageList = messages;
const sendAction = sendButton;
const abortAction = abortButton;
const chatHistory: ChatMessage[] = [];

let activeAbortController: AbortController | null = null;

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

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();

  if (activeAbortController) {
    return;
  }

  const text = chatInput.value.trim();

  if (!text) {
    return;
  }

  const userMessage = createMessage("user", text);
  chatHistory.push(userMessage);
  appendMessage(userMessage);

  const replyMessage = createMessage("assistant", "");
  chatHistory.push(replyMessage);
  const replyElement = appendMessage(replyMessage);

  chatInput.value = "";
  activeAbortController = new AbortController();
  setReplying(true);

  void streamFakeReply(text, {
    signal: activeAbortController.signal,
    onDelta(chunk) {
      replyMessage.content += chunk;
      replyElement.textContent = replyMessage.content;
      messageList.scrollTop = messageList.scrollHeight;
    }
  }).then((reply) => {
    window.chatApi?.reportReplyEmotion(reply.emotion);
  }).catch((error: unknown) => {
    if (!isAbortError(error)) {
      replyMessage.content = "回复失败，请稍后再试。";
      replyElement.textContent = replyMessage.content;
      console.warn("[chat] fake reply failed", error);
      return;
    }

    if (!replyMessage.content) {
      replyMessage.content = "已中断。";
    } else {
      replyMessage.content += "（已中断）";
    }
    replyElement.textContent = replyMessage.content;
  }).finally(() => {
    activeAbortController = null;
    setReplying(false);
    chatInput.focus();
  });
});

abortAction.addEventListener("click", () => {
  activeAbortController?.abort();
});

window.addEventListener("chat:focus-input", () => {
  chatInput.focus();
});

window.chatApi?.focusInput();
