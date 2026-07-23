import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  createCalmXitaAffect,
  parseUserAffectClassification,
  type PerceivedUserAffect
} from "../src/shared/companion-affect.ts";
import {
  createPerceivedUserAffectTracker,
  createPerceivedUserAffectTrackerRegistry,
  USER_AFFECT_CORRECTION_SUPPRESSION_MS,
  type UserAffectClassifier,
  type UserAffectClassifierResult
} from "../src/main/services/affect/perceived-user-affect.ts";
import {
  createBackgroundUserAffectClassificationRunner
} from "../src/main/services/affect/background-user-affect-classification.ts";
import {
  createXitaAffectCoordinator,
  XITA_AFFECT_CALM_MS,
  XITA_AFFECT_DECAY_MS,
  XITA_AFFECT_HYSTERESIS_TTL_MS
} from "../src/main/services/affect/xita-affect-coordinator.ts";
import {
  createXitaAffectStore,
  XITA_AFFECT_RESTART_RECOVERY_MS
} from "../src/main/services/affect/xita-affect-store.ts";
import {
  resolveAffectDialoguePresentation
} from "../src/main/services/affect/affect-dialogue-presentation-resolver.ts";

test("user affect classification parser accepts only the exact closed-set JSON schema", () => {
  assert.deepEqual(parseUserAffectClassification('{"label":"tense","confidence":0.82}'), {
    label: "tense",
    confidence: 0.82
  });
  for (const value of [
    '{"label":"sad","confidence":0.9}',
    '{"label":"low","confidence":"high"}',
    '{"label":"low","confidence":1.01}',
    '{"label":"low","confidence":0.9,"reason":"message text"}',
    '```json\n{"label":"low","confidence":0.9}\n```',
    "low",
    "",
    "{bad json}"
  ]) {
    assert.equal(parseUserAffectClassification(value), null, value);
  }
});

test("explicit first-person text covers the closed set without treating questions as user affect", () => {
  let nowMs = 1_000;
  const tracker = createPerceivedUserAffectTracker({ now: () => nowMs });
  const cases = [
    ["我现在很平静", "calm"],
    ["我今天很开心", "positive"],
    ["我真的很兴奋", "excited"],
    ["我现在有点难过", "low"],
    ["我现在不开心", "low"],
    ["我现在特别焦虑", "tense"],
    ["我今天很累", "tired"]
  ] as const;

  for (const [text, kind] of cases) {
    nowMs += 1;
    assert.deepEqual(tracker.perceiveText(text).affect, {
      kind,
      confidence: "high",
      source: "explicit-text",
      observedAtMs: nowMs
    });
  }

  nowMs += 1;
  const question = tracker.perceiveText("西塔，你难过的时候是什么感觉？");
  assert.equal(question.affect.kind, "unknown");
  assert.equal(question.needsInference, true);
});

test("third-party and structurally reported affect never become explicit high user affect", () => {
  let nowMs = 2_000;
  const tracker = createPerceivedUserAffectTracker({ now: () => nowMs });

  for (const text of [
    "我朋友今天很难过",
    "朋友说我很开心",
    "朋友说，我今天很难过",
    "我妈妈说我很累",
    "老板说我很开心",
    "老师觉得我很焦虑",
    "老师觉得：我现在很焦虑",
    "医生告诉我很累",
    "医生告诉我：“我今天很累。”",
    "小王认为我很难过",
    "小王认为，我现在很开心",
    "林晓表示我很兴奋",
    "林晓表示：我很兴奋"
  ]) {
    nowMs += 1;
    const decision = tracker.perceiveText(text);
    assert.equal(decision.affect.kind, "unknown", text);
    assert.notEqual(decision.affect.source, "explicit-text", text);
    assert.equal(decision.needsInference, true, text);
  }

  for (const [text, kind] of [
    ["我今天真的很难过", "low"],
    ["我现在很开心", "positive"],
    ["我今天很累", "tired"]
  ] as const) {
    nowMs += 1;
    const decision = tracker.perceiveText(text);
    assert.equal(decision.affect.kind, kind, text);
    assert.equal(decision.affect.confidence, "high", text);
    assert.equal(decision.affect.source, "explicit-text", text);
  }

  for (const [text, kind] of [
    ["我跟老师说我很焦虑", "tense"],
    ["我跟朋友说，我今天很难过", "low"],
    ["我对老师说：我现在很焦虑", "tense"],
    ["我告诉医生：“我今天很累。”", "tired"],
    ["我跟小王说，我现在很开心", "positive"],
    ["朋友刚才说了很多。我现在很难过", "low"],
    ["我觉得我很累", "tired"]
  ] as const) {
    nowMs += 1;
    const decision = tracker.perceiveText(text);
    assert.equal(decision.affect.kind, kind, text);
    assert.equal(decision.affect.confidence, "high", text);
    assert.equal(decision.affect.source, "explicit-text", text);
  }
});

