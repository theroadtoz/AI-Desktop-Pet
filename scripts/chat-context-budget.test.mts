import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  budgetChatContext,
  CHAT_CONTEXT_RECENT_MESSAGE_BUDGET,
  CHAT_CONTEXT_SUMMARY_TRIGGER
} = require("../dist/main/services/chat/chat-context-budget.js") as typeof import("../src/main/services/chat/chat-context-budget");

function createMessage(index: number, role: "user" | "assistant", content = `message-${index}`) {
  return {
    id: crypto.randomUUID(),
    role,
    content
  };
}

test("chat context budget keeps short sessions unchanged", () => {
  const messages = [
    createMessage(1, "user"),
    createMessage(2, "assistant"),
    createMessage(3, "user")
  ];
  const result = budgetChatContext(messages);

  assert.equal(result.summary.compressed, false);
  assert.equal(result.summary.originalMessageCount, messages.length);
  assert.equal(result.summary.providerMessageCount, messages.length);
  assert.equal(result.summary.summaryMessageCount, 0);
  assert.equal(result.summary.summarizedMessageCount, 0);
  assert.equal(result.summary.recentMessageCount, messages.length);
  assert.deepEqual(result.providerMessages.map((message) => message.content), messages.map((message) => message.content));
});

test("chat context budget summarizes older messages without copying their text", () => {
  const oldPrivateText = "old-private-context-that-must-not-appear";
  const messages = Array.from({ length: CHAT_CONTEXT_SUMMARY_TRIGGER + 1 }, (_, index) => (
    createMessage(index, index % 2 === 0 ? "user" : "assistant", index === 0 ? oldPrivateText : `turn-${index}`)
  ));
  const result = budgetChatContext(messages);
  const [summaryMessage, ...recentMessages] = result.providerMessages;

  assert.equal(result.summary.compressed, true);
  assert.equal(result.summary.originalMessageCount, CHAT_CONTEXT_SUMMARY_TRIGGER + 1);
  assert.equal(result.summary.providerMessageCount, CHAT_CONTEXT_RECENT_MESSAGE_BUDGET + 1);
  assert.equal(result.summary.summaryMessageCount, 1);
  assert.equal(result.summary.summarizedMessageCount, messages.length - CHAT_CONTEXT_RECENT_MESSAGE_BUDGET);
  assert.equal(result.summary.recentMessageCount, CHAT_CONTEXT_RECENT_MESSAGE_BUDGET);
  assert.equal(summaryMessage?.role, "system");
  assert.match(summaryMessage?.content ?? "", /context_summary_kind=earlier_history_counts/);
  assert.match(summaryMessage?.content ?? "", /summarizedMessageCount=5/);
  assert.match(summaryMessage?.content ?? "", /summarizedUserMessageCount=3/);
  assert.match(summaryMessage?.content ?? "", /summarizedAssistantMessageCount=2/);
  assert.equal(summaryMessage?.content.includes(oldPrivateText), false);
  assert.deepEqual(
    recentMessages.map((message) => message.content),
    messages.slice(-CHAT_CONTEXT_RECENT_MESSAGE_BUDGET).map((message) => message.content)
  );
});

test("chat context budget supports custom thresholds for focused checks", () => {
  const messages = [
    createMessage(1, "user"),
    createMessage(2, "assistant"),
    createMessage(3, "user"),
    createMessage(4, "assistant")
  ];
  const result = budgetChatContext(messages, { summaryTrigger: 3, recentMessageBudget: 2 });

  assert.equal(result.summary.compressed, true);
  assert.equal(result.summary.providerMessageCount, 3);
  assert.equal(result.summary.summarizedMessageCount, 2);
  assert.equal(result.summary.recentMessageCount, 2);
  assert.deepEqual(result.providerMessages.slice(1).map((message) => message.content), ["message-3", "message-4"]);
});
