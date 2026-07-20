import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

import {
  deriveAutomaticPresenceState,
  parseAutomaticSituationClassification
} from "../src/shared/automatic-situation-context.ts";
import {
  createAutomaticSituationCoordinator,
  type AutomaticSituationClassifier
} from "../src/main/services/automatic-situation/automatic-situation-coordinator.ts";
import { createBundledLocalSituationClassifier } from "../src/main/services/automatic-situation/bundled-local-situation-classifier.ts";

test("automatic situation parser accepts only the exact local closed-set schema", () => {
  assert.deepEqual(
    parseAutomaticSituationClassification('{"label":"work","confidence":0.91}'),
    { label: "work", confidence: 0.91 }
  );
  assert.deepEqual(
    parseAutomaticSituationClassification('{"confidence":0.8,"label":"reading"}'),
    { label: "reading", confidence: 0.8 }
  );
  for (const value of [
    '{"label":"game","confidence":0.93}',
    '{"label":"sleep","confidence":0.99}',
    '{"label":"work","confidence":0.91,"action":"workFocus"}',
    '{"label":"work","confidence":"high"}',
    '{"label":"work","confidence":1.1}',
    '```json\n{"label":"work","confidence":0.9}\n```',
    'work',
    '',
    '{bad json}'
  ]) {
    assert.equal(parseAutomaticSituationClassification(value), null, value);
  }
});

test("presence state is derived deterministically and model labels cannot select sleep", () => {
  assert.deepEqual(deriveAutomaticPresenceState({
    conversationContextId: "work",
    appActive: true,
    quietRequested: false,
    localTimeBand: "afternoon",
    systemIdleMs: 0
  }), { stateId: "focus", source: "work-activity" });

  assert.deepEqual(deriveAutomaticPresenceState({
    conversationContextId: "reading",
    appActive: false,
    quietRequested: true,
    localTimeBand: "evening",
    systemIdleMs: 0
  }), { stateId: "quiet", source: "quiet-preference" });

  assert.deepEqual(deriveAutomaticPresenceState({
    conversationContextId: "default",
    appActive: false,
    quietRequested: false,
    localTimeBand: "night",
    systemIdleMs: 90 * 60_000
  }), { stateId: "sleep", source: "deterministic-sleep" });

  assert.deepEqual(deriveAutomaticPresenceState({
    conversationContextId: "default",
    appActive: false,
    quietRequested: false,
    localTimeBand: "night",
    systemIdleMs: 89 * 60_000
  }), { stateId: "default", source: "default" });
});

test("coordinator accepts only the latest classification and expires model context to default", async () => {
  let nowMs = 1_000;
  const pending: Array<(value: Awaited<ReturnType<AutomaticSituationClassifier["classify"]>>) => void> = [];
  const classifier: AutomaticSituationClassifier = {
    classify() {
      return new Promise((resolve) => pending.push(resolve));
    }
  };
  const coordinator = createAutomaticSituationCoordinator({
    classifier,
    now: () => nowMs,
    classificationTtlMs: 1_000,
    hysteresisMs: 0
  });

  const first = coordinator.classifyLatest({ messageId: "first", text: "整理工作计划" });
  const second = coordinator.classifyLatest({ messageId: "second", text: "阅读这篇文章" });
  pending[1]?.({ contextId: "reading", confidence: 0.92, status: "classified" });
  assert.equal((await second).accepted, true);
  pending[0]?.({ contextId: "work", confidence: 0.95, status: "classified" });
  assert.equal((await first).reason, "late-result");
  assert.equal(coordinator.getSnapshot().conversationContextId, "reading");

  nowMs += 1_001;
  coordinator.tick();
  assert.equal(coordinator.getSnapshot().conversationContextId, "default");
  assert.equal(coordinator.getSnapshot().conversationSource, "expired");
  coordinator.dispose();
});

