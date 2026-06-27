import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  PET_INTERACTION_GLOBAL_COOLDOWN_MS,
  PET_INTERACTION_HEAD_PAT_COOLDOWN_MS,
  PET_INTERACTION_STRONG_ACTION_COOLDOWN_MS,
  PET_WINDOW_SHAKE_LIGHT_FEEDBACK_COOLDOWN_MS,
  PET_INTERACTION_ACTIONS,
  PET_INTERACTION_ACTION_TYPES,
  PET_RANDOM_INTERACTION_ACTIONS,
  createClickActionScheduler,
  getInteractionActionCooldownSkipReason,
  getRandomPetInteractionActionsForMode,
  getPetInteractionAction,
  getWindowShakeLightFeedbackSkipReason,
  isStrongInteractionAction,
  selectRandomPetInteractionAction
} from "../src/renderer/pet/interaction-actions.ts";
import { createInteractionActionPlayer } from "../src/renderer/pet/interaction-action-player.ts";
import {
  PET_TELEMETRY_ALLOWED_FIELDS,
  parsePetRendererTelemetryEvent,
  type PetTelemetryEventType
} from "../src/shared/pet-telemetry-contract.ts";
import {
  PET_BODY_POOL_ACTION_TYPES,
  PET_INTERACTION_ACTION_CATALOG,
  PET_STRONG_ACCESSORY_ACTION_TYPES,
  PET_WINDOW_SHAKE_SAFE_ECHO_MESSAGE,
  getPetInteractionActionSafeEchoMessage,
  getPetWindowMotionFeedbackSafeEchoMessage
} from "../src/shared/interaction-action-catalog.ts";
import {
  PET_BODY_POOL_ACTION_TYPES as SCRIPT_BODY_POOL_ACTION_TYPES,
  PET_INTERACTION_ACTION_CATALOG as SCRIPT_INTERACTION_ACTION_CATALOG,
  PET_STRONG_ACCESSORY_ACTION_TYPES as SCRIPT_STRONG_ACCESSORY_ACTION_TYPES,
  PET_WINDOW_SHAKE_SAFE_ECHO_MESSAGE as SCRIPT_WINDOW_SHAKE_SAFE_ECHO_MESSAGE
} from "./support/pet-action-semantic-constants.mjs";
import type { EmotionPresentation } from "../src/shared/emotion-presentation.ts";
import type { PetAccessoryPresetId } from "../src/shared/pet-accessory.ts";

type FakePlayerTimer = {
  callback: () => void;
  delayMs: number;
  cleared: boolean;
};

function createFakeInteractionActionPlayer() {
  let nowMs = 1_000;
  let persistent: { presentation: EmotionPresentation; accessoryPresetId: PetAccessoryPresetId } = {
    presentation: { emotion: "neutral", intensity: "low", mode: "neutral" },
    accessoryPresetId: "none"
  };
  const timers: FakePlayerTimer[] = [];
  const calls: string[] = [];
  const telemetry: { type: PetTelemetryEventType; payload: Record<string, unknown> }[] = [];
  const player = createInteractionActionPlayer({
    now: () => nowMs,
    scheduleTimeout: (callback, delayMs) => {
      const timer = { callback, delayMs, cleared: false };
      timers.push(timer);
      return timer as ReturnType<typeof setTimeout>;
    },
    clearScheduledTimeout: (handle) => {
      (handle as unknown as FakePlayerTimer).cleared = true;
    },
    getAction: getPetInteractionAction,
    getCooldownSkipReason: getInteractionActionCooldownSkipReason,
    getWindowShakeLightFeedbackSkipReason,
    isStrongAction: isStrongInteractionAction,
    boostInteraction: (durationMs) => {
      calls.push(`boost:${durationMs ?? "default"}`);
    },
    pauseLook: () => {
      calls.push("pauseLook");
    },
    resumeLook: () => {
      calls.push("resumeLook");
    },
    resetLookTarget: () => {
      calls.push("resetLookTarget");
    },
    applyTemporaryPartOpacities: (partIds) => {
      calls.push(`temporaryParts:${partIds.join(",")}`);
    },
    restoreTemporaryPartOpacities: () => {
      calls.push("restoreParts");
    },
    setExpression: (expressionName) => {
      calls.push(`setExpression:${expressionName}`);
    },
    clearExpression: () => {
      calls.push("clearExpression");
    },
    applyPresentation: (presentation, accessoryPresetId) => {
      calls.push(`applyPresentation:${presentation.emotion}:${accessoryPresetId}`);
    },
    getPersistentPresentation: () => persistent,
    reportTelemetry: (type, payload) => {
      telemetry.push({ type, payload });
    }
  });

  return {
    player,
    timers,
    calls,
    telemetry,
    setNow(value: number): void {
      nowMs = value;
    },
    setPersistentAccessory(accessoryPresetId: PetAccessoryPresetId): void {
      persistent = { ...persistent, accessoryPresetId };
    }
  };
}