test("negation scope, first-person questions, and mixed corrections do not become false explicit affect", () => {
  let nowMs = 5_000;
  const tracker = createPerceivedUserAffectTracker({ now: () => nowMs });

  for (const text of [
    "别觉得我难过",
    "你觉得我开心吗？",
    "我并不兴奋",
    "我并不平静"
  ]) {
    nowMs += 1;
    const decision = tracker.perceiveText(text);
    assert.equal(decision.affect.kind, "unknown", text);
    assert.notEqual(decision.affect.source, "explicit-text", text);
  }

  nowMs += 1;
  const mixed = tracker.perceiveText("我不难过，我现在很开心");
  assert.equal(mixed.affect.kind, "positive");
  assert.equal(mixed.affect.confidence, "high");
  assert.equal(mixed.affect.source, "explicit-text");
  assert.deepEqual(mixed.correctedKinds, ["low"]);
  assert.equal(tracker.isInferenceSuppressed("low"), true);

  nowMs += 1;
  const notJoking = tracker.perceiveText("我没有开玩笑");
  assert.equal(notJoking.affect.kind, "unknown");
  assert.notEqual(notJoking.affect.source, "user-correction");
  assert.equal(notJoking.needsInference, true);
});

test("negation and joke corrections immediately clear affect and suppress same-kind inference for 15 minutes", () => {
  let nowMs = 10_000;
  const tracker = createPerceivedUserAffectTracker({ now: () => nowMs });
  tracker.perceiveText("我现在有点难过");

  const correction = tracker.perceiveText("我没有难过，别担心");
  assert.equal(correction.affect.kind, "unknown");
  assert.equal(correction.affect.confidence, "low");
  assert.equal(correction.affect.source, "user-correction");
  assert.deepEqual(correction.correctedKinds, ["low"]);
  assert.equal(correction.needsInference, false);

  const inferredLow = classifiedInference("low");
  assert.equal(tracker.acceptInference(inferredLow).kind, "unknown");
  assert.equal(tracker.isInferenceSuppressed("low"), true);
  nowMs += USER_AFFECT_CORRECTION_SUPPRESSION_MS - 1;
  assert.equal(tracker.acceptInference(inferredLow).kind, "unknown");
  nowMs += 1;
  assert.equal(tracker.acceptInference(inferredLow).kind, "low");

  tracker.perceiveText("我现在很焦虑");
  const joke = tracker.perceiveText("我刚才只是开玩笑");
  assert.equal(joke.affect.source, "user-correction");
  assert.deepEqual(joke.correctedKinds, ["tense"]);
  assert.equal(tracker.acceptInference(classifiedInference("tense")).kind, "unknown");
});

test("explicit text overrides a correction window while inferred high is capped at medium", () => {
  let nowMs = 50_000;
  const tracker = createPerceivedUserAffectTracker({ now: () => nowMs });
  tracker.perceiveText("我不累");
  assert.equal(tracker.isInferenceSuppressed("tired"), true);

  nowMs += 1;
  assert.equal(tracker.perceiveText("我现在真的很累").affect.confidence, "high");
  assert.equal(tracker.isInferenceSuppressed("tired"), false);

  nowMs += 1;
  assert.deepEqual(tracker.acceptInference({
    ...classifiedInference("positive"),
    confidence: "high"
  }), {
    kind: "positive",
    confidence: "medium",
    source: "conversational-inference",
    observedAtMs: nowMs
  });
});

test("two same-direction medium signals are required and opposite signals reset hysteresis", () => {
  let nowMs = 100_000;
  const coordinator = createXitaAffectCoordinator({ now: () => nowMs });

  assert.equal(coordinator.applyUserAffect(inferredAffect("low", nowMs)).state, "calm");
  nowMs += 1;
  assert.equal(coordinator.applyUserAffect(inferredAffect("positive", nowMs)).state, "calm");
  nowMs += 1;
  assert.equal(coordinator.applyUserAffect(inferredAffect("tired", nowMs)).state, "calm");
  nowMs += 1;
  const concerned = coordinator.applyUserAffect(inferredAffect("low", nowMs));
  assert.equal(concerned.state, "concerned");
  assert.equal(concerned.intensity, "medium");
  assert.equal(concerned.transitionReason, "conversation");
});

