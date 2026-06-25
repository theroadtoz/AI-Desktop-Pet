import assert from "node:assert/strict";
import test from "node:test";
import {
  restorePetWindowOnTop,
  showChatWindowAbovePet,
  TOPMOST_WINDOW_LEVEL
} from "../src/main/windows/topmost-policy.ts";

test("pet restoration reasserts topmost without activating the window", () => {
  const calls: string[] = [];

  restorePetWindowOnTop({
    isDestroyed: () => false,
    isVisible: () => false,
    setAlwaysOnTop(flag, level) {
      calls.push(`topmost:${flag}:${level}`);
    },
    showInactive() {
      calls.push("showInactive");
    },
    moveTop() {
      calls.push("moveTop");
    }
  });

  assert.deepEqual(calls, [
    `topmost:true:${TOPMOST_WINDOW_LEVEL}`,
    "showInactive",
    "moveTop"
  ]);
});

test("chat is brought above the pet before it receives focus", () => {
  const calls: string[] = [];

  showChatWindowAbovePet({
    isMinimized: () => true,
    restore() {
      calls.push("restore");
    },
    setAlwaysOnTop(flag, level) {
      calls.push(`topmost:${flag}:${level}`);
    },
    show() {
      calls.push("show");
    },
    moveTop() {
      calls.push("moveTop");
    },
    focus() {
      calls.push("focus");
    }
  });

  assert.deepEqual(calls, [
    "restore",
    `topmost:true:${TOPMOST_WINDOW_LEVEL}`,
    "show",
    "moveTop",
    "focus"
  ]);
});
