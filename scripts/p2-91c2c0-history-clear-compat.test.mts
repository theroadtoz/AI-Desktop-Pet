import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const SAFE_CHILD_FAILURE = "History clear compatibility probe failed";
const FIXTURE_UUID = "11111111-1111-4111-8111-111111111111";

function handlerSource(appSource: string, channel: string): string {
  const start = appSource.indexOf(`ipcMain.handle("${channel}"`);
  assert.notEqual(start, -1, `missing handler ${channel}`);
  const next = appSource.indexOf("ipcMain.handle(", start + 16);
  return appSource.slice(start, next === -1 ? undefined : next);
}

function expectSafeProbeFailure(result: ReturnType<typeof spawnSync>): void {
  if (result.error || result.status !== 0) {
    throw new Error(SAFE_CHILD_FAILURE);
  }
}

function runSafeChildFixture(mode: "success" | "exit" | "timeout" | "error"): { status: "ok" | "failed"; message?: string; cleaned: boolean } {
  const root = mkdtempSync(join(tmpdir(), "p2-91c2c0-fixture-"));
  const secretPath = join(root, "private-conversations.json");
  const fixtureScript = mode === "success"
    ? "process.exit(0);"
    : mode === "exit"
      ? `process.stdout.write(${JSON.stringify(secretPath + " " + FIXTURE_UUID)}); process.stderr.write(${JSON.stringify(secretPath)}); process.exit(7);`
      : mode === "timeout"
        ? "setInterval(() => {}, 1000);"
        : undefined;
  let result: ReturnType<typeof spawnSync>;
  try {
    result = mode === "error"
      ? spawnSync(join(root, "missing-child.exe"), [], { cwd: process.cwd(), encoding: "utf8", timeout: 100, maxBuffer: 1024 })
      : spawnSync(process.execPath, ["-e", fixtureScript!], { cwd: process.cwd(), encoding: "utf8", timeout: 100, maxBuffer: 1024 });
  } catch {
    result = { status: null, signal: null, output: [], pid: undefined, stdout: "", stderr: "", error: new Error("spawn failed") } as ReturnType<typeof spawnSync>;
  } finally {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      throw new Error("History clear compatibility cleanup failed");
    }
  }
  const cleaned = !existsSync(root);
  if (result.error || result.status !== 0) {
    const outcome = { status: "failed" as const, message: SAFE_CHILD_FAILURE, cleaned };
    assert.doesNotMatch(JSON.stringify(outcome), /private-conversations\.json|11111111-1111-4111-8111-111111111111/u);
    return outcome;
  }
  return { status: "ok", cleaned };
}