test("pet interaction action manifest covers the P2-8A action types", () => {
  assert.deepEqual(
    PET_INTERACTION_ACTIONS.map((action) => action.type).sort(),
    [...PET_INTERACTION_ACTION_TYPES].sort()
  );

  for (const action of PET_INTERACTION_ACTIONS) {
    assert.equal(action.weight > 0, true);
    assert.equal(action.durationMs > 0, true);
  }
});

test("pet interaction action catalog covers manifest semantics and safe echoes", () => {
  assert.deepEqual(
    Object.keys(PET_INTERACTION_ACTION_CATALOG).sort(),
    [...PET_INTERACTION_ACTION_TYPES].sort()
  );

  for (const action of PET_INTERACTION_ACTIONS) {
    const semantic = PET_INTERACTION_ACTION_CATALOG[action.type];
    assert.equal(semantic.actionType, action.type);
    assert.equal(semantic.safeEchoMessage.length > 0, true);
    assert.equal(semantic.defaultDurationMs, action.durationMs);
    assert.equal(getPetInteractionActionSafeEchoMessage(action.type), semantic.safeEchoMessage);
  }
});

test("pet interaction action catalog owns body pool eligibility and strong accessory markers", () => {
  assert.deepEqual(
    [...PET_BODY_POOL_ACTION_TYPES].sort(),
    ["focus", "greeting", "playGame", "reading", "thinking"].sort()
  );
  assert.equal(PET_INTERACTION_ACTION_CATALOG.appearance.bodyPoolEligible, false);
  assert.equal(PET_INTERACTION_ACTION_CATALOG.headPat.bodyPoolEligible, false);
  assert.deepEqual([...PET_STRONG_ACCESSORY_ACTION_TYPES].sort(), ["playGame", "reading"].sort());
  assert.equal(PET_INTERACTION_ACTION_CATALOG.playGame.strongAccessory, true);
  assert.equal(PET_INTERACTION_ACTION_CATALOG.reading.strongAccessory, true);
  assert.equal(PET_INTERACTION_ACTION_CATALOG.greeting.strongAccessory, false);
});

test("safe echo helpers reject unknown actions and strip window shake payload detail", () => {
  assert.equal(getPetInteractionActionSafeEchoMessage("unknown_action"), null);
  assert.equal(getPetWindowMotionFeedbackSafeEchoMessage("skipped"), null);
  assert.equal(getPetWindowMotionFeedbackSafeEchoMessage("started"), PET_WINDOW_SHAKE_SAFE_ECHO_MESSAGE);
  assert.equal(PET_WINDOW_SHAKE_SAFE_ECHO_MESSAGE, "刚刚被晃了一下");
  assert.equal(/reason|duration|payload|window_shake_feedback/i.test(PET_WINDOW_SHAKE_SAFE_ECHO_MESSAGE), false);
});

