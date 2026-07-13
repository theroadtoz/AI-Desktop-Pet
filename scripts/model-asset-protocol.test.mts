import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

const require = createRequire(import.meta.url);
const { handleModelAssetRequest, resolveModelAssetPath, resolveModelAssetUrl } = require("../dist/main/services/model-asset-protocol.js") as {
  handleModelAssetRequest(request: Request): Promise<Response>;
  resolveModelAssetPath(manifest: {
    sourceRoot: string;
    managedMotionRoot: string;
    sourceRelativePaths: ReadonlySet<string>;
    managedMotionRelativePaths: ReadonlySet<string>;
  }, relativePath: string): Promise<string | null>;
  resolveModelAssetUrl(modelId: string, relativePath: string): string;
};

test("pet-model reads a registered motion preset from the managed manifest motion root", async () => {
  const response = await handleModelAssetRequest(
    new Request("pet-model://witch/motions/yawn-once.motion3.json")
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json");
  assert.deepEqual(
    Buffer.from(await response.arrayBuffer()),
    readFileSync("resources/models/witch/motions/yawn-once.motion3.json")
  );
});

test("pet-model reads registered core resources from sourceDir only", async () => {
  const response = await handleModelAssetRequest(
    new Request(resolveModelAssetUrl("witch", "魔女.model3.json"))
  );

  assert.equal(response.status, 200);
  assert.deepEqual(
    Buffer.from(await response.arrayBuffer()),
    readFileSync("model/魔女.model3.json")
  );
});

test("pet-model denies unregistered assets and ambiguous manifest paths", async () => {
  const response = await handleModelAssetRequest(
    new Request("pet-model://witch/motions/not-registered.motion3.json")
  );

  assert.equal(response.status, 403);
  assert.equal(await resolveModelAssetPath({
    sourceRoot: "model",
    managedMotionRoot: "resources/models/witch",
    sourceRelativePaths: new Set(["motions/yawn-once.motion3.json"]),
    managedMotionRelativePaths: new Set(["motions/yawn-once.motion3.json"])
  }, "motions/yawn-once.motion3.json"), null);
});

test("pet-model rejects registered symlinks that escape the managed motion root", async (t) => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "pet-model-protocol-"));
  const managedMotionRoot = join(fixtureRoot, "managed");
  const outsideMotionRoot = join(fixtureRoot, "outside");
  const outsideMotionPath = join(outsideMotionRoot, "escape.motion3.json");
  const linkedMotionRoot = join(managedMotionRoot, "motions");

  t.after(() => rmSync(fixtureRoot, { recursive: true, force: true }));
  mkdirSync(managedMotionRoot, { recursive: true });
  mkdirSync(outsideMotionRoot, { recursive: true });
  writeFileSync(outsideMotionPath, "{}");
  symlinkSync(outsideMotionRoot, linkedMotionRoot, "junction");

  assert.equal(await resolveModelAssetPath({
    sourceRoot: join(fixtureRoot, "source"),
    managedMotionRoot,
    sourceRelativePaths: new Set(),
    managedMotionRelativePaths: new Set(["motions/escape.motion3.json"])
  }, "motions/escape.motion3.json"), null);
});

test("pet-model URL construction rejects traversal aliases of registered assets", () => {
  assert.throws(
    () => resolveModelAssetUrl("witch", "motions/../motions/yawn-once.motion3.json"),
    /invalid model asset path/
  );
});
