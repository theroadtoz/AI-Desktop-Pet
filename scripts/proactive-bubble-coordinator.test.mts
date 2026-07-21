import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";

const require = createRequire(import.meta.url);

const {
  createProactiveBubbleCoordinator
} = require("../dist/main/services/proactive-companion/proactive-bubble-coordinator.js") as typeof import(
  "../src/main/services/proactive-companion/proactive-bubble-coordinator"
);

type CoarseUserState = import("../src/main/services/automatic-situation/coarse-user-state-coordinator").CoarseUserState;
type ProactiveSpeechBubblePayload = import("../src/shared/proactive-speech-bubble").ProactiveSpeechBubblePayload;
type PetActionTriggerReason = import("../src/shared/pet-action-trigger").PetActionTriggerReason;

function state(update: Partial<CoarseUserState> = {}): CoarseUserState {
  return Object.freeze({
    activity: "active",
    interruptibility: "allowed",
    media: "unknown",
    timeBand: "daytime",
    explicitGameContext: "inactive",
    engagement: "allowed",
    ...update
  });
}

function createHarness(options: {
  now?: number;
  mono?: number;
  chatVisible?: boolean;
  acceptanceInjectionOnly?: boolean;
} = {}) {
  let nowMs = options.now ?? new Date(2026, 6, 20, 8).getTime();
  let monoMs = options.mono ?? 0;
  let gates = {
    petReady: true,
    petWindowAvailable: true,
    chatVisible: options.chatVisible ?? false,
    interactionActive: false,
    modelBusy: false,
    highPriorityActionActive: false,
    highPriorityActionReason: null as PetActionTriggerReason | null
  };
  const requested: PetActionTriggerReason[] = [];
  const shown: ProactiveSpeechBubblePayload[] = [];
  const decisions: Array<{ candidateId: string; state: string; skipReason?: string }> = [];
  let opened = 0;
  let cleared = 0;
  const coordinator = createProactiveBubbleCoordinator({
    ledger: {
      canShow: () => null,
      recordShown: () => undefined,
      getLedgerPath: () => "safe-ledger.json"
    },
    getRuntimeGates: () => gates,
    requestAction(reason) {
      requested.push(reason);
      return true;
    },
    showBubble(payload) {
      shown.push(payload);
      return true;
    },
    clearBubble() {
      cleared += 1;
    },
    openChat() {
      opened += 1;
    },
    reportDecision(decision) {
      decisions.push(decision);
    },
    now: () => nowMs,
    monotonicNow: () => monoMs,
    longSilenceMs: 100,
    longWorkMs: 100,
    acceptanceInjectionOnly: options.acceptanceInjectionOnly
  });
  coordinator.updateSettings({ cadence: "normal", memorySourceBubbles: true, searchSourceBubbles: true });
  coordinator.updateCoarseState(state());
  return {
    coordinator,
    requested,
    shown,
    decisions,
    get opened() { return opened; },
    get cleared() { return cleared; },
    advance(ms: number) { nowMs += ms; monoMs += ms; },
    setGates(update: Partial<typeof gates>) {
      gates = { ...gates, ...update };
      coordinator.updateRuntimeGates(gates);
    }
  };
}

test("acceptance injection-only mode suppresses every automatic source but permits closed injection", () => {
  const h = createHarness({ acceptanceInjectionOnly: true });
  h.coordinator.onFirstFrame();
  h.coordinator.updateCoarseState(state({ media: "stopped" }));
  h.coordinator.updateCoarseState(state({ media: "playing", timeBand: "evening", explicitGameContext: "active" }));
  h.coordinator.updateDialogueMode("work");
  h.advance(101);
  h.coordinator.updateDialogueMode("default");
  h.coordinator.onUserMessage();
  h.advance(101);
  h.coordinator.tick();
  h.coordinator.queueSource("search_citation_safe");
  h.coordinator.queuePresence("idle_presence", {
    lineId: "idle_presence_soft",
    reason: "idle_presence",
    durationMs: 4_200
  }, "state_listen");
  assert.deepEqual(h.requested, []);

  h.coordinator.queueSafeCandidateForAcceptance("evening_companion");
  assert.deepEqual(h.requested, ["evening_companion_tick"]);
  h.coordinator.dispose();
});