function runMainHandlerProbe(missingStore: boolean): void {
  const userDataPath = mkdtempSync(join(tmpdir(), "p2-91c2c0-main-"));
  const script = String.raw`
const assert = require("node:assert/strict");
const Module = require("node:module");
const { join } = require("node:path");

const userDataPath = process.env.P2_91C2C0_USER_DATA;
const missingStore = process.env.P2_91C2C0_MISSING_STORE === "1";
const handlers = new Map();
const state = { authorized: true, clear: true, calls: 0 };
let ready;

function expectFixedFailure(run) {
  assert.throws(run, (error) => error instanceof Error && error.message === "History clear failed");
}

const fakeWebContents = {
  send() {}, on() {}, once() {}, setWindowOpenHandler() {}, openDevTools() {},
  session: { webRequest: { onHeadersReceived() {} }, setPermissionRequestHandler() {}, setPermissionCheckHandler() {} },
  isDestroyed() { return false; }, getURL() { return "file:///chat/index.html"; }, mainFrame: null
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
  BrowserWindow: class { static getAllWindows() { return []; } static fromWebContents() { return fakeWindow; } },
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
  listConversations() { return []; }, getConversation() { return null; }, deleteConversation() { return false; },
  clearConversations() { state.calls += 1; if (state.clear instanceof Error) throw state.clear; return state.clear; },
  getRetentionLimit() { return 500; }, setRetentionLimit() { return 500; }
};
const memoryStore = {
  getSettings() { return { enabled: true }; }, getSummary() { return { enabled: true, totalCards: 0, enabledCards: 0, disabledCards: 0, injectableCount: 0, injectionBudget: 4, compressionThreshold: 12, sourceTypeCounts: { "manual-chat": 0, "auto-local-heuristic": 0, "auto-local-model": 0 }, importanceCounts: { key: 0, general: 0 }, compressionStateCounts: { raw: 0, merged: 0, deduplicated: 0, budgeted: 0 }, categoryCounts: {} }; },
  setEnabled() { return { enabled: true }; }, listCards() { return []; }, getCard() { return null; }, createCard() { return { status: "disabled" }; }, updateCard() { return null; }, deleteCard() { return false; }, forgetCard() { return { status: "not_found" }; }, clearCards() {}, listSuppressions() { return []; }, allowSuppression() { return false; }, clearSuppressions() {}, getInjectionContext() { return null; }, captureAutoMemoriesFromLatestUserMessage() { return { enabled: false, capturedCount: 0, safeCategories: [] }; }, confirmReviewedCandidate() { return { status: "not_found" }; }
};
const memoryReviewStore = { pruneExpiredPendingCandidates() {}, listCandidates() { return []; }, clearPendingCandidates() {}, getCandidate() { return null; }, updatePendingCandidate() { return null; }, setStatus() { return null; } };
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "electron") return electron;
  if (request === "./services/chat/history-store") return { createHistoryStore() { return missingStore ? null : historyStore; } };
  if (request === "./services/chat/memory-store") return { createMemoryStore() { return memoryStore; } };
  if (request === "./services/chat/memory-review-store") return { createMemoryReviewStore() { return memoryReviewStore; } };
  if (request === "./ipc/trusted-ipc-sender") return { isTrustedIpcSender() { return state.authorized; } };
  if (request === "./windows/chat-window") return { createChatWindow() { return fakeWindow; }, showChatWindow() {}, focusChatInput() {} };
  if (request === "./windows/pet-window") return { createPetWindow() { return fakeWindow; } };
  if (request === "./windows/topmost-policy") return { restorePetWindowOnTop() {} };
  if (request === "./services/pointer-controller") return { createPointerController() { return { start() {}, stop() {}, dispose() {}, refreshClickThrough() {}, setLocked() {}, setOverlayHit() {}, setOverlayHitRegion() {}, setPointerHit() {}, startDrag() {}, moveDrag() {}, endDrag() {}, syncWindowSize() {}, isDragging() { return false; } }; } };
  return originalLoad.call(this, request, parent, isMain);
};

function call() { return handlers.get("history:clear")({}); }

(async () => {
  require(join(process.cwd(), "dist", "main", "app.js"));
  assert.equal(typeof ready, "function");
  await ready();
  assert.equal(handlers.has("history:clear"), true);
  state.authorized = false; state.calls = 0;
  assert.throws(call, (error) => error instanceof Error && error.message === "Unauthorized history request");
  assert.equal(state.calls, 0);
  state.authorized = true;
  if (missingStore) {
    expectFixedFailure(call);
    assert.equal(state.calls, 0);
  } else {
    state.clear = true; state.calls = 0;
    assert.equal(call(), undefined);
    assert.equal(state.calls, 1);
    for (const value of [false, 1, undefined, null, "true", {}]) {
      state.clear = value; state.calls = 0;
      expectFixedFailure(call);
      assert.equal(state.calls, 1);
    }
    state.clear = new Error("private path C:\\secret\\conversations.json id 11111111-1111-4111-8111-111111111111"); state.calls = 0;
    expectFixedFailure(call);
    assert.equal(state.calls, 1);
  }
})().then(() => process.exit(0), () => { process.stderr.write("History clear compatibility probe failed\n"); process.exit(1); });
`;
  let result: ReturnType<typeof spawnSync>;
  try {
    result = spawnSync(process.execPath, ["-e", script], {
      cwd: process.cwd(),
      env: { ...process.env, P2_91C2C0_USER_DATA: userDataPath, P2_91C2C0_MISSING_STORE: missingStore ? "1" : "0" },
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 16 * 1024
    });
  } finally {
    try {
      rmSync(userDataPath, { recursive: true, force: true });
    } catch {
      throw new Error("History clear compatibility cleanup failed");
    }
  }
  if (existsSync(userDataPath)) {
    throw new Error("History clear compatibility cleanup failed");
  }
  expectSafeProbeFailure(result);
}

function loadBundledHistoryApi(preloadSource: string): { clearConversations(): Promise<void>; setMode(mode: "success" | "reject" | "forged"): void } {
  let mode: "success" | "reject" | "forged" = "success";
  let historyApi: { clearConversations(): Promise<void> } | undefined;
  const contextBridge = {
    exposeInMainWorld(name: string, value: unknown) {
      if (name === "historyApi") historyApi = value as typeof historyApi;
    }
  };
  const ipcRenderer = {
    invoke(channel: string) {
      assert.equal(channel, "history:clear");
      if (mode === "reject") return Promise.reject(new Error("History clear failed"));
      return Promise.resolve(mode === "forged" ? false : undefined);
    },
    on() {},
    removeListener() {}
  };
  const module = { exports: {} };
  new Function("require", "exports", "module", preloadSource)(
    (id: string) => {
      assert.equal(id, "electron");
      return { contextBridge, ipcRenderer };
    },
    module.exports,
    module
  );
  assert.ok(historyApi);
  return {
    clearConversations: historyApi.clearConversations,
    setMode(nextMode) { mode = nextMode; }
  };
}

