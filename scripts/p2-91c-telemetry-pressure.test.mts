import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createTelemetryService } from "../src/main/services/telemetry.ts";
import {
  encodePersistentTelemetryEvent,
  parsePersistentTelemetryEvent,
  PERSISTENT_TELEMETRY_CATALOG,
  type PersistentTelemetryEvent
} from "../src/shared/telemetry-contract.ts";

const MAX_LOG_BYTES = 10 * 1024 * 1024;
const MAX_LOG_FILES = 5;
const WRITES_PER_STATE = 1000;
const FIXED_NOW = new Date("2032-03-04T05:06:07.000Z");
const CURRENT_LOG_NAME = "telemetry-2032-03-04T05-06-07-000Z.jsonl";

function longestEnum(values: readonly string[]): string {
  return [...values].sort((left, right) => Buffer.byteLength(JSON.stringify(right)) - Buffer.byteLength(JSON.stringify(left)))[0] ?? "";
}

function createMaximumLegalEvent(): PersistentTelemetryEvent {
  let largest: { event: PersistentTelemetryEvent; bytes: number } | null = null;
  for (const [type, schema] of Object.entries(PERSISTENT_TELEMETRY_CATALOG)) {
    const payload: Record<string, unknown> = {};
    for (const [key, rule] of Object.entries(schema.fields)) {
      payload[key] = rule.kind === "enum"
        ? longestEnum(rule.values)
        : rule.kind === "boolean"
          ? false
          : rule.max;
    }
    const event = parsePersistentTelemetryEvent({ type, payload });
    assert.ok(event, `catalog maximum candidate must parse: ${type}`);
    const encoded = encodePersistentTelemetryEvent(event, FIXED_NOW.toISOString());
    assert.ok(encoded);
    const bytes = Buffer.byteLength(`${encoded}\n`);
    if (!largest || bytes > largest.bytes) largest = { event, bytes };
  }
  assert.ok(largest);
  return largest.event;
}

const maximumEvent = createMaximumLegalEvent();
const maximumLine = `${encodePersistentTelemetryEvent(maximumEvent, FIXED_NOW.toISOString())}\n`;
const maximumLineBytes = Buffer.byteLength(maximumLine);

type PressureMetrics = {
  state: string;
  p95Ms: number;
  p99Ms: number;
  maxMs: number;
  totalMs: number;
  fileCount: number;
  largestFileBytes: number;
  measuredLineCount: number;
  malformedLineCount: number;
};

function percentile(ordered: readonly number[], ratio: number): number {
  return ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * ratio) - 1)] ?? Infinity;
}

function readTelemetryLines(logDirectory: string): string[] {
  return readdirSync(logDirectory)
    .filter((name) => name.endsWith(".jsonl"))
    .flatMap((name) => readFileSync(join(logDirectory, name), "utf8").split(/\r?\n/u).filter(Boolean));
}

function prepareBoundaryFixture(userDataPath: string): void {
  const logDirectory = join(userDataPath, "logs");
  mkdirSync(logDirectory, { recursive: true });
  for (let index = 0; index < MAX_LOG_FILES; index += 1) {
    const path = join(logDirectory, `telemetry-2031-01-01T00-00-0${index}-000Z.jsonl`);
    writeFileSync(path, maximumLine, "utf8");
    const stamp = new Date(1_000 + index);
    utimesSync(path, stamp, stamp);
  }
  const wholeLines = Math.floor(MAX_LOG_BYTES / maximumLineBytes);
  writeFileSync(join(logDirectory, CURRENT_LOG_NAME), maximumLine.repeat(wholeLines), "utf8");
  assert.ok(MAX_LOG_BYTES - statSync(join(logDirectory, CURRENT_LOG_NAME)).size < maximumLineBytes);
}

