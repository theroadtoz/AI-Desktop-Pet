import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  llamaServerPathEnv,
  modelGgufPathEnv,
  packRootEnv,
  prepareQwen25LocalLlmPack
} from "./p2-23c-prepare-qwen25-15b-local-llm-pack.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testRoot = join(repoRoot, ".tmp", "p2-23c-prepare-tests");
const leakMarker = "DO_NOT_LEAK_P2_23C_ABSOLUTE";

test("imports local GGUF into pack without leaking the source absolute path", async () => {
  const fixture = createFixture("import-success");
  const sourcePath = join(testRoot, "import-success", "sources", leakMarker, "imported-model.gguf");
  const content = "tiny fake gguf import\n";

  writeFile(sourcePath, content);

  const result = await prepareQwen25LocalLlmPack({
    repoRoot,
    env: {
      ...fixture.env,
      [modelGgufPathEnv]: sourcePath
    },
    expectedModelSizeBytes: statSync(sourcePath).size
  });

  assert.equal(result.ok, true);
  assert.equal(result.summary.modelSource, "imported");
  assert.equal(result.summary.modelSourceBasename, "imported-model.gguf");
  assert.equal(readFileSync(join(fixture.packRoot, "models", "model.gguf"), "utf8"), content);

  const manifest = JSON.parse(readFileSync(join(fixture.packRoot, "manifest.json"), "utf8"));
  assert.equal(manifest.model.path, "models/model.gguf");

  assertSafeOutput(result.summary, [sourcePath, leakMarker, modelGgufPathEnv]);
});

test("rejects invalid import files with a safe blocked summary", async () => {
  const badExt = createFixture("bad-extension");
  const binPath = join(testRoot, "bad-extension", "sources", leakMarker, "model.bin");
  writeFile(binPath, "not a gguf\n");

  const badExtResult = await prepareQwen25LocalLlmPack({
    repoRoot,
    env: {
      ...badExt.env,
      [modelGgufPathEnv]: binPath
    },
    expectedModelSizeBytes: statSync(binPath).size
  });

  assert.equal(badExtResult.ok, false);
  assert.equal(badExtResult.summary.status, "blocked");
  assert.equal(badExtResult.summary.reason, "model_import_not_gguf");
  assertSafeOutput(badExtResult.summary, [binPath, leakMarker, modelGgufPathEnv]);

  const wrongSize = createFixture("wrong-size");
  const ggufPath = join(testRoot, "wrong-size", "sources", leakMarker, "wrong-size.gguf");
  writeFile(ggufPath, "short gguf\n");

  const wrongSizeResult = await prepareQwen25LocalLlmPack({
    repoRoot,
    env: {
      ...wrongSize.env,
      [modelGgufPathEnv]: ggufPath
    },
    expectedModelSizeBytes: statSync(ggufPath).size + 1
  });

  assert.equal(wrongSizeResult.ok, false);
  assert.equal(wrongSizeResult.summary.status, "blocked");
  assert.equal(wrongSizeResult.summary.reason, "model_import_size_mismatch");
  assertSafeOutput(wrongSizeResult.summary, [ggufPath, leakMarker, modelGgufPathEnv]);
});

test("keeps partial downloads and resumes them with a Range request", async () => {
  const fixture = createFixture("resume-download");
  const expectedModel = Buffer.from("abcdefghi");
  const fetchCalls: Array<{ headers: Record<string, string> }> = [];

  const firstResult = await prepareQwen25LocalLlmPack({
    repoRoot,
    env: fixture.env,
    expectedModelSizeBytes: expectedModel.length,
    fetch: async (_url: string, init: { headers: Record<string, string> }) => {
      fetchCalls.push({ headers: init.headers });
      return createResponse(200, expectedModel.subarray(0, 3));
    },
    modelDownloadURL: "https://example.invalid/model.gguf?token=SECRET"
  });

  const partialPath = join(fixture.packRoot, "models", "model.gguf.download");
  assert.equal(firstResult.ok, false);
  assert.equal(firstResult.summary.reason, "model_download_size_mismatch");
  assert.equal(existsSync(partialPath), true);
  assert.equal(statSync(partialPath).size, 3);
  assert.equal(fetchCalls[0].headers.Range, "bytes=0-8");

  const secondResult = await prepareQwen25LocalLlmPack({
    repoRoot,
    env: fixture.env,
    expectedModelSizeBytes: expectedModel.length,
    fetch: async (_url: string, init: { headers: Record<string, string> }) => {
      fetchCalls.push({ headers: init.headers });
      return createResponse(206, expectedModel.subarray(3));
    },
    modelDownloadURL: "https://example.invalid/model.gguf?token=SECRET"
  });

  assert.equal(secondResult.ok, true);
  assert.equal(secondResult.summary.modelSource, "resumed");
  assert.equal(fetchCalls[1].headers.Range, "bytes=3-8");
  assert.equal(existsSync(partialPath), false);
  assert.deepEqual(readFileSync(join(fixture.packRoot, "models", "model.gguf")), expectedModel);
});

