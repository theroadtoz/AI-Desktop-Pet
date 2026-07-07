import assert from "node:assert/strict";
import test from "node:test";
import { DIALOGUE_MODE_VIEWS } from "../src/shared/dialogue-style.ts";
import {
  listDailyStateOrchestrationRules,
  listLowFrequencyCompanionEvents,
  selectLowFrequencyCompanionEvent
} from "../src/shared/daily-state-orchestration.ts";
import {
  PET_ACTION_STATE_IDS,
  isPetActionStateId
} from "../src/shared/pet-action-state-machine.ts";
import { PROACTIVE_SPEECH_BUBBLE_REASONS } from "../src/shared/proactive-speech-bubble.ts";
import { PRESENCE_MODE_VIEWS } from "../src/shared/presence-mode.ts";

const KNOWN_DIALOGUE_MODE_IDS = new Set(DIALOGUE_MODE_VIEWS.map((mode) => mode.id));
const KNOWN_PRESENCE_MODE_IDS = new Set(PRESENCE_MODE_VIEWS.map((mode) => mode.id));
const KNOWN_BUBBLE_REASONS = new Set(PROACTIVE_SPEECH_BUBBLE_REASONS);

test("daily state orchestration rules cover every current dialogue and presence mode", () => {
  const rules = listDailyStateOrchestrationRules();
  const ruleIds = new Set(rules.map((rule) => rule.ruleId));

  assert.equal(rules.length, DIALOGUE_MODE_VIEWS.length * PRESENCE_MODE_VIEWS.length);

  for (const dialogueMode of DIALOGUE_MODE_VIEWS) {
    for (const presenceMode of PRESENCE_MODE_VIEWS) {
      assert.equal(ruleIds.has(`daily-state:${dialogueMode.id}:${presenceMode.id}`), true);
    }
  }
});

test("daily state orchestration rules cover all action states and bubble reasons through safe enum references", () => {
  const rules = listDailyStateOrchestrationRules();
  const seenActionStates = new Set<string>();
  const seenBubbleReasons = new Set<string>();

  for (const rule of rules) {
    assert.equal(KNOWN_DIALOGUE_MODE_IDS.has(rule.dialogueModeId), true, rule.ruleId);
    assert.equal(KNOWN_PRESENCE_MODE_IDS.has(rule.presenceModeId), true, rule.ruleId);
    assert.equal(rule.dailySignalKinds.length, 7, rule.ruleId);
    assert.equal(rule.privacyRisk, "safe-enum-only");

    for (const stateId of rule.allowedActionStateIds) {
      assert.equal(isPetActionStateId(stateId), true, `${rule.ruleId}:${stateId}`);
      seenActionStates.add(stateId);
    }

    for (const reason of rule.allowedBubbleReasons) {
      assert.equal(KNOWN_BUBBLE_REASONS.has(reason), true, `${rule.ruleId}:${reason}`);
      seenBubbleReasons.add(reason);
    }
  }

  assert.deepEqual([...seenActionStates].sort(), [...PET_ACTION_STATE_IDS].sort());
  assert.deepEqual([...seenBubbleReasons].sort(), [...PROACTIVE_SPEECH_BUBBLE_REASONS].sort());
});

