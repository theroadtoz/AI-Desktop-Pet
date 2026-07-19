import assert from "node:assert/strict";
import test from "node:test";
import {
  createPetActionRuntimePolicy,
  PET_LONG_WORK_COOLDOWN_MS,
  PET_LONG_WORK_THRESHOLD_MS,
  shouldTriggerReplyWarmSettle
} from "../src/main/services/pet-action-runtime-policy.ts";
import {
  createReturnFromIdleController,
  getPetInteractionAction,
  PET_RETURN_FROM_IDLE_THRESHOLD_MS
} from "../src/renderer/pet/interaction-actions.ts";
import { getPetActionTriggerActionType } from "../src/shared/pet-action-trigger.ts";

test("P2-77 fixed reasons select only the approved production actions", () => {
  assert.deepEqual({
    headPat: getPetInteractionAction("headPat").motionPresetId,
    bodyAttentionTurn: getPetInteractionAction("bodyAttentionTurn").motionPresetId,
    dialogueOpenWelcome: getPetActionTriggerActionType("chat_opened"),
    replyWarmSettle: getPetActionTriggerActionType("chat_reply_completed"),
    musicListenSway: getPetActionTriggerActionType("state_music_playing_stable"),
    gamePresenceGlance: getPetActionTriggerActionType("state_game_presence_stable"),
    searchNoteSettle: getPetActionTriggerActionType("state_search_cited"),
    returnFromIdle: getPetActionTriggerActionType("return_from_idle"),
    eveningWindowGlance: getPetActionTriggerActionType("evening_companion_tick"),
    longWorkRecovery: getPetActionTriggerActionType("long_work_session_complete")
  }, {
    headPat: "head-pat-linger",
    bodyAttentionTurn: "body-attention-turn",
    dialogueOpenWelcome: "dialogueOpenWelcome",
    replyWarmSettle: "replyWarmSettle",
    musicListenSway: "musicListenSway",
    gamePresenceGlance: "gamePresenceGlance",
    searchNoteSettle: "searchNoteSettle",
    returnFromIdle: "returnFromIdle",
    eveningWindowGlance: "eveningWindowGlance",
    longWorkRecovery: "longWorkRecovery"
  });
});

test("reply settle yields to search, errors, and strong emotion", () => {
  assert.equal(shouldTriggerReplyWarmSettle({ completed: true, hasSearchCitation: false, intensity: "medium" }), true);
  assert.equal(shouldTriggerReplyWarmSettle({ completed: true, hasSearchCitation: true, intensity: "medium" }), false);
  assert.equal(shouldTriggerReplyWarmSettle({ completed: false, hasSearchCitation: false, intensity: "low" }), false);
  assert.equal(shouldTriggerReplyWarmSettle({ completed: true, hasSearchCitation: false, intensity: "high" }), false);
});

test("return-from-idle consumes only the first awake click after two hours", () => {
  let nowMs = 1_000;
  const policy = createReturnFromIdleController({ now: () => nowMs });
  nowMs += PET_RETURN_FROM_IDLE_THRESHOLD_MS;
  assert.equal(policy.consumeClick("default"), true);
  assert.equal(policy.consumeClick("default"), false);
  nowMs += PET_RETURN_FROM_IDLE_THRESHOLD_MS;
  assert.equal(policy.consumeClick("sleep"), false);
});

test("evening tick is sleep-safe and limited to once per local day", () => {
  let nowMs = 1_000;
  let dateKey = "2026-07-19";
  let persistedDateKey: string | null = null;
  const policy = createPetActionRuntimePolicy({
    now: () => nowMs,
    localDateKey: () => dateKey,
    persistEveningDateKey: (value) => {
      persistedDateKey = value;
    }
  });
  assert.equal(policy.onCompanionTick({ presenceModeId: "sleep", timeBand: "evening" }), null);
  assert.equal(policy.onCompanionTick({ presenceModeId: "default", timeBand: "afternoon" }), null);
  assert.equal(policy.onCompanionTick({ presenceModeId: "default", timeBand: "evening" }), "evening_companion_tick");
  assert.equal(persistedDateKey, "2026-07-19");
  assert.equal(policy.onCompanionTick({ presenceModeId: "default", timeBand: "night" }), null);

  const restartedPolicy = createPetActionRuntimePolicy({
    now: () => nowMs,
    localDateKey: () => dateKey
  });
  restartedPolicy.syncEveningDateKey(persistedDateKey);
  assert.equal(
    restartedPolicy.onCompanionTick({ presenceModeId: "default", timeBand: "night" }),
    null
  );

  dateKey = "2026-07-20";
  assert.equal(
    restartedPolicy.onCompanionTick({ presenceModeId: "default", timeBand: "night" }),
    "evening_companion_tick"
  );
});

test("long work recovery requires 120 continuous minutes and enforces four-hour cooldown", () => {
  let nowMs = 1_000;
  const policy = createPetActionRuntimePolicy({ now: () => nowMs });
  policy.syncDialogueMode("default");
  assert.equal(policy.onDialogueModeChanged("work", "default"), null);
  nowMs += PET_LONG_WORK_THRESHOLD_MS - 1;
  assert.equal(policy.onDialogueModeChanged("default", "default"), null);

  assert.equal(policy.onDialogueModeChanged("work", "default"), null);
  nowMs += PET_LONG_WORK_THRESHOLD_MS;
  assert.equal(policy.onDialogueModeChanged("default", "default"), "long_work_session_complete");

  assert.equal(policy.onDialogueModeChanged("work", "default"), null);
  nowMs += PET_LONG_WORK_THRESHOLD_MS;
  assert.equal(policy.onDialogueModeChanged("default", "default"), null);
  nowMs += PET_LONG_WORK_COOLDOWN_MS;
  assert.equal(policy.onDialogueModeChanged("work", "default"), null);
  nowMs += PET_LONG_WORK_THRESHOLD_MS;
  assert.equal(policy.onDialogueModeChanged("default", "default"), "long_work_session_complete");
});

test("sleep resets continuous work time and work restarts only after waking", () => {
  let nowMs = 1_000;
  const policy = createPetActionRuntimePolicy({ now: () => nowMs });
  policy.syncDialogueMode("default");
  policy.syncPresenceMode("default");

  assert.equal(policy.onDialogueModeChanged("work", "default"), null);
  nowMs += PET_LONG_WORK_THRESHOLD_MS / 2;
  policy.onPresenceModeChanged("sleep");
  nowMs += PET_LONG_WORK_THRESHOLD_MS * 2;
  policy.onPresenceModeChanged("default");
  nowMs += PET_LONG_WORK_THRESHOLD_MS - 1;
  assert.equal(policy.onDialogueModeChanged("default", "default"), null);

  assert.equal(policy.onDialogueModeChanged("work", "default"), null);
  nowMs += PET_LONG_WORK_THRESHOLD_MS;
  assert.equal(policy.onDialogueModeChanged("default", "default"), "long_work_session_complete");
});