test("download summary is allowlisted and excludes unsafe request details", async () => {
  const fixture = createFixture("safe-download-summary");
  const model = Buffer.from("complete fake gguf\n");
  const unsafeUrl = "https://example.invalid/model.gguf?token=SECRET&prompt=NO&messages=NO";

  const result = await prepareQwen25LocalLlmPack({
    repoRoot,
    env: fixture.env,
    expectedModelSizeBytes: model.length,
    fetch: async () => createResponse(200, model),
    modelDownloadURL: unsafeUrl
  });

  assert.equal(result.ok, true);
  assert.equal(result.summary.safeSummaryOnly, true);
  assert.equal(result.summary.modelSource, "downloaded");
  assertSafeOutput(result.summary, [
    unsafeUrl,
    "token=SECRET",
    "prompt=NO",
    "messages=NO",
    modelGgufPathEnv,
    fixture.packRoot
  ]);
});

test("download timeout returns a safe blocked summary", async () => {
  const fixture = createFixture("download-timeout");
  const unsafeUrl = "https://example.invalid/model.gguf?token=SECRET&messages=NO";

  const result = await prepareQwen25LocalLlmPack({
    repoRoot,
    env: fixture.env,
    expectedModelSizeBytes: 9,
    downloadTimeoutMs: 1,
    fetch: async (_url: string, init: { signal?: AbortSignal }) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener("abort", () => {
        const error = new Error("aborted");
        error.name = "AbortError";
        reject(error);
      });
    }),
    modelDownloadURL: unsafeUrl
  });

  assert.equal(result.ok, false);
  assert.equal(result.summary.status, "blocked");
  assert.equal(result.summary.reason, "model_download_failed");
  assert.equal(result.summary.errorName, "AbortError");
  assert.equal(result.summary.timeoutMs, 1);
  assertSafeOutput(result.summary, [unsafeUrl, "token=SECRET", "messages=NO"]);
});

test.after(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

function createFixture(name: string) {
  const root = join(testRoot, name);
  const runtimeRoot = join(root, "runtime");
  const packRoot = join(root, "pack");
  const executablePath = join(runtimeRoot, "llama-server.exe");

  rmSync(root, { recursive: true, force: true });
  mkdirSync(runtimeRoot, { recursive: true });
  writeFileSync(executablePath, `fake llama server for ${name}\n`, "utf8");
  writeFileSync(join(runtimeRoot, "llama.dll"), `fake dll for ${name}\n`, "utf8");

  return {
    packRoot,
    env: {
      [llamaServerPathEnv]: executablePath,
      [packRootEnv]: packRoot
    }
  };
}

function createResponse(status: number, body: Buffer | string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: Readable.from([body])
  };
}

function writeFile(path: string, content: string | Buffer) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function assertSafeOutput(value: unknown, forbiddenValues: string[]) {
  const text = JSON.stringify(value);

  assert.doesNotMatch(text, /[A-Za-z]:\\/);
  assert.doesNotMatch(text, /Authorization/i);
  assert.doesNotMatch(text, /Bearer/i);
  assert.doesNotMatch(text, /api[_-]?key/i);
  assert.doesNotMatch(text, /prompt/i);
  assert.doesNotMatch(text, /messages/i);
  assert.doesNotMatch(text, /request body/i);

  for (const forbidden of forbiddenValues) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
}
