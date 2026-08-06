import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  parseHistoryConversation,
  parseHistoryConversationList,
  parseHistoryIdRequest,
  parseHistoryRetentionRequest,
  parseHistoryRetentionLimit,
  parseMemoryCardDraftRequest,
  parseMemoryCard,
  parseMemoryCards,
  parseMemoryCardUpdateRequest,
  parseMemoryCreateResult,
  parseMemoryEnabledRequest,
  parseMemoryForgetResult,
  parseMemoryIdRequest,
  parseMemoryReviewCandidate,
  parseMemoryReviewCandidates,
  parseMemoryReviewDecisionRequest,
  parseMemoryReviewDecisionDraft,
  parseMemoryReviewConfirmationResult,
  parseMemoryReviewDecisionResult,
  parseMemorySettings,
  parseMemorySummary,
  parseMemorySuppressionView,
  parseMemorySuppressionViews,
  parseNullableHistoryConversation,
  parseNullableMemoryCard
} = require("../dist/shared/memory-history-codec.js") as typeof import("../src/shared/memory-history-codec");

const id = "11111111-1111-4111-8111-111111111111";
const id2 = "22222222-2222-4222-8222-222222222222";
const now = 1_700_000_000_000;

const message = { id: id2, role: "user", content: "hello", createdAt: now };
const conversation = { id, title: "First conversation", createdAt: now, updatedAt: now, messages: [message] };
const summary = { id, title: "First conversation", createdAt: now, updatedAt: now, messageCount: 1 };
const card = {
  id,
  title: "Language preference",
  content: "Reply in Simplified Chinese.",
  tags: ["language"],
  sourceConversationId: id2,
  sourceType: "manual-chat",
  namespace: "personal",
  key: "language-preference",
  importance: "key",
  category: "language",
  confidence: 1,
  sourceMessageId: null,
  observedCount: 1,
  lastObservedAt: now,
  compressionState: "raw",
  createdAt: now,
  updatedAt: now,
  enabled: true,
  managedByUser: true,
  lastInjectedAt: null,
  injectionCount: 0
};

const review = {
  id,
  action: "create",
  title: "Language preference",
  content: "Reply in Simplified Chinese.",
  tags: ["language"],
  namespace: "personal",
  key: "language-preference",
  importance: "key",
  category: "language",
  confidence: 0.9,
  sourceConversationId: id2,
  sourceMessageId: id,
  status: "pending-review",
  createdAt: now,
  updatedAt: now
};

const memorySummary = {
  enabled: true,
  totalCards: 1,
  enabledCards: 1,
  disabledCards: 0,
  injectableCount: 1,
  injectionBudget: 4,
  compressionThreshold: 12,
  sourceTypeCounts: { "manual-chat": 1, "auto-local-heuristic": 0, "auto-local-model": 0 },
  importanceCounts: { key: 1, general: 0 },
  compressionStateCounts: { raw: 1, merged: 0, deduplicated: 0, budgeted: 0 },
  categoryCounts: { language: 1 }
};

function withExtra<T extends object>(value: T): T & { extra: true } {
  return { ...value, extra: true };
}

function withOwnMutation(value: object, kind: "symbol" | "hidden" | "accessor"): object {
  const mutated = { ...value };
  if (kind === "symbol") Object.defineProperty(mutated, Symbol("extra"), { value: true, enumerable: true });
  if (kind === "hidden") Object.defineProperty(mutated, "hidden", { value: true, enumerable: false });
  if (kind === "accessor") Object.defineProperty(mutated, "enabled", { get: () => true, enumerable: true });
  return mutated;
}

function handlerSource(appSource: string, channel: string): string {
  const start = appSource.indexOf(`ipcMain.handle("${channel}"`);
  assert.notEqual(start, -1, `missing handler ${channel}`);
  const next = appSource.indexOf("ipcMain.handle(", start + 16);
  return appSource.slice(start, next === -1 ? undefined : next);
}

function assertOrdered(source: string, fragments: readonly string[]): void {
  let cursor = -1;
  for (const fragment of fragments) {
    const index = source.indexOf(fragment, cursor + 1);
    assert.notEqual(index, -1, `missing ordered fragment: ${fragment}`);
    cursor = index;
  }
}

