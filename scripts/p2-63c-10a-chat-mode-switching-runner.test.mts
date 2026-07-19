import assert from "node:assert/strict";
import test from "node:test";

import {
  findActionFinishedAfter,
  findHeadActionOutcomeAfter,
  findTelemetryEventAfter,
  isExpectedModeReply,
  isModeActionStarted,
  runHeadCheckAfterBodyAction,
  summarizeHeadActionOutcome
} from "./p2-10c-chat-mode-switching-real-ui.mjs";

function event(index: number, type: string, payload: Record<string, unknown>) {
  return { __index: index, type, payload };
}

test("P2-10C telemetry lookup excludes stale events at or before the action baseline", () => {
  const events = [
    event(0, "pet_interaction_action_started", { type: "greeting", reason: "click_body" }),
    event(1, "dialogue_mode_changed", { nextModeId: "default" }),
    event(2, "pet_interaction_action_started", { type: "thinking", reason: "click_body" })
  ];

  const found = findTelemetryEventAfter(
    events,
    1,
    (candidate) => candidate.type === "pet_interaction_action_started"
  );

  assert.equal(found?.__index, 2);
  assert.equal(found?.payload?.type, "thinking");
});

test("P2-10C finished lookup follows the matching started event in causal order", () => {
  const started = event(3, "pet_interaction_action_started", {
    type: "greeting",
    reason: "click_body"
  });
  const events = [
    event(2, "pet_interaction_action_finished", { type: "greeting", reason: "click_body" }),
    started,
    event(4, "pet_interaction_action_finished", { type: "headPat", reason: "click_head" }),
    event(5, "pet_interaction_action_finished", { type: "greeting", reason: "click_body" })
  ];

  const finished = findActionFinishedAfter(events, started);

  assert.equal(finished?.__index, 5);
});

test("P2-10C mode checks use scheduled state actions instead of the P2-77 fixed body click", () => {
  const stateWork = event(4, "pet_interaction_action_started", {
    modeId: "work",
    selectedActionType: "workFocus",
    reason: "state_work"
  });
  const fixedBodyClick = event(5, "pet_interaction_action_started", {
    modeId: "work",
    selectedActionType: "bodyAttentionTurn",
    reason: "click_body"
  });

  assert.equal(isModeActionStarted(stateWork, {
    modeId: "work",
    actionTypes: ["workFocus"],
    reasons: ["state_work"]
  }), true);
  assert.equal(isModeActionStarted(fixedBodyClick, {
    modeId: "work",
    actionTypes: ["workFocus"],
    reasons: ["state_work"]
  }), false);
});

test("P2-10C mode reply checks follow the current companion-style FakeProvider prefixes", () => {
  assert.equal(isExpectedModeReply("work", "我安静陪你。我愿意陪你在这里多待一会儿。"), true);
  assert.equal(isExpectedModeReply("game", "好，来点轻快的。嗯，我在。"), true);
  assert.equal(isExpectedModeReply("reading", "我安静听着。我愿意陪你在这里多待一会儿。"), true);
  assert.equal(isExpectedModeReply("work", "先抓下一步。"), false);
  assert.equal(isExpectedModeReply("default", "我听到了。"), false);
});

test("P2-10C head orchestration never clicks when the body action is missing, unfinished, or mismatched", async () => {
  const bodyStarted = event(3, "pet_interaction_action_started", {
    type: "greeting",
    reason: "click_body"
  });
  const mismatchedFinished = event(5, "pet_interaction_action_finished", {
    type: "thinking",
    reason: "click_body"
  });

  for (const bodyAction of [
    null,
    { started: bodyStarted, finished: null },
    { started: bodyStarted, finished: mismatchedFinished }
  ]) {
    let clickCount = 0;
    let baselineCount = 0;
    let waitCount = 0;
    let sleepCount = 0;

    const result = await runHeadCheckAfterBodyAction({
      runBodyAction: async () => bodyAction,
      sleep: async () => { sleepCount += 1; },
      captureBaseline: () => { baselineCount += 1; return 8; },
      clickHead: async () => { clickCount += 1; },
      waitForHeadOutcome: async () => { waitCount += 1; return null; }
    });

    assert.equal(clickCount, 0);
    assert.equal(baselineCount, 0);
    assert.equal(waitCount, 0);
    assert.equal(sleepCount, 0);
    assert.equal(result.bodyActionCompleted, false);
    assert.equal(result.headAction, null);
    assert.deepEqual(result.diagnostic, {
      eventType: "not_attempted",
      reason: "body_action_incomplete"
    });
  }
});

test("P2-10C head orchestration waits for body completion and 550ms cooldown before clicking", async () => {
  const order: string[] = [];
  const bodyStarted = event(3, "pet_interaction_action_started", {
    type: "greeting",
    reason: "click_body"
  });
  const bodyFinished = event(5, "pet_interaction_action_finished", {
    type: "greeting",
    reason: "click_body"
  });
  const headStarted = event(9, "pet_interaction_action_started", {
    type: "headPat",
    reason: "click_head"
  });

  const result = await runHeadCheckAfterBodyAction({
    runBodyAction: async () => {
      order.push("body_started");
      order.push("body_finished");
      return { started: bodyStarted, finished: bodyFinished };
    },
    sleep: async (ms: number) => { order.push(`sleep:${ms}`); },
    captureBaseline: () => { order.push("baseline"); return 7; },
    clickHead: async () => { order.push("click_head"); },
    waitForHeadOutcome: async (afterIndex: number) => {
      order.push(`wait_after:${afterIndex}`);
      return headStarted;
    }
  });

  assert.deepEqual(order, [
    "body_started",
    "body_finished",
    "sleep:550",
    "baseline",
    "click_head",
    "wait_after:7"
  ]);
  assert.equal(result.bodyAction?.finished, bodyFinished);
  assert.equal(result.bodyActionCompleted, true);
  assert.equal(result.headAction, headStarted);
  assert.deepEqual(result.diagnostic, { eventType: "started" });
});

test("P2-10C head outcome ignores stale starts and preserves skipped diagnostics", () => {
  const events = [
    event(1, "pet_interaction_action_started", { type: "headPat", reason: "click_head" }),
    event(4, "pet_interaction_action_skipped", {
      type: "headPat",
      reason: "click_head",
      skipReason: "active_action",
      activeType: "greeting"
    })
  ];

  const outcome = findHeadActionOutcomeAfter(events, 2);

  assert.equal(outcome?.__index, 4);
  assert.deepEqual(summarizeHeadActionOutcome(outcome), {
    eventType: "skipped",
    skipReason: "active_action",
    activeType: "greeting"
  });
});
