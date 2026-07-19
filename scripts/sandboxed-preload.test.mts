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
  assert.match(preload, /const defaultEnvironmentActionSettings = \{\s*musicEnabled: true,\s*gameEnabled: true\s*\}/);
  assert.match(preload, /getStatus\(\) \{\s*return parseEnvironmentActionRuntimeStatus/);
  assert.doesNotMatch(preload, /require\(["']\.{1,2}\//);
  assert.doesNotMatch(preload, /import\(["']\.{1,2}\//);
});

test("sandboxed pet preload has no relative runtime dependencies", async () => {
  const preload = await readFile(join(process.cwd(), "dist", "preload", "pet-preload.js"), "utf8");

  assert.match(preload, /exposeInMainWorld\("petApi", api\)/);
  assert.doesNotMatch(preload, /require\(["']\.{1,2}\//);
  assert.doesNotMatch(preload, /import\(["']\.{1,2}\//);
});
