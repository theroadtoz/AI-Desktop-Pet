import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import test from "node:test";
import { buildChatPreload } from "./build-chat-preload.mjs";

async function createChatPreloadFixture() {
  const root = await mkdtemp(join(tmpdir(), "chat preload fixture "));
  await Promise.all(["preload", "shared"].map((directory) => cp(
    join(process.cwd(), "src", directory),
    join(root, "src", directory),
    { recursive: true }
  )));
  return root;
}

async function assertNoChatPreloadTemporaryFiles(root: string) {
  const outdir = join(root, "dist", "preload");
  if (!existsSync(outdir)) return;
  assert.deepEqual((await readdir(outdir)).filter((name) => name.startsWith(".chat-preload-") || name.endsWith(".map")), []);
}

test("chat preload helper bundles a no-node_modules absolute fixture with a stable closed artifact", async () => {
  const root = await createChatPreloadFixture();
  try {
    assert.equal(isAbsolute(root), true);
    assert.match(root, / /u);
    assert.equal(existsSync(join(root, "node_modules")), false);
    const first = await buildChatPreload(["--root", root]);
    const second = await buildChatPreload(["--root", root]);
    const output = await readFile(second.outfile, "utf8");

    assert.equal(first.sha256, second.sha256);
    assert.deepEqual([...output.matchAll(/\brequire\((['"])([^'"]+)\1\)/gu)].map((match) => match[2]), ["electron"]);
    assert.doesNotMatch(output, /\b(?:require|__require)\((?!['"])/u);
    assert.doesNotMatch(output, /\bimport\s*\(|\bnode:|file:\/\/|sourceMappingURL/u);
    assert.doesNotMatch(output, new RegExp(root.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
    assert.equal(existsSync(`${second.outfile}.map`), false);
    await assertNoChatPreloadTemporaryFiles(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("chat preload helper rejects invalid roots and fail-closes stale or invalid fixture outputs", async () => {
  await assert.rejects(buildChatPreload(["--root", "relative-root"]), /invalid-chat-preload-root/u);
  const root = await createChatPreloadFixture();
  const entry = join(root, "src", "preload", "chat-preload.ts");
  const outfile = join(root, "dist", "preload", "chat-preload.js");
  try {
    await mkdir(join(root, "dist", "preload"), { recursive: true });
    await writeFile(outfile, 'module.exports = require("../shared/memory-history-codec");\n');
    await rm(entry, { force: true });
    await assert.rejects(buildChatPreload(["--root", root]));
    assert.equal(existsSync(outfile), false);
    await assertNoChatPreloadTemporaryFiles(root);

    await writeFile(entry, 'import { readFileSync } from "node:fs"; console.log(readFileSync);\n');
    await writeFile(outfile, 'module.exports = require("../shared/memory-history-codec");\n');
    await assert.rejects(buildChatPreload(["--root", root]), /invalid-chat-preload-runtime-surface/u);
    assert.equal(existsSync(outfile), false);
    await assertNoChatPreloadTemporaryFiles(root);

    await writeFile(entry, 'const name = globalThis["moduleName"]; require(name);\n');
    await writeFile(outfile, 'module.exports = require("../shared/memory-history-codec");\n');
    await assert.rejects(buildChatPreload(["--root", root]), /invalid-chat-preload-requires/u);
    assert.equal(existsSync(outfile), false);
    await assertNoChatPreloadTemporaryFiles(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("sandboxed chat preload has no relative runtime dependencies", async () => {
  const preload = await readFile(join(process.cwd(), "dist", "preload", "chat-preload.js"), "utf8");

  assert.match(preload, /exposeInMainWorld\("configApi", configApi\)/);
  assert.match(preload, /exposeInMainWorld\("historyApi", historyApi\)/);
  assert.match(preload, /exposeInMainWorld\("petPresentationApi", petPresentationApi\)/);
  assert.match(preload, /exposeInMainWorld\("proactiveCompanionApi", proactiveCompanionApi\)/);
  assert.match(preload, /exposeInMainWorld\("environmentActionApi", environmentActionApi\)/);
  assert.match(preload, /exposeInMainWorld\("userProfileApi", userProfileApi\)/);
  assert.match(preload, /(?:const|var) defaultEnvironmentActionSettings = \{\s*basicEnabled: true,\s*musicEnabled: true,\s*explicitGameContextEnabled: true\s*\}/);
  assert.doesNotMatch(preload, /gameEnabled/);
  assert.match(preload, /async getStatus\(\) \{\s*return parseEnvironmentActionRuntimeStatus/);
  assert.match(preload, /hasExactKeys\d*\(status, \["providerStatus", "monitorStatus", "mediaCapability", "gameCapability"\]\)/);
  assert.doesNotMatch(preload, /require\(["']\.{1,2}\//);
  assert.doesNotMatch(preload, /import\(["']\.{1,2}\//);
});

test("sandboxed chat preload is a closed single-file Electron bundle", async () => {
  const preload = await readFile(join(process.cwd(), "dist", "preload", "chat-preload.js"), "utf8");
  const requires = [...preload.matchAll(/\brequire\((['"])([^'"]+)\1\)/gu)].map((match) => match[2]);

  assert.deepEqual(requires, ["electron"]);
  assert.doesNotMatch(preload, /\brequire\((?!['"])/u);
  assert.doesNotMatch(preload, /\bimport\s*\(/u);
  assert.doesNotMatch(preload, /\bnode:|file:\/\/|sourceMappingURL/u);
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

test("memory review preload keeps strict candidate and decision boundaries", async () => {
  const preload = await readFile(join(process.cwd(), "dist", "preload", "chat-preload.js"), "utf8");
  let memoryApi: {
    listReviews(): Promise<unknown>;
    confirmReview(id: string, update?: unknown): Promise<{ status: string }>;
  } | undefined;
  let invokeCount = 0;
  const contextBridge = {
    exposeInMainWorld(name: string, value: unknown) {
      if (name === "memoryApi") memoryApi = value as typeof memoryApi;
    }
  };
  const ipcRenderer = {
    invoke(channel: string) {
      invokeCount += 1;
      assert.equal(channel, "memory:list-reviews");
      return Promise.resolve([{
        id: crypto.randomUUID(),
        action: "create",
        status: "pending-review",
        title: "候选",
        content: "本地候选",
        tags: [],
        namespace: "personal",
        key: "language-preference",
        importance: "key",
        category: "language",
        confidence: 0.91,
        sourceConversationId: crypto.randomUUID(),
        sourceMessageId: crypto.randomUUID(),
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_000_000,
        extra: true
      }]);
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

  assert.ok(memoryApi);
  await assert.rejects(memoryApi.listReviews(), /Invalid memory review response/);
  assert.equal(invokeCount, 1);
  const result = await memoryApi.confirmReview("not-a-uuid", { content: "ignored" });
  assert.deepEqual(result, { status: "not_found" });
  assert.equal(invokeCount, 1);
});

test("memory clear preload APIs reject forged non-undefined responses", async () => {
  const preload = await readFile(join(process.cwd(), "dist", "preload", "chat-preload.js"), "utf8");
  let memoryApi: { clearCards(): Promise<void>; clearSuppressions(): Promise<void> } | undefined;
  const contextBridge = {
    exposeInMainWorld(name: string, value: unknown) {
      if (name === "memoryApi") memoryApi = value as typeof memoryApi;
    }
  };
  const ipcRenderer = {
    invoke(channel: string) {
      assert.ok(["memory:clear", "memory:clear-suppressions"].includes(channel));
      return Promise.resolve({ forged: true });
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

  assert.ok(memoryApi);
  await assert.rejects(memoryApi.clearCards(), /Invalid memory response/u);
  await assert.rejects(memoryApi.clearSuppressions(), /Invalid memory response/u);
});
