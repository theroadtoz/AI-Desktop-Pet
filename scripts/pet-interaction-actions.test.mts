import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  PET_INTERACTION_ACTIONS,
  PET_INTERACTION_ACTION_TYPES,
  PET_RANDOM_INTERACTION_ACTIONS,
  createClickActionScheduler,
  getPetInteractionAction,
  selectRandomPetInteractionAction
} from "../src/renderer/pet/interaction-actions.ts";

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

test("pet interaction action manifest includes audited expression and accessory candidates", () => {
  const byType = new Map(PET_INTERACTION_ACTIONS.map((action) => [action.type, action]));

  assert.equal(byType.get("greeting")?.expressionName, undefined);
  assert.equal(byType.get("thinking")?.expressionName, undefined);
  assert.equal(byType.get("reading")?.expressionName, "glasses");
  assert.deepEqual(byType.get("reading")?.accessoryPartIds, ["Part53"]);
  assert.equal(byType.get("playGame")?.expressionName, "gestureGame");
  assert.deepEqual(byType.get("playGame")?.accessoryPartIds, ["Part17", "Part21"]);
});

test("ordinary random interaction pool excludes startup and head-only actions", () => {
  assert.deepEqual(
    PET_RANDOM_INTERACTION_ACTIONS.map((action) => action.type).sort(),
    ["greeting", "playGame", "reading", "thinking"].sort()
  );
  assert.equal(selectRandomPetInteractionAction(() => 0).type, "greeting");
  assert.equal(selectRandomPetInteractionAction(() => 0.999).type, "reading");
  assert.equal(getPetInteractionAction("appearance").type, "appearance");
  assert.equal(getPetInteractionAction("headPat").type, "headPat");
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

  assert.match(source, /name: "head"/);
  assert.match(source, /name: "body"/);
  assert.match(source, /getPetInteractionAction\("headPat"\)/);
  assert.match(source, /selectRandomPetInteractionAction\(\)/);
  assert.match(source, /scheduleClickInteractionAction\(hitArea\)/);
  assert.match(source, /!pointerDown \|\| pointerDown\.pointerId !== event\.pointerId/);
  assert.match(source, /!wasDragging && hitArea/);
  assert.match(source, /cancelClickInteractionAction\(\)/);
});

test("pet startup appearance waits for a visible Live2D frame and only plays once per renderer lifecycle", async () => {
  const source = await readFile(new URL("../src/renderer/pet/main.ts", import.meta.url), "utf8");

  assert.match(source, /let hasPlayedStartupAppearance = false/);
  assert.match(source, /waitForNextLive2DFrameSample\(\)/);
  assert.match(source, /!hasPlayedStartupAppearance && sample && sample\.nonTransparentPixels > 0/);
  assert.match(source, /playInteractionAction\(getPetInteractionAction\("appearance"\), "startup_first_visible_frame"\)/);
});