test("main pet activity echo delegates safe messages to the shared catalog helpers", async () => {
  const source = await readFile(new URL("../src/main/app.ts", import.meta.url), "utf8");
  const createEchoStart = source.indexOf("function createPetActivityEcho");
  const createEchoEnd = source.indexOf("function startPerformanceHeartbeat", createEchoStart);
  const createEchoSource = source.slice(createEchoStart, createEchoEnd);

  assert.notEqual(createEchoStart, -1);
  assert.match(createEchoSource, /getPetInteractionActionSafeEchoMessage\(payload\.type\)/);
  assert.match(createEchoSource, /getPetWindowMotionFeedbackSafeEchoMessage\(payload\.result\)/);
  assert.match(createEchoSource, /return message \? \{ message \} : null/);
  assert.doesNotMatch(createEchoSource, /case "headPat"|case "playGame"|刚刚摸头|刚刚玩游戏|durationMs|reason/);
});

test("real UI script action constants stay aligned with the shared catalog", () => {
  assert.deepEqual(
    Object.keys(SCRIPT_INTERACTION_ACTION_CATALOG).sort(),
    Object.keys(PET_INTERACTION_ACTION_CATALOG).sort()
  );
  assert.deepEqual([...SCRIPT_BODY_POOL_ACTION_TYPES].sort(), [...PET_BODY_POOL_ACTION_TYPES].sort());
  assert.deepEqual([...SCRIPT_STRONG_ACCESSORY_ACTION_TYPES].sort(), [...PET_STRONG_ACCESSORY_ACTION_TYPES].sort());
  assert.equal(SCRIPT_WINDOW_SHAKE_SAFE_ECHO_MESSAGE, PET_WINDOW_SHAKE_SAFE_ECHO_MESSAGE);

  for (const type of PET_INTERACTION_ACTION_TYPES) {
    assert.equal(
      SCRIPT_INTERACTION_ACTION_CATALOG[type]?.safeEchoMessage,
      PET_INTERACTION_ACTION_CATALOG[type].safeEchoMessage
    );
    assert.equal(
      SCRIPT_INTERACTION_ACTION_CATALOG[type]?.defaultDurationMs,
      PET_INTERACTION_ACTION_CATALOG[type].defaultDurationMs
    );
  }
});

test("pet interaction action manifest includes audited expression and accessory candidates", () => {
  const byType = new Map(PET_INTERACTION_ACTIONS.map((action) => [action.type, action]));

  assert.equal(byType.get("greeting")?.expressionName, undefined);
  assert.equal(byType.get("thinking")?.expressionName, undefined);
  assert.equal(byType.get("focus")?.expressionName, undefined);
  assert.equal(byType.get("focus")?.accessoryPartIds, undefined);
  assert.equal(byType.get("reading")?.expressionName, "glasses");
  assert.deepEqual(byType.get("reading")?.accessoryPartIds, ["Part53"]);
  assert.equal(byType.get("playGame")?.expressionName, "gestureGame");
  assert.deepEqual(byType.get("playGame")?.accessoryPartIds, ["Part17", "Part21"]);
});

test("ordinary random interaction pool excludes startup and head-only actions", () => {
  assert.deepEqual(
    PET_RANDOM_INTERACTION_ACTIONS.map((action) => action.type).sort(),
    ["focus", "greeting", "playGame", "reading", "thinking"].sort()
  );
  assert.equal(selectRandomPetInteractionAction(() => 0).type, "greeting");
  assert.equal(selectRandomPetInteractionAction(() => 0.4).type, "greeting");
  assert.equal(selectRandomPetInteractionAction(() => 0.45).type, "thinking");
  assert.equal(selectRandomPetInteractionAction(() => 0.78).type, "playGame");
  assert.equal(selectRandomPetInteractionAction(() => 0.89).type, "reading");
  assert.equal(selectRandomPetInteractionAction(() => 0.95).type, "focus");
  assert.equal(selectRandomPetInteractionAction(() => 0.999).type, "focus");
  assert.equal(getPetInteractionAction("appearance").type, "appearance");
  assert.equal(getPetInteractionAction("headPat").type, "headPat");
});