test("mode presence waits for chat close and then preserves action-first ordering", () => {
  const h = createHarness({ chatVisible: true });
  h.coordinator.queuePresence("mode_presence", {
    lineId: "mode_presence_work",
    reason: "mode_presence",
    durationMs: 4_200
  }, "state_work");
  assert.deepEqual(h.requested, []);
  assert.equal(h.decisions.at(-1)?.state, "queued");

  h.setGates({ chatVisible: false });
  assert.deepEqual(h.requested, ["state_work"]);
  h.coordinator.onActionLifecycle({ status: "started", reason: "state_work" });
  assert.equal(h.shown.at(-1)?.lineId, "mode_presence_work");
  h.coordinator.dispose();
});

test("defer hard-suppresses mode presence", () => {
  const h = createHarness();
  h.coordinator.updateCoarseState(state({ engagement: "defer" }));
  h.coordinator.queuePresence("mode_presence", {
    lineId: "mode_presence_work",
    reason: "mode_presence",
    durationMs: 4_200
  }, "state_work");
  assert.deepEqual(h.requested, []);
  assert.equal(h.decisions.at(-1)?.state, "skipped");
  assert.equal(h.decisions.at(-1)?.skipReason, "engagement_blocked");
  h.coordinator.dispose();
});

test("startup waits for action started before showing and click opens chat", () => {
  const h = createHarness();
  h.coordinator.onFirstFrame();
  assert.deepEqual(h.requested, ["state_greet"]);
  assert.equal(h.shown.length, 0);
  h.coordinator.onActionLifecycle({ status: "started", reason: "state_greet" });
  assert.equal(h.shown[0]?.lineId, "startup_presence_ready");
  assert.equal(h.coordinator.activateBubble({ lineId: "startup_presence_ready", reason: "startup_presence" }), true);
  assert.equal(h.opened, 1);
  h.coordinator.dispose();
});

test("defer hard-suppresses every candidate", () => {
  const deferred = createHarness();
  deferred.coordinator.updateCoarseState(state({ engagement: "defer" }));
  deferred.coordinator.onFirstFrame();
  deferred.coordinator.queueSource("search_citation_safe");
  assert.deepEqual(deferred.requested, []);
  assert.ok(deferred.decisions.filter((decision) => decision.skipReason === "engagement_blocked").length >= 2);
  deferred.coordinator.dispose();
});

test("unknown state permits only startup and source candidates", () => {
  const startup = createHarness();
  startup.coordinator.updateCoarseState(state({ engagement: "unknown", interruptibility: "unknown" }));
  startup.coordinator.onFirstFrame();
  assert.deepEqual(startup.requested, ["state_greet"]);
  startup.coordinator.dispose();

  const source = createHarness();
  source.coordinator.updateCoarseState(state({ engagement: "unknown", interruptibility: "unknown" }));
  source.coordinator.queueSource("search_citation_safe");
  assert.deepEqual(source.requested, ["state_search_cited"]);
  source.coordinator.dispose();

  const mode = createHarness();
  mode.coordinator.updateCoarseState(state({ engagement: "unknown", interruptibility: "unknown" }));
  mode.coordinator.queuePresence("mode_presence", {
    lineId: "mode_presence_work",
    reason: "mode_presence",
    durationMs: 4_200
  }, "state_work");
  assert.deepEqual(mode.requested, []);
  assert.equal(mode.decisions.at(-1)?.skipReason, "interruptibility_not_allowed");
  mode.coordinator.dispose();
});

test("startup remains blocked by hard system states", () => {

  for (const blockedState of [
    state({ engagement: "suppressed" }),
    state({ activity: "locked" }),
    state({ activity: "suspended" })
  ]) {
    const blocked = createHarness();
    blocked.coordinator.updateCoarseState(blockedState);
    blocked.coordinator.onFirstFrame();
    assert.deepEqual(blocked.requested, []);
    blocked.coordinator.dispose();
  }
});

test("chat-wait candidate gets one close decision and skips on a second open", () => {
  const h = createHarness({ chatVisible: true });
  h.coordinator.queuePresence("mode_presence", {
    lineId: "mode_presence_work",
    reason: "mode_presence",
    durationMs: 4_200
  }, "state_work");
  assert.deepEqual(h.requested, []);

  h.setGates({ chatVisible: false });
  assert.deepEqual(h.requested, ["state_work"]);
  h.setGates({ chatVisible: true });
  assert.equal(h.decisions.at(-1)?.state, "skipped");
  assert.equal(h.decisions.at(-1)?.skipReason, "chat_visible");

  h.coordinator.onActionLifecycle({ status: "started", reason: "state_work" });
  assert.equal(h.shown.length, 0);
  h.setGates({ chatVisible: false });
  h.coordinator.tick();
  assert.deepEqual(h.requested, ["state_work"]);
  h.coordinator.dispose();
});