test("user-explicit game temporarily overrides and then restores model context", async () => {
  let nowMs = 5_000;
  const classifier: AutomaticSituationClassifier = {
    async classify() {
      return { contextId: "work", confidence: 0.9, status: "classified" };
    }
  };
  const coordinator = createAutomaticSituationCoordinator({
    classifier,
    now: () => nowMs,
    classificationTtlMs: 10_000,
    hysteresisMs: 0
  });

  await coordinator.classifyLatest({ messageId: "work", text: "继续写代码" });
  coordinator.updateExplicitGameContext(true);
  assert.equal(coordinator.getSnapshot().conversationContextId, "game");
  assert.equal(coordinator.getSnapshot().conversationSource, "user-explicit");

  nowMs += 60_000;
  coordinator.tick();
  assert.equal(coordinator.getSnapshot().conversationContextId, "game");

  coordinator.updateExplicitGameContext(false);
  assert.equal(coordinator.getSnapshot().conversationContextId, "default");
  coordinator.dispose();
});

test("bundled model keeps work and reading while explicit game has final write authority", async () => {
  const classifier: AutomaticSituationClassifier = {
    async classify() {
      return { contextId: "reading", confidence: 0.9, status: "classified" };
    }
  };
  const coordinator = createAutomaticSituationCoordinator({ classifier, hysteresisMs: 0 });

  await coordinator.classifyLatest({ messageId: "reading", text: "我在读这篇文章" });
  coordinator.updateExplicitGameContext(true);
  assert.equal(coordinator.getSnapshot().conversationContextId, "game");
  assert.equal(coordinator.getSnapshot().conversationSource, "user-explicit");

  coordinator.updateExplicitGameContext(false);
  assert.equal(coordinator.getSnapshot().conversationContextId, "reading");
  assert.equal(coordinator.getSnapshot().conversationSource, "bundled-local-model");
  coordinator.dispose();
});

test("coordinator rejects a runtime model game result and cannot revive cleared explicit game", async () => {
  const classifier = {
    async classify() {
      return { contextId: "game", confidence: 0.99, status: "classified" };
    }
  } as unknown as AutomaticSituationClassifier;
  const coordinator = createAutomaticSituationCoordinator({ classifier, hysteresisMs: 0 });

  coordinator.updateExplicitGameContext(true);
  coordinator.updateExplicitGameContext(false);
  const result = await coordinator.classifyLatest({ messageId: "late-game", text: "普通对话" });
  assert.equal(result.reason, "invalid-output");
  assert.equal(result.snapshot.conversationContextId, "default");
  assert.notEqual(result.snapshot.conversationSource, "user-explicit");
  coordinator.dispose();
});

test("cancelling a late classification aborts its bundled-model request and preserves the snapshot", async () => {
  let aborted = false;
  const classifier: AutomaticSituationClassifier = {
    classify({ signal }) {
      return new Promise((resolve) => {
        signal?.addEventListener("abort", () => {
          aborted = true;
          resolve({ contextId: "work", confidence: 0.9, status: "classified" });
        }, { once: true });
      });
    }
  };
  const coordinator = createAutomaticSituationCoordinator({ classifier, hysteresisMs: 0 });
  const pending = coordinator.classifyLatest({ messageId: "late", text: "写代码" });
  coordinator.cancelPendingClassification();

  assert.equal((await pending).reason, "late-result");
  assert.equal(aborted, true);
  assert.equal(coordinator.getSnapshot().conversationContextId, "default");
  coordinator.dispose();
});

test("hysteresis discards a superseded candidate before it can change state", async () => {
  const delayed: Array<() => void> = [];
  const classifier: AutomaticSituationClassifier = {
    async classify({ text }) {
      return { contextId: text === "first" ? "work" : "reading", confidence: 0.9, status: "classified" };
    }
  };
  const coordinator = createAutomaticSituationCoordinator({
    classifier,
    hysteresisMs: 350,
    delay: () => new Promise((resolveDelay) => delayed.push(resolveDelay))
  });

  const first = coordinator.classifyLatest({ messageId: "first", text: "first" });
  await Promise.resolve();
  const second = coordinator.classifyLatest({ messageId: "second", text: "second" });
  delayed[0]?.();
  assert.equal((await first).reason, "late-result");
  delayed[1]?.();
  assert.equal((await second).accepted, true);
  assert.equal(coordinator.getSnapshot().conversationContextId, "reading");
  coordinator.dispose();
});

