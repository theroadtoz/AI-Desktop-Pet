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
  assert.match(preload, /const defaultEnvironmentActionSettings = \{\s*basicEnabled: true,\s*musicEnabled: true,\s*gameEnabled: true\s*\}/);
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