test("medium hysteresis candidates expire before a later signal can switch state", () => {
  let nowMs = 125_000;
  const coordinator = createXitaAffectCoordinator({ now: () => nowMs });

  assert.equal(coordinator.applyUserAffect(inferredAffect("low", nowMs)).state, "calm");
  nowMs += XITA_AFFECT_HYSTERESIS_TTL_MS;
  assert.equal(coordinator.tick().state, "calm");
  assert.equal(coordinator.applyUserAffect(inferredAffect("low", nowMs)).state, "calm");
  nowMs += 1;
  assert.equal(coordinator.applyUserAffect(inferredAffect("low", nowMs)).state, "concerned");
});

test("repeated default presence preserves medium hysteresis while real sleep transitions clear it", () => {
  let nowMs = 140_000;
  const coordinator = createXitaAffectCoordinator({ now: () => nowMs });

  assert.equal(coordinator.applyUserAffect(inferredAffect("low", nowMs)).state, "calm");
  assert.equal(coordinator.updatePresenceState("default").state, "calm");
  nowMs += 1;
  assert.equal(coordinator.applyUserAffect(inferredAffect("low", nowMs)).state, "concerned");

  nowMs += 1;
  assert.equal(coordinator.updatePresenceState("sleep").state, "sleepy");
  nowMs += 1;
  assert.equal(coordinator.updatePresenceState("default").state, "calm");
  nowMs += 1;
  assert.equal(coordinator.applyUserAffect(inferredAffect("low", nowMs)).state, "calm");
});

test("medium calm inference also needs two signals while explicit calm applies immediately", () => {
  let nowMs = 150_000;
  const coordinator = createXitaAffectCoordinator({ now: () => nowMs });
  coordinator.applyUserAffect({
    kind: "low",
    confidence: "high",
    source: "explicit-text",
    observedAtMs: nowMs
  });
  nowMs += 1;
  assert.equal(coordinator.applyUserAffect({
    kind: "calm",
    confidence: "medium",
    source: "conversational-inference",
    observedAtMs: nowMs
  }).state, "concerned");
  nowMs += 1;
  const inferredCalm = coordinator.applyUserAffect({
    kind: "calm",
    confidence: "medium",
    source: "conversational-inference",
    observedAtMs: nowMs
  });
  assert.equal(inferredCalm.state, "calm");
  assert.equal(inferredCalm.intensity, "low");

  coordinator.applyUserAffect({
    kind: "tense",
    confidence: "high",
    source: "explicit-text",
    observedAtMs: nowMs
  });
  nowMs += 1;
  assert.equal(coordinator.applyUserAffect({
    kind: "calm",
    confidence: "medium",
    source: "explicit-text",
    observedAtMs: nowMs
  }).state, "calm");
});

test("explicit affect updates immediately, inferred high cannot bypass hysteresis, and correction returns calm", () => {
  let nowMs = 200_000;
  const coordinator = createXitaAffectCoordinator({ now: () => nowMs });

  const explicit = coordinator.applyUserAffect({
    kind: "excited",
    confidence: "high",
    source: "explicit-text",
    observedAtMs: nowMs
  });
  assert.equal(explicit.state, "happy");
  assert.equal(explicit.intensity, "high");

  nowMs += 1;
  const corrected = coordinator.applyUserAffect({
    kind: "unknown",
    confidence: "low",
    source: "user-correction",
    observedAtMs: nowMs
  });
  assert.equal(corrected.state, "calm");
  assert.equal(corrected.transitionReason, "user-correction");

  nowMs += 1;
  const unsafeInference: PerceivedUserAffect = {
    kind: "tense",
    confidence: "high",
    source: "conversational-inference",
    observedAtMs: nowMs
  };
  assert.equal(coordinator.applyUserAffect(unsafeInference).state, "calm");
  nowMs += 1;
  assert.equal(coordinator.applyUserAffect(unsafeInference).state, "serious");
  assert.equal(coordinator.getSnapshot().intensity, "medium");
});

test("six-minute decay applies once and twenty minutes without reinforcement returns calm", () => {
  let nowMs = 300_000;
  const coordinator = createXitaAffectCoordinator({ now: () => nowMs });
  coordinator.applyUserAffect({
    kind: "positive",
    confidence: "high",
    source: "explicit-text",
    observedAtMs: nowMs
  });

  nowMs += XITA_AFFECT_DECAY_MS;
  assert.equal(coordinator.tick().intensity, "medium");
  assert.equal(coordinator.tick().intensity, "medium");
  assert.equal(coordinator.getSnapshot().transitionReason, "idle-decay");

  nowMs = 300_000 + XITA_AFFECT_CALM_MS;
  const calm = coordinator.tick();
  assert.equal(calm.state, "calm");
  assert.equal(calm.intensity, "low");
  assert.equal(calm.transitionReason, "idle-decay");
});

