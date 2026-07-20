import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyExplicitGameContextMessage,
  createCoarseUserStateCoordinator,
  EXPLICIT_GAME_CONTEXT_TTL_MS
} from "../src/main/services/automatic-situation/coarse-user-state-coordinator.ts";
import type {
  CompanionEnvironmentActivity,
  CompanionEnvironmentInterruptibility,
  CompanionEnvironmentSnapshot
} from "../src/main/services/desktop-context/companion-environment.ts";

test("coarse state copies only closed values, ignores raw game metadata, and derives engagement", () => {
  const coordinator = createCoarseUserStateCoordinator();
  const cases: Array<[
    CompanionEnvironmentActivity,
    CompanionEnvironmentInterruptibility,
    "allowed" | "defer" | "suppressed" | "unknown"
  ]> = [
    ["active", "allowed", "allowed"],
    ["idle-short", "allowed", "allowed"],
    ["idle-long", "allowed", "defer"],
    ["away", "unknown", "defer"],
    ["locked", "allowed", "suppressed"],
    ["suspended", "unknown", "suppressed"],
    ["active", "presentation", "suppressed"],
    ["active", "full-screen-activity", "suppressed"],
    ["unknown", "allowed", "unknown"]
  ];

  for (const [activity, interruptibility, engagement] of cases) {
    const state = coordinator.updateEnvironment(snapshot(activity, interruptibility));
    assert.deepEqual(state, {
      activity,
      interruptibility,
      media: "playing",
      timeBand: "evening",
      explicitGameContext: "inactive",
      engagement
    });
    assert.deepEqual(Object.keys(state).sort(), [
      "activity",
      "engagement",
      "explicitGameContext",
      "interruptibility",
      "media",
      "timeBand"
    ]);
    assert.equal("game" in state, false);
    assert.equal("revision" in state, false);
    assert.equal("updatedAtMs" in state, false);
    assert.equal("source" in state, false);
    assert.equal("capability" in state, false);
    assert.equal("confidence" in state, false);
  }
  coordinator.dispose();
});

test("explicit game intent is current-user scoped, end-first, and prefers start over topic words", () => {
  for (const text of [
    "我现在在玩游戏",
    "我准备马上玩一局游戏",
    "我在排位中",
    "朋友已经不玩游戏了，但我现在在玩游戏",
    "朋友不玩了，我继续排位",
    "我正在开发一款游戏，我马上要去玩游戏",
    "我刚看完游戏评测，现在要去玩一局",
    "现在要去打一局游戏",
    "I'm gaming now",
    "I'm playing a game",
    "We're in a match",
    "I want to play the game",
    "Let's play a game",
    "Let's queue a match"
  ]) {
    assert.equal(classifyExplicitGameContextMessage(text), "start", text);
  }
  for (const text of ["我不玩了", "游戏结束了", "刚才不是在玩", "别按游戏状态", "I'm not playing"] ) {
    assert.equal(classifyExplicitGameContextMessage(text), "end-or-correct", text);
  }
  for (const text of [
    "我正在开发一款游戏",
    "我正在打开游戏新闻",
    "现在要去玩手机",
    "现在要去玩音乐",
    "现在继续玩乐器",
    "我打算去玩滑板",
    "I'm playing now",
    "I'm playing guitar",
    "I want to play piano",
    "We're playing music",
    "Let's play some music",
    "今天有哪些游戏新闻",
    "这篇游戏评测怎么样",
    "朋友正在玩游戏",
    "我在读游戏设计文档",
    "I'm reading a game review"
  ]) {
    assert.equal(classifyExplicitGameContextMessage(text), "none", text);
  }
  assert.equal(classifyExplicitGameContextMessage(`${"x".repeat(1_000)}我现在在玩游戏`), "none");
  assert.equal(classifyExplicitGameContextMessage("我准备玩游戏，但刚才不是在玩"), "end-or-correct");
});

