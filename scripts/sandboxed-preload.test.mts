import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

test("sandboxed chat preload has no relative runtime dependencies", async () => {
  const preload = await readFile(join(process.cwd(), "dist", "preload", "chat-preload.js"), "utf8");

  assert.match(preload, /exposeInMainWorld\("configApi", configApi\)/);
  assert.match(preload, /exposeInMainWorld\("historyApi", historyApi\)/);
  assert.match(preload, /exposeInMainWorld\("petPresentationApi", petPresentationApi\)/);
  assert.match(preload, /exposeInMainWorld\("userProfileApi", userProfileApi\)/);
  assert.doesNotMatch(preload, /require\(["']\.\.\/shared\//);
});

test("sandboxed pet preload has no relative runtime dependencies", async () => {
  const preload = await readFile(join(process.cwd(), "dist", "preload", "pet-preload.js"), "utf8");

  assert.match(preload, /exposeInMainWorld\("petApi", api\)/);
  assert.doesNotMatch(preload, /require\(["']\.\.\/shared\//);
});
