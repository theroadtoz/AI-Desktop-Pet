import assert from "node:assert/strict";
import test from "node:test";
import {
  createReplyInteractionLockState,
  REPLY_LOCKED_CONTROL_GROUPS,
  REPLY_LOCKED_CONTROL_IDS,
  REPLY_UNLOCKED_CONTROL_IDS
} from "../src/renderer/chat/interaction-lock.ts";

test("reply lock list includes existing key chat controls", () => {
  assert.ok(REPLY_LOCKED_CONTROL_IDS.includes("chat-input"));
  assert.ok(!REPLY_LOCKED_CONTROL_IDS.includes("send-button"));
  assert.ok(REPLY_LOCKED_CONTROL_IDS.includes("settings-button"));
  assert.ok(REPLY_LOCKED_CONTROL_IDS.includes("history-tab"));
  assert.ok(REPLY_LOCKED_CONTROL_IDS.includes("memory-tab"));
  assert.ok(REPLY_LOCKED_CONTROL_IDS.includes("save-memory-draft-button"));
  assert.ok(REPLY_LOCKED_CONTROL_IDS.includes("shelf-accessory-button"));
  assert.ok(REPLY_LOCKED_CONTROL_IDS.includes("shelf-scale-button"));
  assert.ok(REPLY_LOCKED_CONTROL_IDS.includes("shelf-lock-button"));
  assert.ok(REPLY_UNLOCKED_CONTROL_IDS.includes("abort-button"));
});

test("reply lock list includes dynamic control groups", () => {
  assert.deepEqual(REPLY_LOCKED_CONTROL_GROUPS, [
    "dialogue-mode-buttons",
    "presence-mode-buttons",
    "history-detail-buttons",
    "settings-form-controls"
  ]);
});

test("replying true disables locked controls while send stays available for stop state", () => {
  const state = createReplyInteractionLockState(true);
  const controls = new Map(state.controls.map((control) => [control.controlId, control.disabled]));

  assert.equal(controls.get("chat-input"), true);
  assert.equal(controls.has("send-button"), false);
  assert.equal(controls.get("abort-button"), false);
  assert.equal(state.groupsDisabled, true);
});

test("replying false unlocks controls and disables abort", () => {
  const state = createReplyInteractionLockState(false);
  const controls = new Map(state.controls.map((control) => [control.controlId, control.disabled]));

  assert.equal(controls.get("chat-input"), false);
  assert.equal(controls.has("send-button"), false);
  assert.equal(controls.get("abort-button"), true);
  assert.equal(state.groupsDisabled, false);
});