test("bundled classifier rejects game output because game is user-explicit only", async () => {
  const responseFor = (content: string) => async () => new Response(JSON.stringify({
    choices: [{ message: { content } }]
  }), { status: 200, headers: { "content-type": "application/json" } });
  const target = () => ({
    baseURL: "http://127.0.0.1:12345/v1",
    model: "qwen3.5-2b",
    localPresetId: "embedded-llama-cpp" as const
  });
  const gameResponse = responseFor('{"label":"game","confidence":0.96}');
  const classifier = createBundledLocalSituationClassifier({ getTarget: target, fetchFn: gameResponse });

  for (const text of [
    "我正在玩游戏，先陪我打一局。",
    "我正在开发一款游戏。",
    "给我讲讲这款游戏的世界观。",
    "今天有哪些游戏新闻？",
    "这篇游戏评测写得怎么样？",
    "朋友正在玩游戏。"
  ]) {
    assert.deepEqual(await classifier.classify({ text }), {
      contextId: "default",
      confidence: null,
      status: "invalid-output"
    }, text);
  }
});

test("bundled classifier defaults on low confidence, invalid output, timeout, or unavailable runtime", async () => {
  const responseFor = (content: string) => async () => new Response(JSON.stringify({
    choices: [{ message: { content } }]
  }), { status: 200, headers: { "content-type": "application/json" } });
  const target = () => ({
    baseURL: "http://127.0.0.1:12345/v1",
    model: "qwen3.5-2b",
    localPresetId: "embedded-llama-cpp" as const
  });

  const classified = createBundledLocalSituationClassifier({
    getTarget: target,
    fetchFn: responseFor('{"label":"work","confidence":0.88}')
  });
  assert.deepEqual(await classified.classify({ text: "写代码" }), {
    contextId: "work",
    confidence: 0.88,
    status: "classified"
  });

  const lowConfidence = createBundledLocalSituationClassifier({
    getTarget: target,
    fetchFn: responseFor('{"label":"reading","confidence":0.4}')
  });
  assert.deepEqual(await lowConfidence.classify({ text: "看文章" }), {
    contextId: "default",
    confidence: null,
    status: "low-confidence"
  });

  const invalid = createBundledLocalSituationClassifier({
    getTarget: target,
    fetchFn: responseFor('{"label":"sleep","confidence":0.99}')
  });
  assert.equal((await invalid.classify({ text: "我正在玩游戏" })).status, "invalid-output");

  const unavailable = createBundledLocalSituationClassifier({
    getTarget: () => null,
    fetchFn: responseFor('{"label":"work","confidence":0.99}')
  });
  assert.equal((await unavailable.classify({ text: "写代码" })).status, "unavailable");

  const timedOut = createBundledLocalSituationClassifier({
    getTarget: target,
    timeoutMs: 5,
    fetchFn: (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    })
  });
  assert.equal((await timedOut.classify({ text: "写代码" })).status, "timeout");
});

test("bundled classifier rejects external targets and sends only one bounded user message", async () => {
  let requestBody: Record<string, unknown> | null = null;
  const classifier = createBundledLocalSituationClassifier({
    getTarget: () => ({
      baseURL: "http://localhost:12345/v1",
      model: "qwen3.5-2b",
      localPresetId: "embedded-llama-cpp"
    }),
    fetchFn: async (_url, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        choices: [{ message: { content: '{"label":"default","confidence":0.99}' } }]
      }), { status: 200 });
    }
  });
  await classifier.classify({ text: "x".repeat(1_500) });
  const messages = requestBody?.messages as Array<{ role: string; content: string }>;
  assert.equal(messages.length, 2);
  assert.equal(messages[0]?.role, "system");
  assert.match(messages[0]?.content ?? "", /Allowed labels: default, work, reading\./u);
  assert.match(messages[0]?.content ?? "", /Game development is work/u);
  assert.equal(messages[1]?.role, "user");
  assert.equal(messages[1]?.content.length, 1_000);
  assert.equal(requestBody?.stream, false);
  assert.equal(requestBody?.max_tokens, 32);

  let externalFetchCount = 0;
  const external = createBundledLocalSituationClassifier({
    getTarget: () => ({
      baseURL: "https://api.example.com/v1",
      model: "remote-model",
      localPresetId: "embedded-llama-cpp"
    }),
    fetchFn: async () => {
      externalFetchCount += 1;
      return new Response();
    }
  });
  assert.equal((await external.classify({ text: "hello" })).status, "unavailable");
  assert.equal(externalFetchCount, 0);
});

