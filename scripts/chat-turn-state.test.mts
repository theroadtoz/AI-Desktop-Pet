import assert from "node:assert/strict";
import test from "node:test";
import {
  applyChatTurnDelta,
  createInitialChatTurnState,
  finishChatTurn,
  formatChatTurnFinish,
  shouldAcceptChatTurnEvent,
  startChatTurn
} from "../src/renderer/chat/chat-turn-state.ts";

test("chat turn start creates an active request version", () => {
  const started = startChatTurn(createInitialChatTurnState(), "reply-1");

  assert.equal(started.requestVersion, 1);
  assert.equal(started.state.isReplying, true);
  assert.equal(started.state.activeRequestVersion, 1);
  assert.equal(started.state.latestRequestVersion, 1);
  assert.equal(started.state.activeReplyMessageId, "reply-1");
});

test("chat turn delta only appends to the active reply", () => {
  const started = startChatTurn(createInitialChatTurnState(), "reply-1");
  const stale = applyChatTurnDelta(started.state, 99, "旧片段");
  const first = applyChatTurnDelta(started.state, started.requestVersion, "你好");
  const second = applyChatTurnDelta(first.state, started.requestVersion, "，真央");

  assert.equal(stale.accepted, false);
  assert.equal(stale.content, "");
  assert.equal(first.accepted, true);
  assert.equal(second.content, "你好，真央");
});

test("chat turn ignores stale finish events", () => {
  const started = startChatTurn(createInitialChatTurnState(), "reply-1");
  const stale = finishChatTurn(started.state, 2, "回复完成");

  assert.equal(shouldAcceptChatTurnEvent(started.state, 2), false);
  assert.equal(stale.accepted, false);
  assert.equal(stale.state.isReplying, true);
});

test("chat turn finish clears active state and returns lifecycle copy", () => {
  const started = startChatTurn(createInitialChatTurnState(), "reply-1");
  const finished = finishChatTurn(started.state, started.requestVersion, "回复完成");

  assert.equal(finished.accepted, true);
  assert.equal(finished.state.isReplying, false);
  assert.equal(finished.state.activeRequestVersion, null);
  assert.equal(finished.lifecycleEcho, "回复完成");
  assert.equal(finished.sessionNote, "回复完成；下一条仍只发送当前输入。");
  assert.equal(finished.sessionNoteState, "ready");
});

test("chat turn error and abort notes keep existing UI wording", () => {
  assert.deepEqual(formatChatTurnFinish("回复失败"), {
    sessionNote: "回复失败；请检查连接或稍后重试。",
    sessionNoteState: "error"
  });
  assert.deepEqual(formatChatTurnFinish("已中断"), {
    sessionNote: "回复已中断，未保存未完成的助手消息。",
    sessionNoteState: "fallback"
  });
  assert.deepEqual(formatChatTurnFinish("正在回复"), {
    sessionNote: "正在等待她回复；可以随时中断本次生成。",
    sessionNoteState: "ready"
  });
});