function runRegisteredMainHandlerMatrix(): void {
  const script = String.raw`
const assert = require("node:assert/strict");
const { existsSync, mkdtempSync, rmSync } = require("node:fs");
const Module = require("node:module");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const userDataPath = mkdtempSync(join(tmpdir(), "p2-91c2-main-handlers-"));
const handlers = new Map();
const calls = Object.create(null);
const callSequence = [];
const historyId = ${JSON.stringify(id)};
const secondId = ${JSON.stringify(id2)};
const now = ${now};
const card = ${JSON.stringify(card)};
const review = ${JSON.stringify(review)};
const summary = ${JSON.stringify(summary)};
const conversation = ${JSON.stringify(conversation)};
const suppression = { id: historyId, category: "language", createdAt: now };
const memorySummary = ${JSON.stringify(memorySummary)};
const state = {
  authorized: true,
  history: { list: [summary], get: conversation, delete: true, clear: true, retention: 500, setRetention: 500 },
  memory: {
    settings: { enabled: true }, summary: memorySummary, setEnabled: { enabled: true }, list: [card], get: card,
    create: { status: "created", card }, update: card, delete: true,
    forget: { status: "forgotten" }, clearCards: 7, suppressions: [suppression], allow: true,
    clearSuppressions: undefined, confirm: { status: "created" }
  },
  review: { list: [review], candidate: review, update: review, setStatus: { ...review, status: "confirmed" }, clear: 2 }
};
let ready;

function returnOrThrow(value) {
  if (value instanceof Error) throw value;
  return value;
}
function called(name) { calls[name] = (calls[name] || 0) + 1; callSequence.push(name); }
function clearCalls() { for (const name of Object.keys(calls)) delete calls[name]; callSequence.length = 0; }
function assertNoStoreCalls() { assert.deepEqual(Object.keys(calls), []); }
function expectError(callback, message) {
  assert.throws(callback, (error) => error instanceof Error && error.message === message);
}
function call(channel, ...args) {
  const handler = handlers.get(channel);
  assert.equal(typeof handler, "function", "missing registered handler " + channel);
  return handler({}, ...args);
}

const fakeWebContents = {
  send() {}, on() {}, once() {}, setWindowOpenHandler() {}, openDevTools() {},
  session: {
    webRequest: { onHeadersReceived() {} },
    setPermissionRequestHandler() {},
    setPermissionCheckHandler() {}
  },
  isDestroyed() { return false; },
  getURL() { return "file:///chat/index.html"; },
  mainFrame: null
};
const fakeWindow = {
  webContents: fakeWebContents,
  on() {}, once() {}, show() {}, hide() {}, close() {}, destroy() {}, focus() {},
  isDestroyed() { return false; }, isVisible() { return false; }, isFocused() { return false; },
  getBounds() { return { x: 0, y: 0, width: 300, height: 300 }; },
  setBounds() {}, setAlwaysOnTop() {}, setIgnoreMouseEvents() {}, setResizable() {},
  setMinimumSize() {}, setMaximumSize() {}, setPosition() {},
  getNativeWindowHandle() { return Buffer.from([1]); }
};
const electron = {
  app: {
    isPackaged: false,
    whenReady() { return { then(callback) { ready = callback; return Promise.resolve(); } }; },
    on() {}, getPath() { return userDataPath; }, setPath() {}, disableHardwareAcceleration() {},
    requestSingleInstanceLock() { return true; }, quit() {}, exit() {},
    getLocale() { return "zh-CN"; }, getAppPath() { return process.cwd(); }
  },
  BrowserWindow: class {
    static getAllWindows() { return []; }
    static fromWebContents() { return fakeWindow; }
  },
  dialog: { async showOpenDialog() { return { canceled: true, filePaths: [] }; } },
  globalShortcut: { register() { return true; }, unregister() {}, isRegistered() { return false; }, unregisterAll() {} },
  ipcMain: { handle(channel, callback) { handlers.set(channel, callback); }, on() {} },
  powerMonitor: { getSystemIdleTime() { return 0; }, on() {}, removeListener() {} },
  protocol: { registerSchemesAsPrivileged() {}, handle() {} },
  screen: {
    on() {},
    getPrimaryDisplay() { return { workArea: { x: 0, y: 0, width: 1920, height: 1080 } }; },
    getDisplayMatching() { return { workArea: { x: 0, y: 0, width: 1920, height: 1080 } }; }
  },
  shell: { async openExternal() {} },
  safeStorage: { isEncryptionAvailable() { return false; } }
};
const historyStore = {
  listConversations() { called("history:list"); return returnOrThrow(state.history.list); },
  getConversation() { called("history:get"); return returnOrThrow(state.history.get); },
  deleteConversation() { called("history:delete"); return returnOrThrow(state.history.delete); },
  clearConversations() { called("history:clear"); return returnOrThrow(state.history.clear); },
  getRetentionLimit() { called("history:get-retention"); return returnOrThrow(state.history.retention); },
  setRetentionLimit(value) { called("history:set-retention"); return returnOrThrow(state.history.setRetention); }
};
const memoryStore = {
  getSettings() { called("memory:get-settings"); return returnOrThrow(state.memory.settings); },
  getSummary() { called("memory:get-summary"); return returnOrThrow(state.memory.summary); },
  setEnabled() { called("memory:set-enabled"); return returnOrThrow(state.memory.setEnabled); },
  listCards() { called("memory:list"); return returnOrThrow(state.memory.list); },
  getCard() { called("memory:get"); return returnOrThrow(state.memory.get); },
  createCard() { called("memory:create"); return returnOrThrow(state.memory.create); },
  updateCard() { called("memory:update"); return returnOrThrow(state.memory.update); },
  deleteCard() { called("memory:delete"); return returnOrThrow(state.memory.delete); },
  forgetCard() { called("memory:forget"); return returnOrThrow(state.memory.forget); },
  clearCards() { called("memory:clear:cards"); return returnOrThrow(state.memory.clearCards); },
  listSuppressions() { called("memory:list-suppressions"); return returnOrThrow(state.memory.suppressions); },
  allowSuppression() { called("memory:allow-suppression"); return returnOrThrow(state.memory.allow); },
  clearSuppressions() { called("memory:clear-suppressions"); return returnOrThrow(state.memory.clearSuppressions); },
  getInjectionContext() { return null; },
  captureAutoMemoriesFromLatestUserMessage() { return { enabled: false, capturedCount: 0, safeCategories: [] }; },
  confirmReviewedCandidate() { called("memory:confirm-review:store"); return returnOrThrow(state.memory.confirm); }
};
const memoryReviewStore = {
  pruneExpiredPendingCandidates() { called("memory:review:prune"); },
  listCandidates() { called("memory:list-reviews"); return returnOrThrow(state.review.list); },
  clearPendingCandidates() { called("memory:clear:reviews"); return returnOrThrow(state.review.clear); },
  getCandidate() { called("memory:confirm-review:get"); return returnOrThrow(state.review.candidate); },
  updatePendingCandidate() { called("memory:confirm-review:update"); return returnOrThrow(state.review.update); },
  setStatus(_id, status) { called("memory:review:set:" + status); return returnOrThrow(state.review.setStatus); }
};

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "electron") return electron;
  if (request === "./services/chat/history-store") return { createHistoryStore() { return historyStore; } };
  if (request === "./services/chat/memory-store") return { createMemoryStore() { return memoryStore; } };
  if (request === "./services/chat/memory-review-store") return { createMemoryReviewStore() { return memoryReviewStore; } };
  if (request === "./ipc/trusted-ipc-sender") return { isTrustedIpcSender() { return state.authorized; } };
  if (request === "./windows/chat-window") return { createChatWindow() { return fakeWindow; }, showChatWindow() {}, focusChatInput() {} };
  if (request === "./windows/pet-window") return { createPetWindow() { return fakeWindow; } };
  if (request === "./windows/topmost-policy") return { restorePetWindowOnTop() {} };
  if (request === "./services/pointer-controller") return { createPointerController() { return {
    start() {}, stop() {}, dispose() {}, refreshClickThrough() {}, setLocked() {}, setOverlayHit() {},
    setOverlayHitRegion() {}, setPointerHit() {}, startDrag() {}, moveDrag() {}, endDrag() {}, syncWindowSize() {},
    isDragging() { return false; }
  }; } };
  return originalLoad.call(this, request, parent, isMain);
};

async function main() {
  try {
    require(join(process.cwd(), "dist", "main", "app.js"));
    assert.equal(typeof ready, "function");
    await ready();
    const channels = [
      "history:list", "history:get", "history:delete", "history:clear", "history:get-retention", "history:set-retention",
      "memory:get-settings", "memory:get-summary", "memory:set-enabled", "memory:list", "memory:get", "memory:create",
      "memory:update", "memory:delete", "memory:forget", "memory:clear", "memory:list-suppressions", "memory:allow-suppression",
      "memory:clear-suppressions", "memory:list-reviews", "memory:confirm-review", "memory:reject-review"
    ];
    assert.deepEqual([...handlers.keys()].filter((channel) => channels.includes(channel)), channels);
    assert.equal(channels.length, 22);

    const senderCases = [
      ["history:list", [], "Unauthorized history request"], ["history:get", [historyId], "Invalid history request"],
      ["history:delete", [historyId], false], ["history:clear", [], "Unauthorized history request"],
      ["history:get-retention", [], "Unauthorized history request"], ["history:set-retention", [500], "Invalid history retention request"],
      ["memory:get-settings", [], "Unauthorized memory request"], ["memory:get-summary", [], "Unauthorized memory request"],
      ["memory:set-enabled", [true], "Invalid memory request"], ["memory:list", [], "Unauthorized memory request"],
      ["memory:get", [historyId], "Invalid memory request"], ["memory:create", [{ title: "Title", content: "Content", tags: [], sourceConversationId: historyId }], "Invalid memory request"],
      ["memory:update", [historyId, { title: "Title" }], "Invalid memory request"], ["memory:delete", [historyId], false],
      ["memory:forget", [historyId], { status: "not_found" }], ["memory:clear", [], "Unauthorized memory request"],
      ["memory:list-suppressions", [], "Unauthorized memory request"], ["memory:allow-suppression", [historyId], false],
      ["memory:clear-suppressions", [], "Unauthorized memory request"], ["memory:list-reviews", [], "Unauthorized memory review request"],
      ["memory:confirm-review", [historyId, undefined], { status: "not_found" }], ["memory:reject-review", [historyId], { status: "not_found" }]
    ];
    state.authorized = false;
    for (const [channel, args, expected] of senderCases) {
      clearCalls();
      if (typeof expected === "string") expectError(() => call(channel, ...args), expected);
      else assert.deepEqual(call(channel, ...args), expected);
      assertNoStoreCalls();
    }
    state.authorized = true;

    const invalidRequests = [
      ["history:get", ["not-a-uuid"], "Invalid history request"], ["history:delete", ["not-a-uuid"], false],
      ["history:set-retention", [501], "Invalid history retention request"], ["history:set-retention", [500.5], "Invalid history retention request"], ["history:set-retention", ["500"], "Invalid history retention request"],
      ["memory:set-enabled", ["true"], "Invalid memory request"], ["memory:set-enabled", [1], "Invalid memory request"], ["memory:set-enabled", [null], "Invalid memory request"],
      ["memory:get", ["not-a-uuid"], "Invalid memory request"],
      ["memory:create", [{ title: "", content: "Content", tags: [], sourceConversationId: historyId }], "Invalid memory request"],
      ["memory:create", [{ title: "Title", content: "Content", tags: [], sourceConversationId: historyId, extra: true }], "Invalid memory request"],
      ["memory:update", ["not-a-uuid", { title: "Title" }], "Invalid memory request"],
      ["memory:update", [historyId, {}], "Invalid memory request"], ["memory:delete", ["not-a-uuid"], false],
      ["memory:forget", ["not-a-uuid"], { status: "not_found" }], ["memory:allow-suppression", ["not-a-uuid"], false],
      ["memory:confirm-review", ["not-a-uuid", undefined], { status: "not_found" }],
      ["memory:confirm-review", [historyId, null], { status: "not_found" }], ["memory:reject-review", ["not-a-uuid"], { status: "not_found" }]
    ];
    for (const [channel, args, expected] of invalidRequests) {
      clearCalls();
      if (typeof expected === "string") expectError(() => call(channel, ...args), expected);
      else assert.deepEqual(call(channel, ...args), expected);
      assertNoStoreCalls();
    }

    state.history.list = [summary]; assert.deepEqual(call("history:list"), [summary]);
    state.history.list = [{ ...summary, extra: true }]; expectError(() => call("history:list"), "Invalid history response");
    state.history.get = conversation; assert.deepEqual(call("history:get", historyId), conversation);
    state.history.get = null; assert.equal(call("history:get", historyId), null);
    state.history.get = { id: historyId }; expectError(() => call("history:get", historyId), "Invalid history response");
    for (const value of [true, false]) { state.history.delete = value; assert.equal(call("history:delete", historyId), value); }
    state.history.delete = "true"; expectError(() => call("history:delete", historyId), "Invalid history response");
    state.history.clear = true; assert.equal(call("history:clear"), undefined);
    for (const value of [false, 1, undefined, null, "true", new Error("private history path")]) {
      state.history.clear = value;
      expectError(() => call("history:clear"), "History clear failed");
    }
    for (const value of [100, 500, 1000]) { state.history.retention = value; assert.equal(call("history:get-retention"), value); state.history.setRetention = value; assert.equal(call("history:set-retention", value), value); }
    state.history.retention = 501; expectError(() => call("history:get-retention"), "Invalid history retention response");
    state.history.setRetention = "500"; expectError(() => call("history:set-retention", 500), "Invalid history retention response");

    for (const enabled of [true, false]) { state.memory.settings = { enabled }; assert.deepEqual(call("memory:get-settings"), { enabled }); state.memory.setEnabled = { enabled }; assert.deepEqual(call("memory:set-enabled", enabled), { enabled }); }
    state.memory.settings = { enabled: true, extra: true }; expectError(() => call("memory:get-settings"), "Invalid memory response");
    state.memory.setEnabled = { enabled: "true" }; expectError(() => call("memory:set-enabled", true), "Invalid memory response");
    state.memory.summary = memorySummary; assert.deepEqual(call("memory:get-summary"), memorySummary);
    const nulKey = "work" + String.fromCharCode(0) + "focus";
    assert.equal(nulKey.length, 10);
    assert.equal(nulKey.includes(String.fromCharCode(0)), true);
    for (const key of ["", " language", "Language", "work focus", "x".repeat(33), nulKey, "__proto__"]) {
      const counts = {}; Object.defineProperty(counts, key, { value: 1, enumerable: true });
      state.memory.summary = { ...memorySummary, categoryCounts: counts };
      expectError(() => call("memory:get-summary"), "Invalid memory response");
    }
    state.memory.summary = { ...memorySummary, categoryCounts: { language: -1 } }; expectError(() => call("memory:get-summary"), "Invalid memory response");
    state.memory.list = [card]; assert.deepEqual(call("memory:list"), [card]);
    state.memory.list = [card, { ...card, confidence: 0.901 }]; expectError(() => call("memory:list"), "Invalid memory response");
    state.memory.get = card; assert.deepEqual(call("memory:get", historyId), card); state.memory.get = null; assert.equal(call("memory:get", historyId), null);
    state.memory.get = { id: historyId }; expectError(() => call("memory:get", historyId), "Invalid memory response");
    state.memory.create = { status: "created", card }; assert.deepEqual(call("memory:create", { title: "Title", content: "Content", tags: [], sourceConversationId: historyId }), { status: "created", card });
    state.memory.create = { status: "disabled" }; assert.deepEqual(call("memory:create", { title: "Title", content: "Content", tags: [], sourceConversationId: historyId }), { status: "disabled" });
    state.memory.create = { status: "created", card: { id: historyId } }; expectError(() => call("memory:create", { title: "Title", content: "Content", tags: [], sourceConversationId: historyId }), "Invalid memory response");
    state.memory.update = card; assert.deepEqual(call("memory:update", historyId, { title: "Title" }), card); state.memory.update = null; assert.equal(call("memory:update", historyId, { title: "Title" }), null);
    state.memory.update = { id: historyId }; expectError(() => call("memory:update", historyId, { title: "Title" }), "Invalid memory response");
    for (const value of [true, false]) { state.memory.delete = value; assert.equal(call("memory:delete", historyId), value); state.memory.allow = value; assert.equal(call("memory:allow-suppression", historyId), value); }
    state.memory.delete = {}; expectError(() => call("memory:delete", historyId), "Invalid memory response"); state.memory.allow = 1; expectError(() => call("memory:allow-suppression", historyId), "Invalid memory response");
    for (const status of ["forgotten", "manual", "not_found"]) { state.memory.forget = { status }; assert.deepEqual(call("memory:forget", historyId), { status }); }
    state.memory.forget = { status: "future" }; expectError(() => call("memory:forget", historyId), "Invalid memory response");
    clearCalls(); state.memory.clearCards = 7; state.review.clear = 2; assert.equal(call("memory:clear"), undefined); assert.deepEqual(callSequence, ["memory:clear:cards", "memory:clear:reviews"]);
    state.memory.suppressions = [suppression]; assert.deepEqual(call("memory:list-suppressions"), [suppression]); state.memory.suppressions = [{ ...suppression, extra: true }]; expectError(() => call("memory:list-suppressions"), "Invalid memory response");
    state.memory.clearSuppressions = undefined; assert.equal(call("memory:clear-suppressions"), undefined);
    for (const value of [null, 0, {}]) { state.memory.clearSuppressions = value; expectError(() => call("memory:clear-suppressions"), "Invalid memory response"); }
    state.review.list = [review]; assert.deepEqual(call("memory:list-reviews"), [review]); state.review.list = [{ ...review, confidence: 0.901 }]; expectError(() => call("memory:list-reviews"), "Invalid memory review response");

    state.review.candidate = null; assert.deepEqual(call("memory:confirm-review", historyId, undefined), { status: "not_found" });
    state.review.candidate = { ...review, action: "update-suggestion" }; state.review.setStatus = { ...review, action: "update-suggestion", status: "confirmed" }; assert.deepEqual(call("memory:confirm-review", historyId, undefined), { status: "confirmed" });
    for (const value of [{ ...review, action: "update-suggestion", status: "confirmed", extra: true }, new Error("private")]) { state.review.candidate = { ...review, action: "update-suggestion" }; state.review.setStatus = value; expectError(() => call("memory:confirm-review", historyId, undefined), "Invalid memory review response"); }
    state.review.candidate = review; state.memory.confirm = { status: "created" }; state.review.setStatus = { ...review, status: "confirmed" }; assert.deepEqual(call("memory:confirm-review", historyId, undefined), { status: "confirmed" });
    for (const value of [{ ...review, status: "confirmed", extra: true }, new Error("private")]) { state.review.candidate = review; state.memory.confirm = { status: "created" }; state.review.setStatus = value; expectError(() => call("memory:confirm-review", historyId, undefined), "Invalid memory review response"); }
    state.review.candidate = review; state.memory.confirm = { status: "disabled" }; clearCalls(); assert.deepEqual(call("memory:confirm-review", historyId, undefined), { status: "disabled" }); assert.equal(calls["memory:review:set:confirmed"] || 0, 0);
    state.review.candidate = review; state.memory.confirm = { status: "blocked" }; state.review.setStatus = { ...review, status: "blocked" }; assert.deepEqual(call("memory:confirm-review", historyId, undefined), { status: "blocked" });
    for (const value of [{ ...review, status: "blocked", extra: true }, new Error("private")]) { state.review.candidate = review; state.memory.confirm = { status: "blocked" }; state.review.setStatus = value; expectError(() => call("memory:confirm-review", historyId, undefined), "Invalid memory review response"); }
    for (const value of [{ ...review, extra: true }, { ...review, status: "future" }, new Error("private")]) { state.review.candidate = value; expectError(() => call("memory:confirm-review", historyId, undefined), "Invalid memory review response"); }
    for (const value of [{ status: "future" }, { status: "created", card: { id: historyId } }, { status: "created", extra: true }, new Error("private")]) { state.review.candidate = review; state.memory.confirm = value; expectError(() => call("memory:confirm-review", historyId, undefined), "Invalid memory review response"); }
    state.review.candidate = review; state.memory.confirm = { status: "disabled" }; state.review.update = review; assert.deepEqual(call("memory:confirm-review", historyId, { title: "Updated" }), { status: "disabled" });
    state.review.setStatus = null; assert.deepEqual(call("memory:reject-review", historyId), { status: "not_found" });
    state.review.setStatus = { ...review, status: "rejected" }; assert.deepEqual(call("memory:reject-review", historyId), { status: "rejected" });
    for (const value of [{ ...review, extra: true }, { ...review, status: "future" }, new Error("private")]) { state.review.setStatus = value; expectError(() => call("memory:reject-review", historyId), "Invalid memory review response"); }
  } finally {
    Module._load = originalLoad;
    rmSync(userDataPath, { recursive: true, force: true });
    assert.equal(existsSync(userDataPath), false, "child userData cleanup failed");
  }
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
`;
  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 15_000
  });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

