import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

test("sandboxed chat preload has no relative runtime dependencies", async () => {
  const preload = await readFile(join(process.cwd(), "dist", "preload", "chat-preload.js"), "utf8");

  assert.match(preload, /exposeInMainWorld\("configApi", configApi\)/);
  assert.match(preload, /exposeInMainWorld\("historyApi", historyApi\)/);
  assert.match(preload, /exposeInMainWorld\("petPresentationApi", petPresentationApi\)/);
  assert.match(preload, /exposeInMainWorld\("proactiveCompanionApi", proactiveCompanionApi\)/);
  assert.match(preload, /exposeInMainWorld\("environmentActionApi", environmentActionApi\)/);
  assert.match(preload, /exposeInMainWorld\("userProfileApi", userProfileApi\)/);
  assert.match(preload, /const defaultEnvironmentActionSettings = \{\s*basicEnabled: true,\s*musicEnabled: true,\s*explicitGameContextEnabled: true\s*\}/);
  assert.doesNotMatch(preload, /gameEnabled/);
  assert.match(preload, /getStatus\(\) \{\s*return parseEnvironmentActionRuntimeStatus/);
  assert.match(preload, /hasExactKeys\(status, \["providerStatus", "monitorStatus", "mediaCapability", "gameCapability"\]\)/);
  assert.doesNotMatch(preload, /require\(["']\.{1,2}\//);
  assert.doesNotMatch(preload, /import\(["']\.{1,2}\//);
});

test("environment action status parser rejects extra fields", async () => {
  const preload = await readFile(join(process.cwd(), "dist", "preload", "chat-preload.js"), "utf8");
  let status: unknown = {
    providerStatus: "available",
    monitorStatus: "polling",
    mediaCapability: "available",
    gameCapability: "unavailable"
  };
  let environmentActionApi: { getStatus(): Promise<unknown> } | undefined;
  const contextBridge = {
    exposeInMainWorld(name: string, value: unknown) {
      if (name === "environmentActionApi") {
        environmentActionApi = value as { getStatus(): Promise<unknown> };
      }
    }
  };
  const ipcRenderer = {
    invoke(channel: string) {
      assert.equal(channel, "environmentActions:get-status");
      return Promise.resolve(status);
    },
    on() {},
    removeListener() {}
  };
  const module = { exports: {} };
  new Function("require", "exports", "module", preload)(
    (id: string) => {
      assert.equal(id, "electron");
      return { contextBridge, ipcRenderer };
    },
    module.exports,
    module
  );

  assert.ok(environmentActionApi);
  assert.deepEqual(await environmentActionApi.getStatus(), status);
  status = { ...(status as Record<string, unknown>), activity: "active" };
  assert.deepEqual(await environmentActionApi.getStatus(), {
    providerStatus: "unknown",
    monitorStatus: "stopped",
    mediaCapability: "unknown",
    gameCapability: "unknown"
  });
});

test("sandboxed pet preload has no relative runtime dependencies", async () => {
  const preload = await readFile(join(process.cwd(), "dist", "preload", "pet-preload.js"), "utf8");

  assert.match(preload, /exposeInMainWorld\("petApi", api\)/);
  assert.doesNotMatch(preload, /require\(["']\.{1,2}\//);
  assert.doesNotMatch(preload, /import\(["']\.{1,2}\//);
});

test("sandboxed pet preload exposes petApi and authenticates action trigger origin locally", async () => {
  const preload = await readFile(join(process.cwd(), "dist", "preload", "pet-preload.js"), "utf8");
  const listeners = new Map<string, (...args: unknown[]) => void>();
  const received: unknown[] = [];
  let petApi: { onActionTrigger(handler: (trigger: unknown) => void): () => void } | undefined;
  const contextBridge = {
    exposeInMainWorld(name: string, value: unknown) {
      if (name === "petApi") petApi = value as typeof petApi;
    }
  };
  const ipcRenderer = {
    send() {},
    invoke() { return Promise.resolve(null); },
    on(channel: string, listener: (...args: unknown[]) => void) { listeners.set(channel, listener); },
    removeListener(channel: string) { listeners.delete(channel); }
  };
  const module = { exports: {} };
  new Function("require", "exports", "module", preload)(
    (id: string) => {
      assert.equal(id, "electron");
      return { contextBridge, ipcRenderer };
    },
    module.exports,
    module
  );

  assert.ok(petApi);
  petApi.onActionTrigger((trigger) => received.push(trigger));
  const listener = listeners.get("pet:action-trigger");
  assert.ok(listener);
  listener({}, {
    reason: "chat_opened",
    requestId: "request_chat_1",
    supersessionPolicy: "replace_active"
  });
  listener({}, {
    reason: "chat_opened",
    requestId: "request_forged",
    supersessionPolicy: "replace_active",
    origin: "main_dispatch"
  });
  listener({}, {
    reason: "state_work",
    requestId: "request_work_1",
    supersessionPolicy: "replace_active"
  });

  assert.deepEqual(received, [{
    reason: "chat_opened",
    requestId: "request_chat_1",
    supersessionPolicy: "replace_active",
    origin: "main_dispatch"
  }]);
});

test("pet preload sends only finite nonnegative exact overlay regions", async () => {
  const preload = await readFile(join(process.cwd(), "dist", "preload", "pet-preload.js"), "utf8");
  const sends: unknown[][] = [];
  let petApi: { setBubbleHitRegion(value: unknown): void } | undefined;
  const contextBridge = {
    exposeInMainWorld(name: string, value: unknown) {
      if (name === "petApi") petApi = value as typeof petApi;
    }
  };
  const ipcRenderer = {
    send(...args: unknown[]) { sends.push(args); },
    invoke() { return Promise.resolve(null); },
    on() {},
    removeListener() {}
  };
  const module = { exports: {} };
  new Function("require", "exports", "module", preload)(
    (id: string) => {
      assert.equal(id, "electron");
      return { contextBridge, ipcRenderer };
    },
    module.exports,
    module
  );

  assert.ok(petApi);
  petApi.setBubbleHitRegion({ left: 1, top: 2, right: 30, bottom: 40 });
  petApi.setBubbleHitRegion({ left: -1, top: 2, right: 30, bottom: 40 });
  petApi.setBubbleHitRegion({ left: 1, top: 2, right: 30, bottom: 40, text: "private" });
  petApi.setBubbleHitRegion(null);
  assert.deepEqual(sends, [
    ["pet:bubble-hit-region-change", { left: 1, top: 2, right: 30, bottom: 40 }],
    ["pet:bubble-hit-region-change", null]
  ]);
});