test("dialogue modes adjust ordinary body action weights without changing the default pool", () => {
  function weightsFor(modeId: "default" | "work" | "game" | "reading") {
    return Object.fromEntries(getRandomPetInteractionActionsForMode(modeId).map((action) => [action.type, action.weight]));
  }

  assert.deepEqual(weightsFor("default"), {
    greeting: 4,
    thinking: 3,
    playGame: 1,
    reading: 1,
    focus: 0.5
  });
  assert.deepEqual(
    getRandomPetInteractionActionsForMode("default").map((action) => action.type).sort(),
    ["focus", "greeting", "playGame", "reading", "thinking"].sort()
  );
  assert.equal(weightsFor("game").playGame, 4);
  assert.equal(weightsFor("game").focus, 0);
  assert.equal(weightsFor("reading").reading, 4);
  assert.equal(weightsFor("reading").focus, 1);
  assert.equal(weightsFor("work").thinking, 4);
  assert.equal(weightsFor("work").focus, 3);
  assert.equal(weightsFor("work").playGame, 0.5);
  assert.equal(getRandomPetInteractionActionsForMode("game").some((action) => action.type === "appearance" || action.type === "headPat"), false);
});

test("dialogue mode body action selection follows mode weights", () => {
  assert.equal(selectRandomPetInteractionAction(() => 0.68, getRandomPetInteractionActionsForMode("default")).type, "thinking");
  assert.equal(selectRandomPetInteractionAction(() => 0.68, getRandomPetInteractionActionsForMode("game")).type, "playGame");
  assert.equal(selectRandomPetInteractionAction(() => 0.72, getRandomPetInteractionActionsForMode("reading")).type, "reading");
  assert.equal(selectRandomPetInteractionAction(() => 0.95, getRandomPetInteractionActionsForMode("reading")).type, "focus");
  assert.equal(selectRandomPetInteractionAction(() => 0.8, getRandomPetInteractionActionsForMode("work")).type, "focus");
  assert.notEqual(selectRandomPetInteractionAction(() => 0.68, getRandomPetInteractionActionsForMode("work")).type, "playGame");
});

test("pet interaction action selection follows manifest weights", () => {
  const actions = [
    {
      type: "appearance",
      weight: 1,
      durationMs: 100,
      presentation: { emotion: "neutral", intensity: "low", mode: "neutral" }
    },
    {
      type: "headPat",
      weight: 3,
      durationMs: 100,
      presentation: { emotion: "happy", intensity: "medium", mode: "micro" }
    }
  ] as const;

  assert.equal(selectRandomPetInteractionAction(() => 0, actions).type, "appearance");
  assert.equal(selectRandomPetInteractionAction(() => 0.249, actions).type, "appearance");
  assert.equal(selectRandomPetInteractionAction(() => 0.25, actions).type, "headPat");
  assert.equal(selectRandomPetInteractionAction(() => 0.999, actions).type, "headPat");
});

test("pet interaction action selection rejects invalid manifests", () => {
  assert.throws(() => selectRandomPetInteractionAction(() => 0, []), /manifest is empty/);
  assert.throws(
    () => selectRandomPetInteractionAction(() => 0, [{
      type: "appearance",
      weight: 0,
      durationMs: 100,
      presentation: { emotion: "neutral", intensity: "low", mode: "neutral" }
    }]),
    /no selectable weight/
  );
});

test("pet interaction action cooldown rules skip dense or repeated clicks", () => {
  const headPat = getPetInteractionAction("headPat");
  const greeting = getPetInteractionAction("greeting");
  const playGame = getPetInteractionAction("playGame");
  const reading = getPetInteractionAction("reading");

  assert.equal(isStrongInteractionAction("playGame"), true);
  assert.equal(isStrongInteractionAction("reading"), true);
  assert.equal(isStrongInteractionAction("greeting"), false);
  assert.equal(
    getInteractionActionCooldownSkipReason(greeting, 1_000, { activeType: "thinking" }),
    "active_action"
  );
  assert.equal(
    getInteractionActionCooldownSkipReason(greeting, 1_000, {
      lastActionFinishedAtMs: 1_000 - PET_INTERACTION_GLOBAL_COOLDOWN_MS + 1
    }),
    "global_cooldown"
  );
  assert.equal(
    getInteractionActionCooldownSkipReason(headPat, 2_000, {
      lastHeadPatFinishedAtMs: 2_000 - PET_INTERACTION_HEAD_PAT_COOLDOWN_MS + 1
    }),
    "head_pat_cooldown"
  );
  assert.equal(
    getInteractionActionCooldownSkipReason(playGame, 5_000, {
      strongActionFinishedAtMsByType: {
        playGame: 5_000 - PET_INTERACTION_STRONG_ACTION_COOLDOWN_MS + 1,
        reading: 5_000 - PET_INTERACTION_STRONG_ACTION_COOLDOWN_MS + 1
      }
    }),
    "same_action_cooldown"
  );
  assert.equal(
    getInteractionActionCooldownSkipReason(reading, 5_000, {
      strongActionFinishedAtMsByType: {
        playGame: 5_000 - PET_INTERACTION_STRONG_ACTION_COOLDOWN_MS + 1
      }
    }),
    null
  );
});