test("low frequency companion event pool only references known safe enums", () => {
  const eventIds = new Set<string>();

  for (const event of listLowFrequencyCompanionEvents()) {
    assert.equal(eventIds.has(event.eventId), false, event.eventId);
    eventIds.add(event.eventId);
    assert.equal(KNOWN_BUBBLE_REASONS.has(event.bubbleReason), true, event.eventId);
    assert.equal(isPetActionStateId(event.actionStateId), true, event.eventId);
    assert.equal(event.minimumIntervalMs > 0, true, event.eventId);
    assert.equal(event.cadenceTier, "low-frequency");
    assert.equal(event.privacyRisk, "safe-enum-only");
    assert.equal(event.allowedPresenceModes.includes("sleep"), false, event.eventId);

    for (const presenceModeId of event.allowedPresenceModes) {
      assert.equal(KNOWN_PRESENCE_MODE_IDS.has(presenceModeId), true, `${event.eventId}:${presenceModeId}`);
    }

    for (const dialogueModeId of event.allowedDialogueModes) {
      assert.equal(KNOWN_DIALOGUE_MODE_IDS.has(dialogueModeId), true, `${event.eventId}:${dialogueModeId}`);
    }
  }

  assert.deepEqual([...eventIds].sort(), [
    "context-settle",
    "idle-presence-check",
    "memory-safe-pulse",
    "mode-presence-echo",
    "search-citation-pulse"
  ]);
});

test("sleep suppresses low frequency companion event selection and rule bubble reasons", () => {
  for (const dialogueMode of DIALOGUE_MODE_VIEWS) {
    assert.equal(selectLowFrequencyCompanionEvent({
      dialogueModeId: dialogueMode.id,
      presenceModeId: "sleep",
      tick: 0,
      elapsedSinceLastEventMs: Number.MAX_SAFE_INTEGER
    }), null);
  }

  for (const rule of listDailyStateOrchestrationRules().filter((item) => item.presenceModeId === "sleep")) {
    assert.deepEqual(rule.allowedBubbleReasons, []);
    assert.deepEqual(rule.lowFrequencyEventIds, []);
    assert.equal(rule.interruptPolicy, "suppressed");
  }
});

test("focus and quiet only select low interruption low frequency events", () => {
  for (const presenceModeId of ["focus", "quiet"] as const) {
    const selected = selectLowFrequencyCompanionEvent({
      dialogueModeId: "work",
      presenceModeId,
      tick: 0,
      elapsedSinceLastEventMs: Number.MAX_SAFE_INTEGER
    });

    assert.notEqual(selected, null, presenceModeId);
    assert.equal(selected?.interruptPolicy, "low-interruption");

    for (const rule of listDailyStateOrchestrationRules().filter((item) => item.presenceModeId === presenceModeId)) {
      for (const eventId of rule.lowFrequencyEventIds) {
        const event = listLowFrequencyCompanionEvents().find((candidate) => candidate.eventId === eventId);
        assert.equal(event?.interruptPolicy, "low-interruption", `${rule.ruleId}:${eventId}`);
      }
    }
  }
});

test("low frequency selection is deterministic and interval-gated", () => {
  const input = {
    dialogueModeId: "default",
    presenceModeId: "default",
    tick: 7,
    elapsedSinceLastEventMs: Number.MAX_SAFE_INTEGER
  } as const;

  assert.deepEqual(
    selectLowFrequencyCompanionEvent(input),
    selectLowFrequencyCompanionEvent(input)
  );
  assert.equal(selectLowFrequencyCompanionEvent({
    ...input,
    elapsedSinceLastEventMs: 1
  }), null);
});

test("daily state orchestration catalog serializes without private text or raw resources", () => {
  const serialized = JSON.stringify({
    rules: listDailyStateOrchestrationRules(),
    events: listLowFrequencyCompanionEvents()
  });
  const forbiddenPatterns = [
    /用户全文/i,
    /AI 全文/i,
    /bubble text/i,
    /lineId/i,
    /prompt/i,
    /providerRequestBody/i,
    /requestBody/i,
    /query/i,
    /result/i,
    /snippet/i,
    /https?:\/\//i,
    /[A-Za-z]:[\\/]/,
    /api[_-]?key/i,
    /sk-[A-Za-z0-9]/i,
    /\.motion3\.json/i,
    /motionPath/i,
    /expressionName/i,
    /partId/i,
    /factCardBody/i,
    /memoryCardBody/i,
    /userMessage/i,
    /assistantMessage/i
  ];

  for (const pattern of forbiddenPatterns) {
    assert.doesNotMatch(serialized, pattern);
  }
});
