import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  defaultChunkBytes,
  defaultChunkTimeoutMs,
  defaultMaxRetriesPerChunk,
  downloadChunkedGgufModel,
  normalizeChunkedGgufDownloadConfig
} from "./lib/p2-23c-chunked-gguf-downloader.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const testRoot = join(repoRoot, ".tmp", "p2-23c-chunked-downloader-tests");

test("downloads multiple chunks serially with explicit Range requests", async () => {
  const model = Buffer.from("abcdefghi");
  const modelPath = modelPathFor("multi-chunk");
  const ranges: string[] = [];

  const result = await downloadChunkedGgufModel({
    destinationPath: modelPath,
    downloadURL: "https://example.invalid/model.gguf?token=SECRET",
    expectedSizeBytes: model.length,
    chunkBytes: 3,
    maxRetriesPerChunk: 2,
    timeoutMs: 1000,
    fetchImpl: async (_url: string, init: { headers: Record<string, string> }) => {
      ranges.push(init.headers.Range);
      const [start, end] = parseRange(init.headers.Range);
      return createResponse(206, model.subarray(start, end + 1));
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.source, "chunked");
  assert.deepEqual(ranges, ["bytes=0-2", "bytes=3-5", "bytes=6-8"]);
  assert.deepEqual(readFileSync(modelPath), model);
  assert.equal(existsSync(`${modelPath}.download`), false);
});

test("continues from an existing partial download", async () => {
  const model = Buffer.from("abcdef");
  const modelPath = modelPathFor("partial-continue");
  const partialPath = `${modelPath}.download`;
  const ranges: string[] = [];

  writeFile(partialPath, model.subarray(0, 3));

  const result = await downloadChunkedGgufModel({
    destinationPath: modelPath,
    downloadURL: "https://example.invalid/model.gguf",
    expectedSizeBytes: model.length,
    chunkBytes: 2,
    maxRetriesPerChunk: 2,
    timeoutMs: 1000,
    fetchImpl: async (_url: string, init: { headers: Record<string, string> }) => {
      ranges.push(init.headers.Range);
      const [start, end] = parseRange(init.headers.Range);
      return createResponse(206, model.subarray(start, end + 1));
    }
  });

  assert.equal(result.ok, true);
  assert.equal(result.source, "resumed");
  assert.deepEqual(ranges, ["bytes=3-4", "bytes=5-5"]);
  assert.deepEqual(readFileSync(modelPath), model);
  assert.equal(existsSync(partialPath), false);
});

test("retries a failed chunk once and then continues", async () => {
  const model = Buffer.from("abcdef");
  const modelPath = modelPathFor("retry-success");
  const calls: string[] = [];

  const result = await downloadChunkedGgufModel({
    destinationPath: modelPath,
    downloadURL: "https://example.invalid/model.gguf",
    expectedSizeBytes: model.length,
    chunkBytes: 3,
    maxRetriesPerChunk: 2,
    timeoutMs: 1000,
    fetchImpl: async (_url: string, init: { headers: Record<string, string> }) => {
      calls.push(init.headers.Range);

      if (calls.length === 1) {
        throw namedError("TypeError");
      }

      const [start, end] = parseRange(init.headers.Range);
      return createResponse(206, model.subarray(start, end + 1));
    }
  });

  assert.equal(result.ok, true);
  assert.deepEqual(calls, ["bytes=0-2", "bytes=0-2", "bytes=3-5"]);
  assert.deepEqual(readFileSync(modelPath), model);
});

test("blocks after max retries and keeps the previous partial", async () => {
  const modelPath = modelPathFor("retry-blocked");
  const partialPath = `${modelPath}.download`;

  writeFile(partialPath, Buffer.from("abc"));

  const result = await downloadChunkedGgufModel({
    destinationPath: modelPath,
    downloadURL: "https://example.invalid/model.gguf?Policy=SECRET&Signature=SECRET",
    expectedSizeBytes: 6,
    chunkBytes: 3,
    maxRetriesPerChunk: 2,
    timeoutMs: 1000,
    fetchImpl: async () => {
      throw namedError("TypeError");
    }
  });

  assert.equal(result.ok, false);
  assert.equal(result.summary.reason, "model_download_failed");
  assert.equal(result.summary.partialSizeBytes, 3);
  assert.equal(result.summary.attempt, 2);
  assert.equal(existsSync(partialPath), true);
  assert.equal(statSync(partialPath).size, 3);
  assert.equal(existsSync(modelPath), false);
  assertSafeSummary(result.summary);
});

test("blocks on unexpected HTTP status without leaking URL query details", async () => {
  const modelPath = modelPathFor("http-status-blocked");
  const unsafeUrl = "https://example.invalid/model.gguf?token=SECRET&prompt=NO&messages=NO";

  const result = await downloadChunkedGgufModel({
    destinationPath: modelPath,
    downloadURL: unsafeUrl,
    expectedSizeBytes: 6,
    chunkBytes: 3,
    maxRetriesPerChunk: 1,
    timeoutMs: 1000,
    fetchImpl: async () => createResponse(403, "no")
  });

  assert.equal(result.ok, false);
  assert.equal(result.summary.reason, "model_download_http_403");
  assertSafeSummary(result.summary, [unsafeUrl, "token=SECRET", "prompt=NO", "messages=NO"]);
});

test("normalizes invalid download options back to safe defaults", () => {
  const config = normalizeChunkedGgufDownloadConfig({
    destinationPath: "model.gguf",
    downloadURL: "https://example.invalid/model.gguf",
    expectedSizeBytes: -1,
    chunkBytes: 0,
    maxRetriesPerChunk: Number.NaN,
    timeoutMs: "bad",
    maxChunks: -1,
    maxBytes: 0,
    maxDurationMs: undefined
  });

  assert.equal(config.expectedSizeBytes, 0);
  assert.equal(config.chunkBytes, defaultChunkBytes);
  assert.equal(config.maxRetriesPerChunk, defaultMaxRetriesPerChunk);
  assert.equal(config.timeoutMs, defaultChunkTimeoutMs);
  assert.equal(config.maxChunks, undefined);
  assert.equal(config.maxBytes, undefined);
  assert.equal(config.maxDurationMs, defaultChunkTimeoutMs);
});

test.after(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

function modelPathFor(name: string) {
  const root = join(testRoot, name);
  rmSync(root, { recursive: true, force: true });
  return join(root, "models", "model.gguf");
}

function createResponse(status: number, body: Buffer | string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: Readable.from([body])
  };
}

function parseRange(range: string) {
  const match = /^bytes=(\d+)-(\d+)$/.exec(range);
  assert.ok(match, range);
  return [Number.parseInt(match[1], 10), Number.parseInt(match[2], 10)];
}

function writeFile(path: string, content: Buffer) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

function namedError(name: string) {
  const error = new Error(name);
  error.name = name;
  return error;
}

function assertSafeSummary(value: unknown, extraForbiddenValues: string[] = []) {
  const text = JSON.stringify(value);

  assert.equal(JSON.parse(text).safeSummaryOnly, true);
  assert.doesNotMatch(text, /[A-Za-z]:\\/);
  assert.doesNotMatch(text, /Authorization/i);
  assert.doesNotMatch(text, /Bearer/i);
  assert.doesNotMatch(text, /api[_-]?key/i);
  assert.doesNotMatch(text, /prompt/i);
  assert.doesNotMatch(text, /messages/i);
  assert.doesNotMatch(text, /Policy/i);
  assert.doesNotMatch(text, /Signature/i);
  assert.doesNotMatch(text, /Key-Pair-Id/i);

  for (const forbidden of extraForbiddenValues) {
    assert.equal(text.includes(forbidden), false, forbidden);
  }
}