test("window shake light feedback reuses thinking with active and independent cooldown guards", () => {
  const thinking = getPetInteractionAction("thinking");

  assert.equal(thinking.presentation.emotion, "confused");
  assert.equal(thinking.expressionName, undefined);
  assert.equal(thinking.accessoryPartIds, undefined);
  assert.equal(
    getWindowShakeLightFeedbackSkipReason(thinking, 1_000, { activeType: "headPat" }),
    "active_action"
  );
  assert.equal(
    getWindowShakeLightFeedbackSkipReason(thinking, 2_000, {
      lastActionFinishedAtMs: 2_000 - PET_INTERACTION_GLOBAL_COOLDOWN_MS + 1
    }),
    "global_cooldown"
  );
  assert.equal(
    getWindowShakeLightFeedbackSkipReason(thinking, 20_000, {
      lastWindowShakeFeedbackStartedAtMs: 20_000 - PET_WINDOW_SHAKE_LIGHT_FEEDBACK_COOLDOWN_MS + 1
    }),
    "window_shake_feedback_cooldown"
  );
  assert.equal(
    getWindowShakeLightFeedbackSkipReason(thinking, 20_000, {
      lastWindowShakeFeedbackStartedAtMs: 20_000 - PET_WINDOW_SHAKE_LIGHT_FEEDBACK_COOLDOWN_MS
    }),
    null
  );
});

test("interaction action player owns start, finish, restore, and finished telemetry", () => {
  const harness = createFakeInteractionActionPlayer();
  const reading = getPetInteractionAction("reading");

  assert.equal(harness.player.playAction(reading, "click_body", {
    modeId: "reading",
    candidateActionTypes: ["greeting", "thinking", "reading"]
  }), true);
  assert.equal(harness.player.isActive(), true);
  assert.equal(harness.player.getActiveActionType(), "reading");
  assert.deepEqual(harness.calls, [
    `boost:${reading.durationMs + 250}`,
    "pauseLook",
    "temporaryParts:Part53",
    "setExpression:glasses"
  ]);
  assert.equal(harness.timers.length, 1);
  assert.equal(harness.timers[0]?.delayMs, reading.durationMs);
  assert.deepEqual(harness.telemetry[0], {
    type: "pet_interaction_action_started",
    payload: {
      type: "reading",
      reason: "click_body",
      durationMs: reading.durationMs,
      modeId: "reading",
      candidateActionTypes: ["greeting", "thinking", "reading"],
      selectedActionType: "reading"
    }
  });

  harness.setPersistentAccessory("glasses");
  harness.setNow(1_000 + reading.durationMs);
  harness.timers[0]?.callback();

  assert.equal(harness.player.isActive(), false);
  assert.deepEqual(harness.calls.slice(4), [
    "restoreParts",
    "clearExpression",
    "resetLookTarget",
    "resumeLook",
    "applyPresentation:neutral:glasses"
  ]);
  assert.deepEqual(harness.telemetry[1], {
    type: "pet_interaction_action_finished",
    payload: {
      type: "reading",
      reason: "click_body",
      restoredAccessoryPresetId: "glasses"
    }
  });
});