test("history codec accepts exact list/get/null and retention contract", () => {
  assert.deepEqual(parseHistoryConversationList([summary]), [summary]);
  assert.deepEqual(parseHistoryConversation(conversation), conversation);
  assert.equal(parseHistoryConversation(null), null);
  assert.equal(parseHistoryRetentionLimit(500), 500);
});

test("history codec fails closed for root, nested, numeric and retention mutations", () => {
  assert.equal(parseHistoryConversationList([withExtra(summary)]), null);
  assert.equal(parseHistoryConversation({ ...conversation, messages: [withExtra(message)] }), null);
  assert.equal(parseHistoryConversation({ ...conversation, updatedAt: now - 1 }), null);
  assert.equal(parseHistoryConversation({ ...conversation, createdAt: Infinity }), null);
  assert.equal(parseHistoryConversation({ ...conversation, messages: [{ ...message, content: "   " }] }), null);
  for (const invalid of [0, -1, 500.5, "500", NaN, Infinity, 501]) {
    assert.equal(parseHistoryRetentionLimit(invalid), null);
  }
});

test("request codecs close envelopes before scalar normalization", () => {
  assert.deepEqual(parseHistoryIdRequest({ id }), { id });
  assert.deepEqual(parseHistoryRetentionRequest({ limit: 500 }), { limit: 500 });
  assert.deepEqual(parseMemoryEnabledRequest({ enabled: true }), { enabled: true });
  assert.deepEqual(parseMemoryIdRequest({ id }), { id });
  assert.deepEqual(parseMemoryCardDraftRequest({ draft: { title: " Title ", content: " Content ", tags: [" tag "], sourceConversationId: id } }), {
    draft: { title: "Title", content: "Content", tags: ["tag"], sourceConversationId: id }
  });
  assert.deepEqual(parseMemoryCardUpdateRequest({ id, update: { title: " Updated " } }), { id, update: { title: "Updated" } });
  assert.deepEqual(parseMemoryReviewDecisionRequest({ id, update: undefined }), { id, update: undefined });
  assert.equal(parseHistoryIdRequest(withExtra({ id })), null);
  assert.equal(parseMemoryCardDraftRequest({ draft: withExtra({ title: "Title", content: "Content", tags: [], sourceConversationId: id }) }), null);
  assert.equal(parseMemoryCardDraftRequest({ draft: { title: "x".repeat(81), content: "Content", tags: [], sourceConversationId: id } }), null);
  assert.equal(parseMemoryCardDraftRequest({ draft: { title: "Title", content: "Content", tags: ["ok", 1], sourceConversationId: id } }), null);
  assert.equal(parseMemoryCardUpdateRequest({ id, update: {} }), null);
  assert.equal(parseMemoryReviewDecisionRequest({ id, update: null }), null);
});