test("manual mode UI, writable preload APIs, IPC handlers, and persistent stores are absent", () => {
  const html = readFileSync(resolve(root, "src/renderer/chat/index.html"), "utf8");
  const renderer = readFileSync(resolve(root, "src/renderer/chat/main.ts"), "utf8");
  const chatPreload = readFileSync(resolve(root, "src/preload/chat-preload.ts"), "utf8");
  const petPreload = readFileSync(resolve(root, "src/preload/pet-preload.ts"), "utf8");
  const rendererGlobals = readFileSync(resolve(root, "src/renderer/global.d.ts"), "utf8");
  const app = readFileSync(resolve(root, "src/main/app.ts"), "utf8");

  assert.doesNotMatch(html, /dialogue-mode|presence-mode|对话模式|存在模式/);
  assert.doesNotMatch(renderer, /dialogueModeApi|presenceModeApi|set(?:Dialogue|Presence)ModeFromUi/);
  assert.doesNotMatch(chatPreload, /dialogueModeApi|presenceModeApi|dialogueMode:set|presenceMode:set/);
  assert.doesNotMatch(app, /dialogueMode:(?:list|get|set)|presenceMode:(?:list|get|set)/);
  assert.match(app, /ipcMain\.handle\("automaticSituation:get"/);
  assert.match(petPreload, /ipcRenderer\.invoke\("automaticSituation:get"\)/);
  assert.match(petPreload, /ipcRenderer\.on\("automaticSituation:changed"/);
  assert.match(petPreload, /getAutomaticSituation/);
  assert.match(petPreload, /onAutomaticSituationChanged/);
  assert.doesNotMatch(petPreload, /getDialogueMode|getPresenceMode|onDialogueModeChanged|onPresenceModeChanged/);
  assert.doesNotMatch(rendererGlobals, /DialogueModeApi|PresenceModeApi|dialogueModeApi|presenceModeApi/);
  assert.equal(existsSync(resolve(root, "src/main/services/config/dialogue-mode-store.ts")), false);
  assert.equal(existsSync(resolve(root, "src/main/services/config/presence-mode-store.ts")), false);
});

test("the current reply uses an existing snapshot and starts classification only after stream completion", () => {
  const app = readFileSync(resolve(root, "src/main/app.ts"), "utf8");
  const chatHandlerStart = app.indexOf("async function handleChatSend");
  const snapshotIndex = app.indexOf("const situationSnapshotForRequest", chatHandlerStart);
  const streamIndex = app.indexOf("startChatStream(providerRequest", chatHandlerStart);
  const doneIndex = app.indexOf('event.sender.send("chat:stream-done"', streamIndex);
  const classificationIndex = app.indexOf("automaticSituationCoordinator?.classifyLatest", streamIndex);

  assert.ok(snapshotIndex > chatHandlerStart);
  assert.ok(snapshotIndex < streamIndex);
  assert.ok(doneIndex > streamIndex);
  assert.ok(classificationIndex > doneIndex);
  assert.doesNotMatch(app.slice(snapshotIndex, streamIndex), /classifyLatest|classificationPromise/);
  assert.match(app.slice(chatHandlerStart, snapshotIndex), /cancelPendingClassification\(\)/);
  assert.match(app.slice(chatHandlerStart, snapshotIndex), /coarseUserStateCoordinator\?\.handleUserMessage/);
});