function rendererClearListenerSource(rendererSource: string): string {
  const start = rendererSource.indexOf('confirmClearHistoryAction.addEventListener("click", () => {');
  const end = rendererSource.indexOf('cancelMemoryDraftAction.addEventListener("click"', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  return rendererSource.slice(start, end);
}

async function runRendererRejectProbe(listenerSource: string): Promise<{ selectedId: string; conversationId: string; providerContextEnabled: boolean; resetCalls: number; sessionNotes: number; successFeedback: number; errorFeedback: number }> {
  const successFeedbackMarker = listenerSource.match(/setHistoryFeedback\("([^"]+)"\)/u)?.[1];
  assert.ok(successFeedbackMarker);
  const createHarness = new Function("windowRef", "successFeedbackMarker", `
    let listener;
    let selectedHistoryConversation = { id: "selected" };
    let conversationId = "before-conversation";
    let providerContextEnabled = false;
    let resetCalls = 0;
    let sessionNotes = 0;
    let successFeedback = 0;
    let errorFeedback = 0;
    let settledResolve;
    const settled = new Promise((resolve) => { settledResolve = resolve; });
    const chatTurnState = { isReplying: false };
    const clearHistoryConfirmationBox = { hidden: false };
    const confirmClearHistoryAction = { addEventListener(_type, callback) { listener = callback; } };
    const window = windowRef;
    function resetCurrentConversation() { resetCalls += 1; conversationId = "after-conversation"; providerContextEnabled = true; }
    function renderHistoryDetail() {}
    function setHistoryFeedback(message) { if (message === successFeedbackMarker) successFeedback += 1; else errorFeedback += 1; settledResolve(); }
    function setChatSessionNote() { sessionNotes += 1; }
    async function refreshHistoryList() {}
    ${listenerSource}
    return { click: () => listener(), wait: () => settled, snapshot: () => ({ selectedId: selectedHistoryConversation?.id ?? null, conversationId, providerContextEnabled, resetCalls, sessionNotes, successFeedback, errorFeedback }) };
  `);
  const historyApi = { clearConversations: async () => { throw new Error("History clear failed"); } };
  const harness = createHarness({ historyApi }, successFeedbackMarker) as { click(): void; wait(): Promise<void>; snapshot(): { selectedId: string; conversationId: string; providerContextEnabled: boolean; resetCalls: number; sessionNotes: number; successFeedback: number; errorFeedback: number } };
  harness.click();
  await harness.wait();
  return harness.snapshot();
}

test("history clear main IPC is strict void and fails closed", async () => {
  const appSource = await readFile(join(process.cwd(), "src", "main", "app.ts"), "utf8");
  const handler = handlerSource(appSource, "history:clear");
  assert.match(handler, /if \(!isChatSender\(event\)\)/u);
  assert.match(handler, /if \(!historyStore\)/u);
  assert.match(handler, /historyStore\.clearConversations\(\) !== true/u);
  assert.match(handler, /return undefined;/u);
  runMainHandlerProbe(false);
  runMainHandlerProbe(true);
});

test("focused child harness bounds exit, timeout and spawn-error paths without leaking output", () => {
  for (const mode of ["success", "exit", "timeout", "error"] as const) {
    const outcome = runSafeChildFixture(mode);
    assert.equal(outcome.cleaned, true);
    if (mode === "success") {
      assert.deepEqual(outcome, { status: "ok", cleaned: true });
    } else {
      assert.deepEqual(outcome, { status: "failed", message: SAFE_CHILD_FAILURE, cleaned: true });
    }
  }
});

test("bundled history preload preserves fulfilled void and rejection behavior", async () => {
  const preloadSource = await readFile(join(process.cwd(), "dist", "preload", "chat-preload.js"), "utf8");
  const api = loadBundledHistoryApi(preloadSource);
  assert.equal(await api.clearConversations(), undefined);
  api.setMode("reject");
  await assert.rejects(api.clearConversations(), { message: "History clear failed" });
  api.setMode("forged");
  await assert.rejects(api.clearConversations(), { message: "History clear rejected" });
});

test("renderer observes clear rejection without resetting current/provider state", async () => {
  const [rendererSource, preloadSource, contractSource] = await Promise.all([
    readFile(join(process.cwd(), "src", "renderer", "chat", "main.ts"), "utf8"),
    readFile(join(process.cwd(), "src", "preload", "chat-preload.ts"), "utf8"),
    readFile(join(process.cwd(), "src", "shared", "ipc-contract.ts"), "utf8")
  ]);
  const snapshot = await runRendererRejectProbe(rendererClearListenerSource(rendererSource));
  assert.deepEqual(snapshot, { selectedId: "selected", conversationId: "before-conversation", providerContextEnabled: false, resetCalls: 0, sessionNotes: 0, successFeedback: 0, errorFeedback: 1 });
  assert.match(rendererSource, /function resetCurrentConversation\(\): void/u);
  assert.match(rendererSource, /providerContextEnabled = true;/u);
  assert.match(preloadSource, /ipcRenderer\.invoke\("history:clear"\)/u);
  assert.match(contractSource, /clearConversations\(\): Promise<void>/u);
});