test("interaction action player prevents stacking and reports active action skips", () => {
  const harness = createFakeInteractionActionPlayer();
  const thinking = getPetInteractionAction("thinking");

  assert.equal(harness.player.playAction(thinking, "click_body"), true);
  assert.equal(harness.player.playAction(getPetInteractionAction("headPat"), "click_head"), false);

  assert.deepEqual(harness.telemetry[1], {
    type: "pet_interaction_action_skipped",
    payload: {
      type: "headPat",
      reason: "click_head",
      skipReason: "active_action",
      activeType: "thinking"
    }
  });
});

test("interaction action player keeps global, headPat, and strong accessory cooldowns", () => {
  const globalHarness = createFakeInteractionActionPlayer();
  const greeting = getPetInteractionAction("greeting");
  assert.equal(globalHarness.player.playAction(greeting, "click_body"), true);
  globalHarness.setNow(1_000 + greeting.durationMs);
  globalHarness.timers[0]?.callback();
  globalHarness.setNow(1_000 + greeting.durationMs + PET_INTERACTION_GLOBAL_COOLDOWN_MS - 1);
  assert.equal(globalHarness.player.playAction(getPetInteractionAction("thinking"), "click_body"), false);
  assert.equal(globalHarness.telemetry.at(-1)?.payload.skipReason, "global_cooldown");

  const headHarness = createFakeInteractionActionPlayer();
  const headPat = getPetInteractionAction("headPat");
  assert.equal(headHarness.player.playAction(headPat, "click_head"), true);
  headHarness.setNow(1_000 + headPat.durationMs);
  headHarness.timers[0]?.callback();
  headHarness.setNow(1_000 + headPat.durationMs + PET_INTERACTION_HEAD_PAT_COOLDOWN_MS - 1);
  assert.equal(headHarness.player.playAction(headPat, "click_head"), false);
  assert.equal(headHarness.telemetry.at(-1)?.payload.skipReason, "head_pat_cooldown");

  const strongHarness = createFakeInteractionActionPlayer();
  const playGame = getPetInteractionAction("playGame");
  assert.equal(strongHarness.player.playAction(playGame, "click_body"), true);
  strongHarness.setNow(1_000 + playGame.durationMs);
  strongHarness.timers[0]?.callback();
  strongHarness.setNow(1_000 + playGame.durationMs + PET_INTERACTION_GLOBAL_COOLDOWN_MS + 1);
  assert.equal(strongHarness.player.playAction(playGame, "click_body"), false);
  assert.equal(strongHarness.telemetry.at(-1)?.payload.skipReason, "same_action_cooldown");
});

test("interaction action player owns window shake feedback lifecycle and cooldown telemetry", () => {
  const harness = createFakeInteractionActionPlayer();
  const thinking = getPetInteractionAction("thinking");

  assert.equal(harness.player.playWindowShakeLightFeedback(), true);
  assert.deepEqual(harness.telemetry.map((event) => event.type), [
    "pet_interaction_action_started",
    "pet_window_motion_feedback"
  ]);
  assert.deepEqual(harness.telemetry[0]?.payload, {
    type: "thinking",
    reason: "window_shake_feedback",
    durationMs: thinking.durationMs
  });
  assert.deepEqual(harness.telemetry[1]?.payload, {
    eventType: "window_shake_candidate",
    reason: "window_shake_feedback",
    feedbackType: "shake_light_feedback",
    result: "started",
    cooldownState: "available",
    durationMs: thinking.durationMs
  });

  harness.setNow(1_000 + thinking.durationMs);
  harness.timers[0]?.callback();
  harness.setNow(1_000 + PET_WINDOW_SHAKE_LIGHT_FEEDBACK_COOLDOWN_MS - 1);

  assert.equal(harness.player.playWindowShakeLightFeedback(), false);
  assert.deepEqual(harness.telemetry.at(-1), {
    type: "pet_window_motion_feedback",
    payload: {
      eventType: "window_shake_candidate",
      reason: "window_shake_feedback",
      feedbackType: "shake_light_feedback",
      result: "skipped",
      skipReason: "window_shake_feedback_cooldown",
      cooldownState: "cooling_down",
      durationMs: thinking.durationMs
    }
  });
});