test("tired user affect never creates sleepy; only the existing sleep presence state can", () => {
  let nowMs = 400_000;
  const coordinator = createXitaAffectCoordinator({ now: () => nowMs });
  coordinator.applyUserAffect(inferredAffect("tired", nowMs));
  nowMs += 1;
  assert.equal(coordinator.applyUserAffect(inferredAffect("tired", nowMs)).state, "concerned");

  nowMs += 1;
  assert.equal(coordinator.updatePresenceState("sleep").state, "sleepy");
  assert.equal(coordinator.getSnapshot().transitionReason, "environment-safe");
  nowMs += 1;
  assert.equal(coordinator.updatePresenceState("default").state, "calm");
});

test("store atomically persists only low or medium Xita state and restores it within 15 minutes", async () => {
  await withStore(async (userDataPath) => {
    let nowMs = 1_000_000;
    const store = createXitaAffectStore({ userDataPath, now: () => nowMs });
    const snapshot = {
      state: "concerned",
      intensity: "medium",
      valence: -0.45,
      arousal: 0.25,
      transitionReason: "conversation",
      updatedAtMs: nowMs,
      lastReinforcedAtMs: nowMs
    } as const;
    store.save(snapshot);

    const stored = JSON.parse(await readFile(store.getStatePath(), "utf8")) as Record<string, unknown>;
    assert.deepEqual(stored, {
      version: 1,
      state: "concerned",
      intensity: "medium",
      timestampMs: nowMs
    });
    assert.equal("userAffect" in stored, false);
    assert.equal("text" in stored, false);
    assert.equal("getSnapshot" in store, false);
    assert.deepEqual(await readdir(dirname(store.getStatePath())), ["xita-affect-state.json"]);

    nowMs += XITA_AFFECT_RESTART_RECOVERY_MS;
    const recovered = store.load();
    assert.equal(recovered.state, "concerned");
    assert.equal(recovered.intensity, "medium");
    assert.equal(recovered.transitionReason, "restart-recovery");
    assert.equal(recovered.lastReinforcedAtMs, 1_000_000);
  });
});

test("high, expired, corrupt, future, and unknown persisted data all recover as calm low", async () => {
  await withStore(async (userDataPath) => {
    let nowMs = 2_000_000;
    const store = createXitaAffectStore({ userDataPath, now: () => nowMs });
    store.save({
      ...createCalmXitaAffect(nowMs, "conversation"),
      state: "happy",
      intensity: "high",
      valence: 0.75,
      arousal: 0.55
    });
    assert.deepEqual(JSON.parse(await readFile(store.getStatePath(), "utf8")), {
      version: 1,
      state: "calm",
      intensity: "low",
      timestampMs: nowMs
    });
    assertCalmLow(store.load());

    const writeStored = async (value: unknown): Promise<void> => {
      await mkdir(dirname(store.getStatePath()), { recursive: true });
      await writeFile(store.getStatePath(), JSON.stringify(value), "utf8");
    };
    await writeStored({ version: 1, state: "concerned", intensity: "medium", timestampMs: nowMs + 1 });
    assertCalmLow(store.load());
    await writeStored({ version: 1, state: "concerned", intensity: "medium", timestampMs: nowMs - XITA_AFFECT_RESTART_RECOVERY_MS - 1 });
    assertCalmLow(store.load());
    await writeStored({ version: 1, state: "happy", intensity: "high", timestampMs: nowMs });
    assertCalmLow(store.load());
    await writeStored({ version: 1, state: "diagnosed", intensity: "medium", timestampMs: nowMs });
    assertCalmLow(store.load());
    await writeFile(store.getStatePath(), "{bad json", "utf8");
    assertCalmLow(store.load());
  });
});

