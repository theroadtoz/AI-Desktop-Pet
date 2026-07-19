import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  PET_ACTION_TRIGGER_ACTION_BY_REASON,
  PET_ACTION_TRIGGER_REASONS,
  type PetActionTriggerReason,
  getPetActionTriggerActionType,
  isPetNearWorkAreaEdge,
  parsePetActionTrigger
} from "../src/shared/pet-action-trigger.ts";
import {
  PET_ACTION_STATE_CATALOG,
  PET_ACTION_STATE_IDS,
  getPetActionState,
  getPetActionStateActionType,
  getPetActionStateForReason,
  getPetActionStateTriggerReason,
  isPetActionStateId,
  selectPetActionTriggerForChatReplyWaiting,
  selectPetActionStateForModeChange
} from "../src/shared/pet-action-state-machine.ts";
import { createChatReplySustainTriggerController } from "../src/main/services/chat/chat-reply-sustain-trigger.ts";
import {
  PET_WAIST_BOTTOM_OVERHANG_PX,
  calculateInitialPetBounds,
  calculatePetVisibleRegion
} from "../src/shared/pet-presentation.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const EXPECTED_STATE_ACTIONS = {
  idle: { triggerReason: "state_idle", actionType: "softSmile" },
  greet: { triggerReason: "state_greet", actionType: "greeting" },
  listen: { triggerReason: "state_listen", actionType: "listen" },
  think: { triggerReason: "state_think", actionType: "replyThinking" },
  "reply-sustain": { triggerReason: "state_reply_sustain", actionType: "replySustain" },
  sleep: { triggerReason: "state_sleep", actionType: "doze" },
  work: { triggerReason: "state_work", actionType: "workFocus" },
  game: { triggerReason: "state_game", actionType: "gameReady" },
  read: { triggerReason: "state_read", actionType: "readingIdle" },
  edge: { triggerReason: "state_edge", actionType: "edgeGlance" },
  flustered: { triggerReason: "state_flustered", actionType: "flusteredGlance" },
  "local-model-busy": { triggerReason: "state_local_model_busy", actionType: "replyThinking" },
  "memory-injected": { triggerReason: "state_memory_injected", actionType: "quietNod" },
  "memory-skipped": { triggerReason: "state_memory_skipped", actionType: "quietNod" },
  "search-cited": { triggerReason: "state_search_cited", actionType: "readingIdle" },
  "proactive-bubble-visible": { triggerReason: "state_proactive_bubble_visible", actionType: "softSmile" }
} as const;

const EXPECTED_ACTIONS_BY_REASON = {
  chat_opened: "dialogueOpenWelcome",
  chat_input_focus: "listen",
  chat_reply_waiting: "replyThinking",
  pet_edge_settled: "edgeGlance",
  rapid_touch_combo: "flusteredGlance",
  chat_reply_sustain: "replySustain",
  chat_reply_completed: "replyWarmSettle",
  state_music_playing_stable: "musicListenSway",
  state_game_presence_stable: "gamePresenceGlance",
  return_from_idle: "returnFromIdle",
  evening_companion_tick: "eveningWindowGlance",
  long_work_session_complete: "longWorkRecovery",
  state_idle: "softSmile",
  state_greet: "greeting",
  state_listen: "listen",
  state_think: "replyThinking",
  state_reply_sustain: "replySustain",
  state_sleep: "doze",
  state_work: "workFocus",
  state_game: "gameReady",
  state_read: "readingIdle",
  state_edge: "edgeGlance",
  state_flustered: "flusteredGlance",
  state_local_model_busy: "replyThinking",
  state_memory_injected: "quietNod",
  state_memory_skipped: "quietNod",
  state_search_cited: "searchNoteSettle",
  state_proactive_bubble_visible: "softSmile"
} as const;