test("interaction action player only emits renderer telemetry contract fields", () => {
  const harness = createFakeInteractionActionPlayer();
  const reading = getPetInteractionAction("reading");
  const allowedFields = new Set(PET_TELEMETRY_ALLOWED_FIELDS);

  harness.player.playAction(reading, "click_body", {
    modeId: "reading",
    candidateActionTypes: ["greeting", "thinking", "reading"]
  });
  harness.player.playAction(getPetInteractionAction("headPat"), "click_head");
  harness.setPersistentAccessory("glasses");
  harness.setNow(1_000 + reading.durationMs);
  harness.timers[0]?.callback();
  harness.setNow(1_000 + PET_WINDOW_SHAKE_LIGHT_FEEDBACK_COOLDOWN_MS - 1);
  harness.player.playWindowShakeLightFeedback();

  assert.equal(harness.telemetry.length, 5);
  for (const event of harness.telemetry) {
    assert.notEqual(parsePetRendererTelemetryEvent(event), null);
    for (const key of Object.keys(event.payload)) {
      assert.equal(allowedFields.has(key as typeof PET_TELEMETRY_ALLOWED_FIELDS[number]), true, key);
    }
    assert.deepEqual(Object.keys(event.payload).filter((key) => (
      /prompt|message|content|api|key|body|path|url/i.test(key)
    )), []);
  }
});

test("click action scheduler delays clicks and lets double click cancel the action", () => {
  type FakeTimer = {
    callback: () => void;
    delayMs: number;
    cleared: boolean;
  };

  const timers: FakeTimer[] = [];
  let triggered = 0;
  const scheduler = createClickActionScheduler({
    delayMs: 220,
    trigger: () => {
      triggered += 1;
    },
    setTimeoutFn: (callback, delayMs) => {
      const timer = { callback, delayMs, cleared: false };
      timers.push(timer);
      return timer as ReturnType<typeof setTimeout>;
    },
    clearTimeoutFn: (handle) => {
      (handle as unknown as FakeTimer).cleared = true;
    }
  });

  scheduler.schedule();
  assert.equal(timers.length, 1);
  assert.equal(timers[0]?.delayMs, 220);

  scheduler.cancel();
  assert.equal(timers[0]?.cleared, true);
  assert.equal(triggered, 0);

  scheduler.schedule();
  const activeTimer = timers[1];
  assert.equal(activeTimer?.cleared, false);
  activeTimer?.callback();
  assert.equal(triggered, 1);
});

test("pet pointermove no longer drives the Live2D look target", async () => {
  const source = await readFile(new URL("../src/renderer/pet/main.ts", import.meta.url), "utf8");
  const pointerMoveStart = source.indexOf('canvas.addEventListener("pointermove"');
  const pointerDownStart = source.indexOf('canvas.addEventListener("pointerdown"');

  assert.notEqual(pointerMoveStart, -1);
  assert.notEqual(pointerDownStart, -1);

  const pointerMoveHandler = source.slice(pointerMoveStart, pointerDownStart);

  assert.equal(pointerMoveHandler.includes("setLookTarget"), false);
});

test("pet pointer clicks route head and body actions without changing drag or double-click guards", async () => {
  const source = await readFile(new URL("../src/renderer/pet/main.ts", import.meta.url), "utf8");
  const playerSource = await readFile(new URL("../src/renderer/pet/interaction-action-player.ts", import.meta.url), "utf8");

  assert.match(source, /name: "head"/);
  assert.match(source, /name: "body"/);
  assert.match(source, /getPetInteractionAction\("headPat"\)/);
  assert.match(source, /getRandomPetInteractionActionsForMode\(currentDialogueModeId\)/);
  assert.match(source, /createInteractionActionPlayer/);
  assert.match(source, /interactionActionPlayer\.playAction/);
  assert.match(source, /getCooldownSkipReason: getInteractionActionCooldownSkipReason/);
  assert.match(playerSource, /getCooldownSkipReason/);
  assert.match(playerSource, /skipReason/);
  assert.match(source, /candidateActionTypes/);
  assert.match(playerSource, /selectedActionType/);
  assert.match(source, /modeId/);
  assert.match(source, /scheduleClickInteractionAction\(hitArea\)/);
  assert.match(source, /!pointerDown \|\| pointerDown\.pointerId !== event\.pointerId/);
  assert.match(source, /!wasDragging && hitArea/);
  assert.match(source, /cancelClickInteractionAction\(\)/);
});