test("forged and expired bubble activation is rejected", () => {
  const h = createHarness();
  h.coordinator.onFirstFrame();
  h.coordinator.onActionLifecycle({ status: "started", reason: "state_greet" });
  assert.equal(h.coordinator.activateBubble({ lineId: "idle_presence_soft", reason: "startup_presence" }), false);
  h.coordinator.onBubbleHidden();
  assert.equal(h.coordinator.activateBubble({ lineId: "startup_presence_ready", reason: "startup_presence" }), false);
  assert.equal(h.opened, 0);
  h.coordinator.dispose();
});

test("music requires a stopped baseline and game waits for one chat close", () => {
  const h = createHarness();
  h.coordinator.updateCoarseState(state({ media: "playing" }));
  assert.equal(h.requested.length, 0);
  h.coordinator.updateCoarseState(state({ media: "stopped" }));
  h.coordinator.updateCoarseState(state({ media: "playing" }));
  assert.deepEqual(h.requested, ["state_music_playing_stable"]);
  h.coordinator.onActionLifecycle({ status: "skipped", reason: "state_music_playing_stable" });

  h.setGates({ chatVisible: true });
  h.coordinator.updateCoarseState(state({ media: "playing", explicitGameContext: "active" }));
  assert.equal(h.requested.length, 1);
  h.setGates({ chatVisible: false });
  assert.equal(h.requested.at(-1), "state_game_presence_stable", JSON.stringify(h.decisions));
  h.coordinator.dispose();
});

test("return, evening transition, long work exit, and long silence create closed actions", () => {
  const h = createHarness();
  h.coordinator.updateCoarseState(state({ activity: "away", engagement: "defer" }));
  h.coordinator.updateCoarseState(state({ activity: "active", engagement: "allowed" }));
  assert.equal(h.requested.at(-1), "return_from_idle");
  h.coordinator.onActionLifecycle({ status: "skipped", reason: "return_from_idle" });

  h.coordinator.updateCoarseState(state({ timeBand: "evening" }));
  assert.equal(h.requested.at(-1), "evening_companion_tick");
  h.coordinator.onActionLifecycle({ status: "skipped", reason: "evening_companion_tick" });

  h.coordinator.updateDialogueMode("work");
  h.advance(101);
  h.coordinator.updateDialogueMode("default");
  assert.equal(h.requested.at(-1), "long_work_session_complete");
  h.coordinator.onActionLifecycle({ status: "skipped", reason: "long_work_session_complete" });

  h.coordinator.onUserMessage();
  h.advance(101);
  h.coordinator.tick();
  assert.equal(h.requested.at(-1), "state_listen");
  h.coordinator.dispose();
});

test("suppressed candidate becomes terminal and is not replayed", () => {
  const h = createHarness();
  h.coordinator.updateCoarseState(state({ media: "stopped", engagement: "suppressed", interruptibility: "suppressed" }));
  h.coordinator.updateCoarseState(state({ media: "playing", engagement: "suppressed", interruptibility: "suppressed" }));
  assert.equal(h.requested.length, 0);
  assert.equal(h.decisions.at(-1)?.state, "skipped");
  h.coordinator.updateCoarseState(state());
  h.coordinator.tick();
  assert.equal(h.requested.length, 0);
  h.coordinator.dispose();
});

test("source action is one-shot and off clears without replay", () => {
  const h = createHarness({ chatVisible: true });
  h.coordinator.queueSource("search_citation_safe");
  h.coordinator.updateSettings({ cadence: "off", memorySourceBubbles: true, searchSourceBubbles: true });
  h.setGates({ chatVisible: false });
  h.coordinator.tick();
  assert.equal(h.requested.length, 0);
  assert.ok(h.cleared >= 1);
  h.coordinator.dispose();
});

test("off resets edge and timer latches without backfilling after re-enable", () => {
  const h = createHarness();
  h.coordinator.updateCoarseState(state({ media: "stopped" }));
  h.coordinator.updateDialogueMode("work");
  h.coordinator.onUserMessage();
  h.advance(101);
  h.coordinator.updateSettings({ cadence: "off", memorySourceBubbles: true, searchSourceBubbles: true });
  h.coordinator.updateSettings({ cadence: "normal", memorySourceBubbles: true, searchSourceBubbles: true });
  h.coordinator.updateDialogueMode("default");
  h.coordinator.tick();
  h.coordinator.updateCoarseState(state({ media: "playing" }));
  assert.deepEqual(h.requested, []);
  h.coordinator.dispose();
});

