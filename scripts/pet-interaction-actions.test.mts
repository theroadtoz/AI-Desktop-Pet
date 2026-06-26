import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  PET_INTERACTION_GLOBAL_COOLDOWN_MS,
  PET_INTERACTION_HEAD_PAT_COOLDOWN_MS,
  PET_INTERACTION_STRONG_ACTION_COOLDOWN_MS,
  PET_INTERACTION_ACTIONS,
  PET_INTERACTION_ACTION_TYPES,
  PET_RANDOM_INTERACTION_ACTIONS,
  createClickActionScheduler,
  getInteractionActionCooldownSkipReason,
  getRandomPetInteractionActionsForMode,
  getPetInteractionAction,
  isStrongInteractionAction,
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
  assert.match(source, /getRandomPetInteractionActionsForMode\(currentDialogueModeId\)/);
  assert.match(source, /getInteractionActionCooldownSkipReason/);
  assert.match(source, /skipReason/);
  assert.match(source, /candidateActionTypes/);
  assert.match(source, /selectedActionType/);
  assert.match(source, /modeId/);
  assert.match(source, /scheduleClickInteractionAction\(hitArea\)/);
  assert.match(source, /!pointerDown \|\| pointerDown\.pointerId !== event\.pointerId/);
  assert.match(source, /!wasDragging && hitArea/);
  assert.match(source, /cancelClickInteractionAction\(\)/);
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

test("renderer telemetry sanitizer keeps safe action policy summary only", async () => {
  const source = await readFile(new URL("../src/main/app.ts", import.meta.url), "utf8");
  const sanitizerStart = source.indexOf("function sanitizeRendererTelemetry");
  const nextFunctionStart = source.indexOf("function isChatSendRequest", sanitizerStart);
  const sanitizer = source.slice(sanitizerStart, nextFunctionStart);

  assert.match(sanitizer, /Array\.isArray\(value\) && value\.every\(\(item\) => typeof item === "string"\)/);
  assert.match(sanitizer, /safePayload\[key\] = value/);
  assert.doesNotMatch(sanitizer, /content|message|apiKey|baseURL|request/);
});

test("pet startup appearance waits for a visible Live2D frame and only plays once per renderer lifecycle", async () => {
  const source = await readFile(new URL("../src/renderer/pet/main.ts", import.meta.url), "utf8");

  assert.match(source, /let hasPlayedStartupAppearance = false/);
  assert.match(source, /waitForNextLive2DFrameSample\(\)/);
  assert.match(source, /!hasPlayedStartupAppearance && sample && sample\.nonTransparentPixels > 0/);
  assert.match(source, /playInteractionAction\(getPetInteractionAction\("appearance"\), "startup_first_visible_frame"\)/);
});
