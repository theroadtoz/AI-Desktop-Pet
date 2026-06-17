import "./styles.css";

const form = document.querySelector<HTMLFormElement>("#chat-form");
const input = document.querySelector<HTMLInputElement>("#chat-input");
const messages = document.querySelector<HTMLElement>("#messages");

if (!form || !input || !messages) {
  throw new Error("chat elements missing");
}

const chatForm = form;
const chatInput = input;
const messageList = messages;

function appendMessage(author: "user" | "pet", text: string): void {
  const item = document.createElement("p");
  item.className = `message message-${author}`;
  item.textContent = text;
  messageList.append(item);
  messageList.scrollTop = messageList.scrollHeight;
}

chatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = chatInput.value.trim();

  if (!text) {
    return;
  }

  appendMessage("user", text);
  appendMessage("pet", "Phase 0 假回复稍后接入。");
  chatInput.value = "";
});

window.addEventListener("chat:focus-input", () => {
  chatInput.focus();
});

window.chatApi?.focusInput();