test("an early TTL callback or clock rollback reschedules until the real expiry", () => {
  let nowMs = 1_000;
  const scheduled: Array<{ callback: () => void; delayMs: number }> = [];
  const coordinator = createCoarseUserStateCoordinator({
    now: () => nowMs,
    setTimeoutFn: ((callback: () => void, delayMs: number) => {
      scheduled.push({ callback, delayMs });
      return { unref() {} };
    }) as unknown as typeof setTimeout,
    clearTimeoutFn: (() => undefined) as unknown as typeof clearTimeout
  });

  coordinator.handleUserMessage("我现在在玩游戏");
  assert.equal(scheduled[0]?.delayMs, EXPLICIT_GAME_CONTEXT_TTL_MS);

  nowMs = 500;
  scheduled[0]?.callback();
  assert.equal(coordinator.getState().explicitGameContext, "active");
  assert.equal(scheduled[1]?.delayMs, 600_500);

  nowMs = 601_000;
  scheduled[1]?.callback();
  assert.equal(coordinator.getState().explicitGameContext, "inactive");
  coordinator.dispose();
});

test("explicit game start refreshes a ten-minute TTL and end, switch-off, and expiry clear it", () => {
  let nowMs = 1_000;
  let scheduled: (() => void) | null = null;
  const coordinator = createCoarseUserStateCoordinator({
    now: () => nowMs,
    setTimeoutFn: ((callback: () => void) => {
      scheduled = callback;
      return { unref() {} };
    }) as unknown as typeof setTimeout,
    clearTimeoutFn: (() => {
      scheduled = null;
    }) as unknown as typeof clearTimeout
  });

  assert.equal(coordinator.handleUserMessage("我现在在玩游戏"), "start");
  assert.equal(coordinator.getState().explicitGameContext, "active");
  nowMs += EXPLICIT_GAME_CONTEXT_TTL_MS - 1;
  coordinator.tick();
  assert.equal(coordinator.getState().explicitGameContext, "active");

  assert.equal(coordinator.handleUserMessage("我还在排位中"), "start");
  nowMs += EXPLICIT_GAME_CONTEXT_TTL_MS - 1;
  coordinator.tick();
  assert.equal(coordinator.getState().explicitGameContext, "active");
  nowMs += 1;
  scheduled?.();
  assert.equal(coordinator.getState().explicitGameContext, "inactive");

  coordinator.handleUserMessage("我现在在玩游戏");
  coordinator.handleUserMessage("游戏结束了");
  assert.equal(coordinator.getState().explicitGameContext, "inactive");
  coordinator.handleUserMessage("我现在在玩游戏");
  coordinator.setExplicitGameContextEnabled(false);
  assert.equal(coordinator.getState().explicitGameContext, "inactive");
  assert.equal(coordinator.handleUserMessage("我现在在玩游戏"), "start");
  assert.equal(coordinator.getState().explicitGameContext, "inactive");
  coordinator.dispose();
});

test("subscriptions stop after unsubscribe and dispose clears timers without publishing raw state", () => {
  let calls = 0;
  let clearCalls = 0;
  const coordinator = createCoarseUserStateCoordinator({
    setTimeoutFn: (() => ({ unref() {} })) as unknown as typeof setTimeout,
    clearTimeoutFn: (() => { clearCalls += 1; }) as unknown as typeof clearTimeout
  });
  const unsubscribe = coordinator.subscribe(() => { calls += 1; });
  coordinator.handleUserMessage("我现在在玩游戏");
  assert.equal(calls, 1);
  unsubscribe();
  coordinator.handleUserMessage("我不玩了");
  assert.equal(calls, 1);
  coordinator.handleUserMessage("我现在在玩游戏");
  coordinator.dispose();
  assert.equal(coordinator.getState().explicitGameContext, "inactive");
  assert.ok(clearCalls >= 1);
  assert.equal(coordinator.handleUserMessage("我现在在玩游戏"), "none");
});

function snapshot(
  activity: CompanionEnvironmentActivity,
  interruptibility: CompanionEnvironmentInterruptibility
): CompanionEnvironmentSnapshot {
  const signal = (value: string, source: string) => ({
    value,
    source,
    capability: "available",
    confidence: "high",
    changedAtMs: 987_654,
    stableSinceMs: 123_456
  });
  return {
    schemaVersion: 1,
    revision: 99,
    updatedAtMs: 999_999,
    activity: signal(activity, "power-monitor") as CompanionEnvironmentSnapshot["activity"],
    interruptibility: signal(interruptibility, "quns") as CompanionEnvironmentSnapshot["interruptibility"],
    media: signal("playing", "gsmtc") as CompanionEnvironmentSnapshot["media"],
    game: signal("active", "user-explicit") as CompanionEnvironmentSnapshot["game"],
    timeBand: signal("evening", "local-clock") as CompanionEnvironmentSnapshot["timeBand"]
  };
}