test("window shake feedback IPC uses a fixed safe enum and dedicated reason", async () => {
  const petPreload = await readFile(new URL("../src/preload/pet-preload.ts", import.meta.url), "utf8");
  const appSource = await readFile(new URL("../src/main/app.ts", import.meta.url), "utf8");
  const rendererSource = await readFile(new URL("../src/renderer/pet/main.ts", import.meta.url), "utf8");
  const playerSource = await readFile(new URL("../src/renderer/pet/interaction-action-player.ts", import.meta.url), "utf8");

  assert.match(appSource, /candidate\.eventType === "window_shake_candidate"/);
  assert.match(appSource, /window\.webContents\.send\("pet:window-motion-feedback",\s*{\s*type: "shake_light_feedback"\s*}\)/s);
  assert.match(appSource, /"pet_window_motion_feedback"/);
  assert.match(petPreload, /isPetWindowMotionFeedback/);
  assert.match(petPreload, /type === "shake_light_feedback"/);
  const feedbackPreloadStart = petPreload.indexOf("onWindowMotionFeedback(handler)");
  const feedbackPreloadEnd = petPreload.indexOf("openChat()", feedbackPreloadStart);
  const feedbackPreload = petPreload.slice(feedbackPreloadStart, feedbackPreloadEnd);
  assert.doesNotMatch(feedbackPreload, /expressionName|partIds|durationMs|\.motion|motion:/);
  assert.match(rendererSource, /onWindowMotionFeedback/);
  assert.match(rendererSource, /interactionActionPlayer\.playWindowShakeLightFeedback\(\)/);
  assert.match(rendererSource, /getAction: getPetInteractionAction/);
  assert.match(playerSource, /getAction\("thinking"\)/);
  assert.match(playerSource, /"window_shake_feedback"/);
  assert.match(playerSource, /getWindowShakeLightFeedbackSkipReason/);
  assert.doesNotMatch(rendererSource, /feedback\.(expression|motion|part|duration|resource)/);
});

test("pet renderer reads dialogue mode without owning mode writes", async () => {
  const petPreload = await readFile(new URL("../src/preload/pet-preload.ts", import.meta.url), "utf8");
  const appSource = await readFile(new URL("../src/main/app.ts", import.meta.url), "utf8");

  assert.match(petPreload, /getDialogueMode/);
  assert.match(petPreload, /onDialogueModeChanged/);
  assert.doesNotMatch(petPreload, /dialogueMode:set/);
  assert.match(appSource, /!isChatSender\(event\) && !isPetSender\(event\)/);
  assert.match(appSource, /notifyPetDialogueModeChanged\(currentDialogueModeId\)/);
});

test("renderer telemetry sanitizer delegates to the shared pet telemetry contract", async () => {
  const source = await readFile(new URL("../src/main/app.ts", import.meta.url), "utf8");

  assert.match(source, /parsePetRendererTelemetryEvent/);
  assert.match(source, /sanitizePetTelemetryEvent/);
  assert.doesNotMatch(source, /function sanitizeRendererTelemetry/);
});

test("pet startup appearance waits for a visible Live2D frame and only plays once per renderer lifecycle", async () => {
  const source = await readFile(new URL("../src/renderer/pet/main.ts", import.meta.url), "utf8");

  assert.match(source, /let hasPlayedStartupAppearance = false/);
  assert.match(source, /waitForNextLive2DFrameSample\(\)/);
  assert.match(source, /!hasPlayedStartupAppearance && sample && sample\.nonTransparentPixels > 0/);
  assert.match(source, /interactionActionPlayer\.playAction\(getPetInteractionAction\("appearance"\), "startup_first_visible_frame"\)/);
});