test("all object seams reject symbol, hidden, accessor and polluted prototypes", () => {
  for (const kind of ["symbol", "hidden", "accessor"] as const) {
    assert.equal(parseMemorySettings(withOwnMutation({ enabled: true }, kind)), null);
  }
  assert.equal(parseMemorySettings(Object.assign(Object.create({ polluted: true }), { enabled: true })), null);
  const nestedMap = Object.assign(Object.create({ polluted: true }), memorySummary.categoryCounts);
  assert.equal(parseMemorySummary({ ...memorySummary, categoryCounts: nestedMap }), null);
  const symbolArray = [card];
  Object.defineProperty(symbolArray, Symbol("extra"), { value: true });
  assert.equal(parseMemoryCards(symbolArray), null);
  const accessorMessage = { ...message };
  let getterCalled = false;
  Object.defineProperty(accessorMessage, "content", { get: () => { getterCalled = true; return "secret"; }, enumerable: true });
  assert.equal(parseHistoryConversation({ ...conversation, messages: [accessorMessage] }), null);
  assert.equal(getterCalled, false);
});

test("main history handlers make shared codec the request and response authority", async () => {
  const appSource = await readFile(join(process.cwd(), "src", "main", "app.ts"), "utf8");
  assert.match(appSource, /from "\.\.\/shared\/memory-history-codec"/u);
  assertOrdered(handlerSource(appSource, "history:list"), ["isChatSender(event)", "historyStore.listConversations()", "parseHistoryConversationList("]);
  assertOrdered(handlerSource(appSource, "history:get"), ["isChatSender(event)", "parseHistoryIdRequest({ id })", "historyStore.getConversation(", "parseNullableHistoryConversation("]);
  assertOrdered(handlerSource(appSource, "history:delete"), ["isChatSender(event)", "parseHistoryIdRequest({ id })", "historyStore.deleteConversation(", "parseBooleanResponse("]);
  const clearHandler = handlerSource(appSource, "history:clear");
  assertOrdered(clearHandler, ["isChatSender(event)", "if (!historyStore)", "historyStore.clearConversations() !== true", "return undefined"]);
  assert.match(clearHandler, /if \(!historyStore\) \{\s+throw new Error\("History clear failed"\);/u);
  assertOrdered(handlerSource(appSource, "history:get-retention"), ["isChatSender(event)", "historyStore.getRetentionLimit()", "parseHistoryRetentionLimit("]);
  assertOrdered(handlerSource(appSource, "history:set-retention"), ["isChatSender(event)", "parseHistoryRetentionRequest({ limit })", "historyStore.setRetentionLimit(", "parseHistoryRetentionLimit("]);
});

test("main memory handlers make shared codec the request and response authority", async () => {
  const appSource = await readFile(join(process.cwd(), "src", "main", "app.ts"), "utf8");
  const memoryRegion = appSource.slice(appSource.indexOf('ipcMain.handle("memory:get-settings"'), appSource.indexOf('ipcMain.handle("automaticSituation:get"'));
  assert.doesNotMatch(memoryRegion, /return response \?\?/u, "malformed store responses must not be downgraded to valid false/not_found results");
  assertOrdered(handlerSource(appSource, "memory:get-settings"), ["isChatSender(event)", "memoryStore.getSettings()", "parseMemorySettings("]);
  assertOrdered(handlerSource(appSource, "memory:get-summary"), ["isChatSender(event)", "memoryStore.getSummary()", "parseMemorySummary("]);
  assertOrdered(handlerSource(appSource, "memory:set-enabled"), ["isChatSender(event)", "parseMemoryEnabledRequest({ enabled })", "memoryStore.setEnabled(", "parseMemorySettings("]);
  assertOrdered(handlerSource(appSource, "memory:list"), ["isChatSender(event)", "memoryStore.listCards()", "parseMemoryCards("]);
  assertOrdered(handlerSource(appSource, "memory:get"), ["isChatSender(event)", "parseMemoryIdRequest({ id })", "memoryStore.getCard(", "parseNullableMemoryCard("]);
  assertOrdered(handlerSource(appSource, "memory:create"), ["isChatSender(event)", "parseMemoryCardDraftRequest({ draft })", "memoryStore.createCard(", "parseMemoryCreateResult("]);
  assertOrdered(handlerSource(appSource, "memory:update"), ["isChatSender(event)", "parseMemoryCardUpdateRequest({ id, update })", "memoryStore.updateCard(", "parseNullableMemoryCard("]);
  assertOrdered(handlerSource(appSource, "memory:delete"), ["isChatSender(event)", "parseMemoryIdRequest({ id })", "memoryStore.deleteCard(", "parseBooleanResponse("]);
  assertOrdered(handlerSource(appSource, "memory:forget"), ["isChatSender(event)", "parseMemoryIdRequest({ id })", "memoryStore.forgetCard(", "parseMemoryForgetResult("]);
  assertOrdered(handlerSource(appSource, "memory:clear"), ["isChatSender(event)", "memoryStore.clearCards()", "memoryReviewStore.clearPendingCandidates()"]);
  assertOrdered(handlerSource(appSource, "memory:list-suppressions"), ["isChatSender(event)", "memoryStore.listSuppressions()", "parseMemorySuppressionViews("]);
  assertOrdered(handlerSource(appSource, "memory:allow-suppression"), ["isChatSender(event)", "parseMemoryIdRequest({ id })", "memoryStore.allowSuppression(", "parseBooleanResponse("]);
  assertOrdered(handlerSource(appSource, "memory:clear-suppressions"), ["isChatSender(event)", "memoryStore.clearSuppressions()", "parseVoidResponse("]);
  assertOrdered(handlerSource(appSource, "memory:list-reviews"), ["isChatSender(event)", "memoryReviewStore.listCandidates()", "parseMemoryReviewCandidates("]);
  assertOrdered(handlerSource(appSource, "memory:confirm-review"), ["isChatSender(event)", "parseMemoryReviewDecisionRequest({ id, update })", "memoryReviewStore.pruneExpiredPendingCandidates()", "memoryStore.confirmReviewedCandidate(", "parseMemoryReviewConfirmationResult(", "parseMemoryReviewDecisionResult("]);
  assertOrdered(handlerSource(appSource, "memory:reject-review"), ["isChatSender(event)", "parseMemoryIdRequest({ id })", "memoryReviewStore.setStatus(", "parseMemoryReviewDecisionResult("]);
});

test("real built main handler matrix exhausts every history and memory channel", async () => {
  const before = new Set((await readdir(tmpdir())).filter((name) => name.startsWith("p2-91c2-main-handlers-")));
  runRegisteredMainHandlerMatrix();
  const after = new Set((await readdir(tmpdir())).filter((name) => name.startsWith("p2-91c2-main-handlers-")));
  assert.deepEqual(after, before, "parent detected child userData residue");
});

test("memory codec accepts exact settings, summary, card, suppression, review and result unions", () => {
  assert.deepEqual(parseMemorySettings({ enabled: true }), { enabled: true });
  assert.deepEqual(parseMemorySummary(memorySummary), memorySummary);
  assert.deepEqual(parseMemoryCard(card), card);
  assert.deepEqual(parseMemoryCards([card]), [card]);
  assert.deepEqual(parseMemorySuppressionView({ id, category: "language", createdAt: now }), { id, category: "language", createdAt: now });
  assert.deepEqual(parseMemoryReviewCandidate(review), review);
  assert.deepEqual(parseMemoryReviewDecisionDraft({ title: "Updated" }), { title: "Updated" });
  assert.deepEqual(parseMemoryCreateResult({ status: "created", card }), { status: "created", card });
  assert.deepEqual(parseMemoryCreateResult({ status: "disabled" }), { status: "disabled" });
  assert.deepEqual(parseMemoryForgetResult({ status: "forgotten" }), { status: "forgotten" });
  assert.deepEqual(parseMemoryReviewDecisionResult({ status: "confirmed" }), { status: "confirmed" });
});

test("memory summary rejects every non-canonical dynamic category key", () => {
  const withCategoryKey = (key: string): Record<string, number> => {
    const counts: Record<string, number> = {};
    Object.defineProperty(counts, key, { value: 1, enumerable: true, writable: true, configurable: true });
    return counts;
  };

  assert.deepEqual(parseMemorySummary(memorySummary), memorySummary);
  for (const key of ["", " language", "language ", "work focus", "Language", "x".repeat(33), "work\u0000focus", "__proto__", "prototype", "constructor"]) {
    assert.equal(parseMemorySummary({ ...memorySummary, categoryCounts: withCategoryKey(key) }), null, `accepted category key ${JSON.stringify(key)}`);
  }
});

test("memory response confidence must already be canonical", () => {
  assert.equal(parseMemoryCard({ ...card, confidence: 0.9 })?.confidence, 0.9);
  assert.equal(parseMemoryReviewCandidate({ ...review, confidence: 0.9 })?.confidence, 0.9);
  assert.equal(parseMemoryCard({ ...card, confidence: 0.901 }), null);
  assert.equal(parseMemoryReviewCandidate({ ...review, confidence: 0.901 }), null);
});

test("memory review confirmation store result is an exact three-branch union", () => {
  assert.deepEqual(parseMemoryReviewConfirmationResult({ status: "created" }), { status: "created" });
  assert.deepEqual(parseMemoryReviewConfirmationResult({ status: "disabled" }), { status: "disabled" });
  assert.deepEqual(parseMemoryReviewConfirmationResult({ status: "blocked" }), { status: "blocked" });
  assert.equal(parseMemoryReviewConfirmationResult({ status: "future" }), null);
  assert.equal(parseMemoryReviewConfirmationResult({ status: "created", extra: true }), null);
  assert.equal(parseMemoryReviewConfirmationResult({ status: "created", card: { id } }), null);
  assert.equal(parseMemoryReviewConfirmationResult(null), null);
});

test("shared memory helpers expose only codec dependencies in active use", async () => {
  const memorySource = await readFile(join(process.cwd(), "src", "shared", "chat-memory.ts"), "utf8");
  for (const name of ["MAX_NAMESPACE_LENGTH", "MAX_KEY_LENGTH", "MAX_CATEGORY_LENGTH"]) {
    assert.doesNotMatch(memorySource, new RegExp(`export const ${name}\\b`, "u"));
  }
  assert.doesNotMatch(memorySource, /export function parsePositiveInteger\b/u);
});

test("memory codec rejects extra, partial, deep, nonfinite and mixed union payloads", () => {
  assert.equal(parseMemorySettings({ enabled: true, extra: true }), null);
  assert.equal(parseMemorySummary({ ...memorySummary, sourceTypeCounts: { ...memorySummary.sourceTypeCounts, extra: 0 } }), null);
  assert.equal(parseMemorySummary({ ...memorySummary, totalCards: Number.MAX_SAFE_INTEGER + 1 }), null);
  assert.equal(parseMemoryCard(withExtra(card)), null);
  assert.equal(parseMemoryCard({ ...card, tags: ["language", 1] }), null);
  assert.equal(parseMemoryCard({ ...card, confidence: NaN }), null);
  assert.equal(parseMemoryCard({ ...card, sourceMessageId: undefined }), null);
  assert.equal(parseMemoryCards([card, withExtra(card)]), null);
  assert.equal(parseMemorySuppressionView({ id, category: "language", createdAt: now, extra: true }), null);
  assert.equal(parseMemoryReviewCandidate({ ...review, tags: [{ value: "language" }] }), null);
  assert.equal(parseMemoryReviewDecisionDraft({}), null);
  assert.equal(parseMemoryReviewDecisionDraft({ title: "Updated", unknown: true }), null);
  assert.equal(parseMemoryCreateResult({ status: "disabled", card }), null);
  assert.equal(parseMemoryForgetResult({ status: "forgotten", reason: "extra" }), null);
  assert.equal(parseMemoryReviewDecisionResult({ status: "confirmed", card }), null);
  assert.deepEqual(parseNullableHistoryConversation(null), { value: null });
  assert.equal(parseNullableHistoryConversation(undefined), null);
  assert.equal(parseNullableHistoryConversation({ id }), null);
  assert.deepEqual(parseNullableMemoryCard(null), { value: null });
  assert.equal(parseNullableMemoryCard(undefined), null);
  assert.equal(parseNullableMemoryCard({ id }), null);
  assert.equal(parseMemorySuppressionViews([{ id, category: "language", createdAt: now }, { id: id2 }]), null);
  assert.equal(parseMemoryReviewCandidates([review, withExtra(review)]), null);
  for (const invalid of [NaN, Infinity, -Infinity, 0.5, -1, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(parseMemorySummary({ ...memorySummary, totalCards: invalid }), null);
    assert.equal(parseMemoryCard({ ...card, observedCount: invalid }), null);
    assert.equal(parseMemoryReviewCandidate({ ...review, createdAt: invalid }), null);
  }
});