test("pet action state catalog maps every state to a fixed safe body action", () => {
  assert.deepEqual(PET_ACTION_STATE_IDS, [
    "idle",
    "greet",
    "listen",
    "think",
    "reply-sustain",
    "sleep",
    "work",
    "game",
    "read",
    "edge",
    "flustered",
    "local-model-busy",
    "memory-injected",
    "memory-skipped",
    "search-cited",
    "proactive-bubble-visible"
  ]);

  for (const stateId of PET_ACTION_STATE_IDS) {
    const state = getPetActionState(stateId);
    const expected = EXPECTED_STATE_ACTIONS[stateId];

    assert.equal(isPetActionStateId(stateId), true);
    assert.equal(state.stateId, stateId);
    assert.equal(state.triggerReason, expected.triggerReason);
    assert.equal(state.actionType, expected.actionType);
    assert.equal(getPetActionStateActionType(stateId), expected.actionType);
    assert.equal(getPetActionStateTriggerReason(stateId), expected.triggerReason);
    assert.equal(state.priority > 0, true);
    assert.equal(state.minimumIntervalMs >= 0, true);
    assert.equal(state.safeSummaryLabel.length > 0, true);
  }

  assert.equal(isPetActionStateId("provider_selected_motion"), false);
  assert.deepEqual(Object.keys(PET_ACTION_STATE_CATALOG), [...PET_ACTION_STATE_IDS]);
});

test("pet action state machine keeps legacy trigger reasons as compatibility entries", () => {
  const expectedStatesByReason = {
    chat_opened: "listen",
    chat_input_focus: "listen",
    chat_reply_waiting: "think",
    pet_edge_settled: "edge",
    rapid_touch_combo: "flustered",
    chat_reply_sustain: "reply-sustain",
    chat_reply_completed: "reply-sustain",
    state_music_playing_stable: "idle",
    state_game_presence_stable: "game",
    return_from_idle: "greet",
    evening_companion_tick: "idle",
    long_work_session_complete: "work",
    state_idle: "idle",
    state_greet: "greet",
    state_listen: "listen",
    state_think: "think",
    state_reply_sustain: "reply-sustain",
    state_sleep: "sleep",
    state_work: "work",
    state_game: "game",
    state_read: "read",
    state_edge: "edge",
    state_flustered: "flustered",
    state_local_model_busy: "local-model-busy",
    state_memory_injected: "memory-injected",
    state_memory_skipped: "memory-skipped",
    state_search_cited: "search-cited",
    state_proactive_bubble_visible: "proactive-bubble-visible"
  } as const;

  for (const reason of PET_ACTION_TRIGGER_REASONS) {
    const state = getPetActionStateForReason(reason);
    assert.equal(state.stateId, expectedStatesByReason[reason]);
    assert.equal(getPetActionTriggerActionType(reason), EXPECTED_ACTIONS_BY_REASON[reason]);
  }
});

test("pet action state selector maps mode changes to fixed state reasons", () => {
  assert.equal(selectPetActionStateForModeChange({ dialogueModeId: "default" })?.stateId, "idle");
  assert.equal(selectPetActionStateForModeChange({ dialogueModeId: "work" })?.triggerReason, "state_work");
  assert.equal(selectPetActionStateForModeChange({ dialogueModeId: "game" })?.triggerReason, "state_game");
  assert.equal(selectPetActionStateForModeChange({ dialogueModeId: "reading" })?.triggerReason, "state_read");
  assert.equal(selectPetActionStateForModeChange({ presenceModeId: "sleep" })?.triggerReason, "state_sleep");
  assert.equal(
    selectPetActionStateForModeChange({ dialogueModeId: "work", presenceModeId: "sleep" })?.triggerReason,
    "state_sleep"
  );
  assert.equal(
    selectPetActionStateForModeChange({ dialogueModeId: "game", presenceModeId: "sleep" })?.triggerReason,
    "state_sleep"
  );
});