test("every hard suppression clears a displayed bubble", () => {
  for (const coarseUpdate of [
    { engagement: "defer" as const },
    { engagement: "suppressed" as const },
    { activity: "locked" as const },
    { activity: "suspended" as const }
  ]) {
    const h = createHarness();
    h.coordinator.onFirstFrame();
    h.coordinator.onActionLifecycle({ status: "started", reason: "state_greet" });
    const before = h.cleared;
    h.coordinator.updateCoarseState(state(coarseUpdate));
    assert.ok(h.cleared > before, JSON.stringify(coarseUpdate));
    h.coordinator.dispose();
  }

  for (const runtimeUpdate of [
    { chatVisible: true },
    { interactionActive: true },
    { modelBusy: true },
    { highPriorityActionActive: true, highPriorityActionReason: "state_work" as const }
  ]) {
    const h = createHarness();
    h.coordinator.onFirstFrame();
    h.coordinator.onActionLifecycle({ status: "started", reason: "state_greet" });
    const before = h.cleared;
    h.setGates(runtimeUpdate);
    assert.ok(h.cleared > before, JSON.stringify(runtimeUpdate));
    h.coordinator.dispose();
  }
});

test("the coordinator action itself does not clear its own displayed bubble", () => {
  const h = createHarness();
  h.coordinator.onFirstFrame();
  h.coordinator.onActionLifecycle({ status: "started", reason: "state_greet" });
  const before = h.cleared;
  h.setGates({ highPriorityActionActive: true, highPriorityActionReason: "state_greet" });
  assert.equal(h.cleared, before);
  h.coordinator.dispose();
});

test("same-class replacement records a terminal state for the displaced candidate", () => {
  const h = createHarness({ chatVisible: true });
  h.coordinator.queueSource("memory_safe");
  h.coordinator.queueSource("search_citation_safe");
  assert.ok(h.decisions.some((decision) =>
    decision.candidateId === "memory_safe" &&
    decision.state === "skipped" &&
    decision.skipReason === "replaced_by_same_class"));
  assert.equal(h.decisions.at(-1)?.candidateId, "search_citation_safe");
  assert.equal(h.decisions.at(-1)?.state, "queued");
  h.coordinator.dispose();
});

test("same-class candidate cannot replace an active action handshake", () => {
  const h = createHarness();
  h.coordinator.queueSource("memory_safe");
  assert.deepEqual(h.requested, ["state_memory_injected"]);
  h.coordinator.queueSource("search_citation_safe");
  assert.deepEqual(h.requested, ["state_memory_injected"]);
  assert.ok(h.decisions.some((decision) =>
    decision.candidateId === "search_citation_safe" &&
    decision.state === "skipped" &&
    decision.skipReason === "same_class_attempt_in_progress"));
  h.coordinator.onActionLifecycle({ status: "started", reason: "state_memory_injected" });
  assert.equal(h.shown.at(-1)?.lineId, "idle_presence_memory_safe");
  h.coordinator.dispose();
});

test("resolved legacy presence keeps its selected line and action behind action-first", () => {
  const h = createHarness();
  h.coordinator.queuePresence("mode_presence", {
    lineId: "mode_presence_work",
    reason: "mode_presence",
    durationMs: 4_200
  }, "state_work");
  assert.equal(h.requested.at(-1), "state_work");
  assert.equal(h.shown.length, 0);
  h.coordinator.onActionLifecycle({ status: "started", reason: "state_work" });
  assert.equal(h.shown.at(-1)?.lineId, "mode_presence_work");
  h.coordinator.dispose();
});

test("coordinator source contains no raw environment or content fields", () => {
  const source = readFileSync(
    "src/main/services/proactive-companion/proactive-bubble-coordinator.ts",
    "utf8"
  );
  assert.doesNotMatch(source, /windowTitle|processName|mediaMetadata|searchQuery|memoryBody|historyBody|capability|changedAtMs|stableSinceMs/);
});

test("pet renderer rebuild resets first-frame, active action, and coordinator visibility state", () => {
  const source = readFileSync("src/main/app.ts", "utf8");
  const start = source.indexOf("function rebuildPetWindow");
  const end = source.indexOf("app.whenReady()", start);
  const rebuildSource = source.slice(start, end);
  assert.match(rebuildSource, /hasPetFirstFrame = false;/);
  assert.match(rebuildSource, /activePetActionReason = null;/);
  assert.match(rebuildSource, /markProactiveSpeechBubbleHidden\(\);/);
  assert.match(rebuildSource, /proactiveBubbleCoordinator\?\.clear\(\);/);
});