function runState(state: string, prepare: (userDataPath: string) => void): { metrics: PressureMetrics; samples: number[] } {
  const userDataPath = mkdtempSync(join(tmpdir(), `ai-desktop-pet-p2-91c-pressure-${state}-`));
  try {
    prepare(userDataPath);
    const telemetry = createTelemetryService({ userDataPath, now: () => FIXED_NOW });
    const samples: number[] = [];
    const startedAt = performance.now();
    for (let index = 0; index < WRITES_PER_STATE; index += 1) {
      const writeStartedAt = performance.now();
      telemetry.logEvent(maximumEvent);
      samples.push(performance.now() - writeStartedAt);
    }
    const totalMs = performance.now() - startedAt;
    const ordered = [...samples].sort((left, right) => left - right);
    const logDirectory = telemetry.getLogDirectory();
    const files = readdirSync(logDirectory).filter((name) => name.endsWith(".jsonl"));
    const allLines = readTelemetryLines(logDirectory);
    const malformedLineCount = allLines.filter((line) => {
      try {
        const value = JSON.parse(line);
        return parsePersistentTelemetryEvent({ type: value.type, payload: value.payload }) === null;
      } catch {
        return true;
      }
    }).length;
    const measuredLineCount = readFileSync(join(logDirectory, CURRENT_LOG_NAME), "utf8")
      .split(/\r?\n/u).filter(Boolean).length;
    const metrics = {
      state,
      p95Ms: percentile(ordered, 0.95),
      p99Ms: percentile(ordered, 0.99),
      maxMs: ordered.at(-1) ?? Infinity,
      totalMs,
      fileCount: files.length,
      largestFileBytes: Math.max(...files.map((name) => statSync(join(logDirectory, name)).size)),
      measuredLineCount,
      malformedLineCount
    };
    assert.ok(metrics.p95Ms <= 8, `${state} p95=${metrics.p95Ms}`);
    assert.ok(metrics.p99Ms <= 25, `${state} p99=${metrics.p99Ms}`);
    assert.ok(metrics.maxMs <= 100, `${state} max=${metrics.maxMs}`);
    assert.ok(metrics.totalMs <= 3000, `${state} total=${metrics.totalMs}`);
    assert.equal(metrics.measuredLineCount, WRITES_PER_STATE, `${state} dropped writes`);
    assert.equal(metrics.malformedLineCount, 0, `${state} malformed lines`);
    assert.ok(metrics.fileCount <= MAX_LOG_FILES, `${state} files=${metrics.fileCount}`);
    assert.ok(metrics.largestFileBytes <= MAX_LOG_BYTES, `${state} largest=${metrics.largestFileBytes}`);
    return { metrics, samples };
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
    assert.equal(existsSync(userDataPath), false, `${state} fixture cleanup`);
  }
}

test("P2-91C1 maximum-payload pressure covers first directory, existing file, and boundary rotation", (context) => {
  const runs = [
    runState("first-directory", () => undefined),
    runState("existing-file", (userDataPath) => {
      const logDirectory = join(userDataPath, "logs");
      mkdirSync(logDirectory, { recursive: true });
      writeFileSync(join(logDirectory, CURRENT_LOG_NAME), "", "utf8");
    }),
    runState("boundary-rotation-prune", prepareBoundaryFixture)
  ];
  const reports = runs.map((run) => run.metrics);
  const combinedSamples = runs.flatMap((run) => run.samples).sort((left, right) => left - right);
  const combined = {
    p95Ms: percentile(combinedSamples, 0.95),
    p99Ms: percentile(combinedSamples, 0.99),
    maxMs: combinedSamples.at(-1) ?? Infinity,
    totalMs: reports.reduce((total, report) => total + report.totalMs, 0)
  };
  assert.ok(combined.p95Ms <= 8, `combined p95=${combined.p95Ms}`);
  assert.ok(combined.p99Ms <= 25, `combined p99=${combined.p99Ms}`);
  assert.ok(combined.maxMs <= 100, `combined max=${combined.maxMs}`);
  context.diagnostic(JSON.stringify({
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    maximumLineBytes,
    writesPerState: WRITES_PER_STATE,
    reports,
    combined,
    cleanup: true
  }));
});