test("chat reply waiting selector uses local-model-busy only for local providers", () => {
  assert.equal(selectPetActionTriggerForChatReplyWaiting("fake"), "chat_reply_waiting");
  assert.equal(selectPetActionTriggerForChatReplyWaiting("openai-compatible"), "chat_reply_waiting");
  assert.equal(selectPetActionTriggerForChatReplyWaiting("local-openai-compatible"), "state_local_model_busy");
});

test("main chat reply trigger waits for memory safe summary before selecting one fixed reason", async () => {
  const source = await readFile(new URL("../src/main/app.ts", import.meta.url), "utf8");
  const selectorStart = source.indexOf("function selectMainPetActionTriggerForMemorySafeChatReply");
  const selectorEnd = source.indexOf("function createChatContextTransparencyPayload", selectorStart);
  const selectorSource = source.slice(selectorStart, selectorEnd);
  const chatSendStart = source.indexOf('ipcMain.on("chat:send"');
  const chatSendSource = source.slice(chatSendStart, source.indexOf('ipcMain.on("chat:abort"', chatSendStart));
  const memoryContextIndex = chatSendSource.indexOf("const memoryContext = memoryStoreForRequest.createInjection()");
  const triggerIndex = chatSendSource.indexOf("selectMainPetActionTriggerForMemorySafeChatReply", memoryContextIndex);

  assert.notEqual(selectorStart, -1);
  assert.match(selectorSource, /autoCaptureSkippedReason === "sensitive"/);
  assert.match(selectorSource, /autoCaptureSkippedReason === "capture_failed"/);
  assert.match(selectorSource, /return "state_memory_skipped"/);
  assert.match(selectorSource, /selectPetActionTriggerForChatReplyWaiting\(input\.providerId\)/);
  assert.match(selectorSource, /replyWaitingReason === "state_local_model_busy"/);
  assert.match(selectorSource, /memoryInjectionCount > 0/);
  assert.match(selectorSource, /return "state_memory_injected"/);
  assert.match(selectorSource, /return replyWaitingReason/);
  assert.equal(memoryContextIndex >= 0, true);
  assert.equal(triggerIndex > memoryContextIndex, true);
  assert.match(chatSendSource, /sendPetActionTrigger\(selectMainPetActionTriggerForMemorySafeChatReply\(\{\s*providerId,\s*autoCaptureSkippedReason: autoMemoryCaptureForActivity\.skippedReason,\s*memoryInjectionCount: memoryContext\.count\s*\}\)\);/);
  assert.doesNotMatch(selectorSource, /cards|content|messages|prompt|providerMessages|payload|expressionName|motion|partId/);
  assert.doesNotMatch(chatSendSource, /sendPetActionTrigger\([^)]*memoryContext\.cards|pet:action-trigger",\s*\{[\s\S]{0,120}(count|cards|text|payload)/);
});

test("main search citation trigger uses only citation count after safe payload creation", async () => {
  const source = await readFile(new URL("../src/main/app.ts", import.meta.url), "utf8");
  const citationStart = source.indexOf("const webSearchCitation = createWebSearchCitationPayload");
  const citationEnd = source.indexOf('event.sender.send("chat:context-transparency"', citationStart);
  const citationSource = source.slice(citationStart, citationEnd);

  assert.notEqual(citationStart, -1);
  assert.match(citationSource, /createWebSearchCitationPayload\(webSearchResolution\.context\)/);
  assert.match(citationSource, /const webSearchCitationCount = webSearchCitation\?\.citations\.length \?\? 0;/);
  assert.match(citationSource, /if \(webSearchCitationCount > 0\) \{\s*sendPetActionTrigger\("state_search_cited"\);\s*queueSourcedLowFrequencyCompanionEvent\("search-citation-pulse", \{\s*actionStateId: "search-cited"\s*\}\);\s*\}/);
  assert.doesNotMatch(citationSource, /sendPetActionTrigger\([^)]*(query|url|title|snippet|result|payload)/i);
  assert.doesNotMatch(citationSource, /queueSourcedLowFrequencyCompanionEvent\([^)]*(query|url|title|snippet|result|payload)/i);
});

test("main proactive bubble trigger fires only after a shown bubble without text payloads", async () => {
  const source = await readFile(new URL("../src/main/app.ts", import.meta.url), "utf8");
  const bubbleStart = source.indexOf("function sendProactiveSpeechBubble");
  const bubbleEnd = source.indexOf("function isChatVisible", bubbleStart);
  const bubbleSource = source.slice(bubbleStart, bubbleEnd);
  const shownIndex = bubbleSource.indexOf('logProactiveSpeechBubbleDecision("shown", payload)');
  const triggerIndex = bubbleSource.indexOf("sendPetActionTrigger(actionTriggerReason)");

  assert.notEqual(bubbleStart, -1);
  assert.match(bubbleSource, /actionTriggerReason: PetActionTriggerReason = "state_proactive_bubble_visible"/);
  assert.equal(shownIndex >= 0, true);
  assert.equal(triggerIndex > shownIndex, true);
  assert.doesNotMatch(bubbleSource, /sendPetActionTrigger\([^)]*(payload|lineId|text|content|message|prompt|expressionName|motion|partId)/i);
});

test("main low frequency proactive bubble action linkage uses event action state only", async () => {
  const source = await readFile(new URL("../src/main/app.ts", import.meta.url), "utf8");
  const idleSchedulerStart = source.indexOf("function scheduleIdleProactiveSpeechBubble()");
  const idleSchedulerEnd = source.indexOf("function scheduleStartupProactiveSpeechBubbleIfNeeded()", idleSchedulerStart);
  const idleSchedulerSource = source.slice(idleSchedulerStart, idleSchedulerEnd);

  assert.notEqual(idleSchedulerStart, -1);
  assert.match(source, /getPetActionStateTriggerReason/);
  assert.match(
    idleSchedulerSource,
    /const actionStateId = getEffectiveLowFrequencyCompanionActionStateId\(selection\.event\);[\s\S]*sendProactiveSpeechBubble\(\s*payload,\s*getPetActionStateTriggerReason\(actionStateId\)\s*\)/
  );
  assert.doesNotMatch(idleSchedulerSource, /getPetActionStateTriggerReason\([^)]*(payload|lineId|safeContextTag|text|content|message|prompt)/i);
});

test("pet action trigger allowlist only exposes fixed action and reason combinations", () => {
  assert.deepEqual(PET_ACTION_TRIGGER_REASONS, [
    "chat_opened",
    "chat_input_focus",
    "chat_reply_waiting",
    "pet_edge_settled",
    "rapid_touch_combo",
    "chat_reply_sustain",
    "chat_reply_completed",
    "state_music_playing_stable",
    "state_game_presence_stable",
    "return_from_idle",
    "evening_companion_tick",
    "long_work_session_complete",
    "state_idle",
    "state_greet",
    "state_listen",
    "state_think",
    "state_reply_sustain",
    "state_sleep",
    "state_work",
    "state_game",
    "state_read",
    "state_edge",
    "state_flustered",
    "state_local_model_busy",
    "state_memory_injected",
    "state_memory_skipped",
    "state_search_cited",
    "state_proactive_bubble_visible"
  ]);
  assert.deepEqual(PET_ACTION_TRIGGER_ACTION_BY_REASON, EXPECTED_ACTIONS_BY_REASON);

  for (const reason of PET_ACTION_TRIGGER_REASONS) {
    assert.deepEqual(parsePetActionTrigger({ reason }), { reason });
    assert.equal(getPetActionTriggerActionType(reason), PET_ACTION_TRIGGER_ACTION_BY_REASON[reason]);
  }
});

test("pet action trigger parser rejects arbitrary action payloads and unsafe reasons", () => {
  assert.equal(parsePetActionTrigger({ reason: "click_body", type: "headPat" }), null);
  assert.equal(parsePetActionTrigger({ reason: "chat_opened", type: "headPat" })?.reason, "chat_opened");
  assert.equal(parsePetActionTrigger({ action: "replyThinking" }), null);
  assert.equal(parsePetActionTrigger(null), null);
});

test("pet preload mirrors the fixed action trigger reason allowlist without accepting action payloads", async () => {
  const source = await readFile(new URL("../src/preload/pet-preload.ts", import.meta.url), "utf8");
  const parserStart = source.indexOf("function parsePetActionTrigger");
  const parserEnd = source.indexOf("function parseProactiveSpeechBubblePayload", parserStart);
  const parserSource = source.slice(parserStart, parserEnd);

  for (const reason of PET_ACTION_TRIGGER_REASONS) {
    assert.match(source, new RegExp(JSON.stringify(reason)));
  }

  assert.match(parserSource, /return typeof reason === "string" && petActionTriggerReasons\.includes/);
  assert.doesNotMatch(parserSource, /actionType|expressionName|motion|payload\.type/);
});

test("main mode changes trigger only fixed state reasons and preserve bubble suppression", async () => {
  const source = await readFile(new URL("../src/main/app.ts", import.meta.url), "utf8");
  const quiesceSource = source.slice(
    source.indexOf("function quiesceApp(): void"),
    source.indexOf("async function stopLocalRuntimesForShutdown")
  );
  const beforeQuitSource = source.slice(
    source.indexOf('app.on("before-quit"'),
    source.indexOf('app.on("activate"')
  );

  assert.match(source, /selectPetActionStateForModeChange/);
  assert.match(source, /PET_MODE_ACTION_STATE_TRIGGER_DELAY_MS = 2_000/);
  assert.match(source, /function schedulePetModeActionStateTrigger\(reason: PetActionTriggerReason\)/);
  assert.match(source, /cancelPendingModeActionStateTrigger\(\);[\s\S]*sendPetActionTrigger\(reason\);/);
  assert.match(source, /function markProactiveSpeechBubbleHidden\(\): void \{\s*proactiveSpeechBubbleVisibleUntil = 0;\s*\}/);
  assert.match(source, /selectPetActionStateForModeChange\(\{\s*dialogueModeId: currentDialogueModeId,\s*presenceModeId: currentPresenceModeId\s*\}\)/);
  assert.equal(source.match(/const actionState = selectPetActionStateForModeChange/g)?.length, 2);
  assert.equal(source.match(/schedulePetModeActionStateTrigger\(actionState\.triggerReason\)/g)?.length, 2);
  assert.match(source, /createAppShutdownCoordinator\(\{\s*quiesce: quiesceApp,/);
  assert.match(quiesceSource, /cancelPendingModeActionStateTrigger\(\);/);
  assert.match(beforeQuitSource, /event\.preventDefault\(\);/);
  assert.match(beforeQuitSource, /shutdownCoordinator\.shutdown\(\)/);
  assert.match(source, /openChatWindow\(\): void[\s\S]*cancelStartupProactiveSpeechBubbleTimer\(\);[\s\S]*cancelIdleProactiveSpeechBubbleTimer\(\);[\s\S]*markProactiveSpeechBubbleHidden\(\);[\s\S]*sendPetActionTrigger\("chat_opened"\);/);
  assert.match(source, /currentPresenceModeId === "sleep"[\s\S]*cancelStartupProactiveSpeechBubbleTimer\(\);[\s\S]*cancelIdleProactiveSpeechBubbleTimer\(\);[\s\S]*markProactiveSpeechBubbleHidden\(\);[\s\S]*nextIdleProactiveSpeechBubbleReason = "idle_presence";/);
  assert.doesNotMatch(source, /sendPetActionTrigger\([^)]*actionType|pet:action-trigger",\s*\{\s*reason,\s*type/);
});

test("pet renderer rapid touch combo annotates the fixed flustered state", async () => {
  const source = await readFile(new URL("../src/renderer/pet/main.ts", import.meta.url), "utf8");
  const marker = source.indexOf('rapidTouchComboDetector.record(event.timeStamp)');
  const block = source.slice(marker, source.indexOf("scheduleClickInteractionAction(hitArea)", marker));

  assert.notEqual(marker, -1);
  assert.match(block, /getPetActionStateForReason\("rapid_touch_combo"\)/);
  assert.match(block, /getPetInteractionAction\(rapidTouchState\.actionType\)/);
  assert.match(block, /stateId: rapidTouchState\.stateId/);
  assert.match(block, /modeId: currentDialogueModeId/);
  assert.match(block, /presenceModeId: currentPresenceModeId/);
  assert.match(block, /candidateActionTypes: \[rapidTouchState\.actionType\]/);
});

test("pet edge helper detects settled visible edges without exposing bounds", () => {
  const workArea = { x: 0, y: 0, width: 1920, height: 1080 };
  const initial = calculateInitialPetBounds(1, workArea);
  const initialRegion = calculatePetVisibleRegion(initial);

  assert.equal(isPetNearWorkAreaEdge(initial, workArea), true);
  assert.ok(
    Math.abs(initial.y + initialRegion.waistY - (
      workArea.y + workArea.height + PET_WAIST_BOTTOM_OVERHANG_PX
    )) <= 1
  );
  assert.equal(isPetNearWorkAreaEdge({ x: 720, y: 240, width: 420, height: 600 }, workArea), false);
  assert.equal(isPetNearWorkAreaEdge({ x: -42, y: 240, width: 420, height: 600 }, workArea), true);
  assert.equal(isPetNearWorkAreaEdge({ x: 1542, y: 240, width: 420, height: 600 }, workArea), true);
  assert.equal(isPetNearWorkAreaEdge({ x: 720, y: -60, width: 420, height: 600 }, workArea), true);
  assert.equal(isPetNearWorkAreaEdge({ x: 720, y: 741, width: 420, height: 600 }, workArea), true);
  assert.equal(isPetNearWorkAreaEdge({ x: 720, y: 838, width: 420, height: 600 }, workArea), true);
  assert.equal(isPetNearWorkAreaEdge({ x: 720, y: 920, width: 420, height: 600 }, workArea), false);
  assert.equal(isPetNearWorkAreaEdge({ x: Number.NaN, y: 0, width: 420, height: 600 }, workArea), false);
});

test("completed chat streams clear the sustain trigger timer before done is sent", async () => {
  const source = await readFile(new URL("../src/main/app.ts", import.meta.url), "utf8");
  const completedIndex = source.indexOf('type: "reply:completed"');
  const doneIndex = source.indexOf('"chat:stream-done"', completedIndex);

  assert.notEqual(completedIndex, -1);
  assert.notEqual(doneIndex, -1);
  assert.match(source.slice(completedIndex, doneIndex), /if \(activeChatRequestVersion === request\.requestVersion\) \{\s*activeChatRequestVersion = null;\s*syncAutomaticPresenceLifecycle\(\);\s*clearChatReplySustainTimer\(\);\s*\}/);
});

test("slow chat streams trigger the fixed reply sustain reason while still streaming", async (t) => {
  const reasons: PetActionTriggerReason[] = [];
  const controller = createChatReplySustainTriggerController({
    minChars: 5,
    delayMs: 15,
    sendReason(reason) {
      reasons.push(reason);
    }
  });
  t.after(() => controller.clear());

  controller.observeReplyLength(4);
  await sleep(25);
  assert.deepEqual(reasons, []);

  controller.observeReplyLength(5);
  await sleep(25);

  assert.deepEqual(reasons, ["chat_reply_sustain"]);
  assert.equal(getPetActionTriggerActionType(reasons[0]), "replySustain");
});