test("background classification is non-blocking and ignores stale request epochs", async () => {
  const pending = new Map<string, (result: UserAffectClassifierResult) => void>();
  const classifier: UserAffectClassifier = {
    classify({ text }) {
      return new Promise((resolve) => {
        pending.set(text, resolve);
      });
    }
  };
  const runner = createBackgroundUserAffectClassificationRunner({ classifier });
  const applied: number[] = [];

  const firstIdentity = runner.beginRequest(1, "conversation-a");
  assert.equal(runner.start({
    identity: firstIdentity,
    text: "first",
    onResult: () => applied.push(1)
  }), true);
  await flushPromises();
  assert.ok(pending.has("first"));

  const secondIdentity = runner.beginRequest(2, "conversation-b");
  assert.equal(runner.start({
    identity: secondIdentity,
    text: "second",
    onResult: () => applied.push(2)
  }), true);
  await flushPromises();
  pending.get("first")?.(classifiedInference("low"));
  await flushPromises();
  assert.deepEqual(applied, []);

  pending.get("second")?.(classifiedInference("positive"));
  await flushPromises();
  assert.deepEqual(applied, [2]);

  const disabledIdentity = runner.beginRequest(3, "conversation-b");
  assert.equal(runner.start({
    identity: disabledIdentity,
    text: "disabled",
    onResult: () => applied.push(3)
  }), true);
  await flushPromises();
  runner.invalidate();
  pending.get("disabled")?.(classifiedInference("tense"));
  await flushPromises();
  assert.deepEqual(applied, [2]);
  assert.equal(runner.start({
    identity: disabledIdentity,
    text: "stale",
    onResult: () => applied.push(3)
  }), false);
});

test("conversation tracker registry isolates corrections and evicts the oldest session", () => {
  let nowMs = 500_000;
  const registry = createPerceivedUserAffectTrackerRegistry({
    maxEntries: 2,
    createTracker: () => createPerceivedUserAffectTracker({ now: () => nowMs })
  });
  const first = registry.getOrCreate("conversation-a");
  first.perceiveText("我不难过");
  assert.equal(first.isInferenceSuppressed("low"), true);

  const second = registry.getOrCreate("conversation-b");
  assert.equal(second.isInferenceSuppressed("low"), false);
  assert.notEqual(first, second);
  assert.equal(registry.size(), 2);

  registry.getOrCreate("conversation-c");
  assert.equal(registry.get("conversation-a"), null);
  assert.equal(registry.get("conversation-b"), second);
  assert.equal(registry.size(), 2);

  registry.clear();
  assert.equal(registry.size(), 0);
});

test("background inference updates the coordinator for a later ambiguous turn", () => {
  let nowMs = 600_000;
  const tracker = createPerceivedUserAffectTracker({ now: () => nowMs });
  const coordinator = createXitaAffectCoordinator({ now: () => nowMs });

  const firstDecision = tracker.perceiveText("今天什么都提不起劲");
  assert.equal(firstDecision.needsInference, true);
  assert.equal(resolveAffectDialoguePresentation(coordinator.getSnapshot()).dialogueContextId, undefined);
  coordinator.applyUserAffect(tracker.acceptInference(classifiedInference("low")));

  nowMs += 1;
  const secondDecision = tracker.perceiveText("还是不太想说话");
  assert.equal(secondDecision.needsInference, true);
  coordinator.applyUserAffect(tracker.acceptInference(classifiedInference("low")));

  nowMs += 1;
  const thirdDecision = tracker.perceiveText("嗯");
  assert.equal(thirdDecision.needsInference, true);
  const laterPresentation = resolveAffectDialoguePresentation(coordinator.getSnapshot());
  assert.equal(laterPresentation.dialogueContextId, "quiet-support");
  assert.deepEqual(laterPresentation.action, { reason: "state_listen" });
});

function classifiedInference(
  kind: Exclude<UserAffectClassifierResult["kind"], "unknown">
): UserAffectClassifierResult {
  return {
    kind,
    confidence: "medium",
    source: "conversational-inference",
    status: "classified"
  };
}

function inferredAffect(
  kind: "positive" | "low" | "tense" | "tired",
  observedAtMs: number
): PerceivedUserAffect {
  return {
    kind,
    confidence: "medium",
    source: "conversational-inference",
    observedAtMs
  };
}

function assertCalmLow(snapshot: ReturnType<ReturnType<typeof createXitaAffectStore>["load"]>): void {
  assert.equal(snapshot.state, "calm");
  assert.equal(snapshot.intensity, "low");
  assert.equal(snapshot.transitionReason, "restart-recovery");
}

async function withStore(run: (userDataPath: string) => Promise<void>): Promise<void> {
  const userDataPath = await mkdtemp(join(tmpdir(), "desktop-pet-affect-"));
  try {
    await run(userDataPath);
  } finally {
    await rm(userDataPath, { recursive: true, force: true });
  }
}

async function flushPromises(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}
