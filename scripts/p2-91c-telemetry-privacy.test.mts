import assert from "node:assert/strict";
import * as fs from "node:fs";
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";

import {
  encodePersistentTelemetryEvent,
  isPersistentTelemetryEventType,
  parsePersistentTelemetryEvent,
  toPersistentTelemetryEvent
} from "../src/shared/telemetry-contract.ts";
import { createTelemetryService } from "../src/main/services/telemetry.ts";

test("P2-91C1 catalog accepts only exact shallow operational payloads", () => {
  assert.deepEqual(
    parsePersistentTelemetryEvent({
      type: "provider_config_saved",
      payload: { source: "file", configured: true }
    }),
    { type: "provider_config_saved", payload: { source: "file", configured: true } }
  );
  assert.deepEqual(
    toPersistentTelemetryEvent("pet_interaction_action_finished", {
      type: "headPat",
      terminalStatus: "completed",
      requestId: "must-not-persist"
    }),
    { type: "pet_interaction_action_finished", payload: { actionType: "headPat", terminalStatus: "completed" } }
  );
});

test("P2-91C1 persistent action contract uses actionType and permits documented health enums", () => {
  assert.equal(isPersistentTelemetryEventType("pet_interaction_action_finished"), true);
  assert.equal(isPersistentTelemetryEventType("pet_action_finished"), false);
  assert.deepEqual(
    toPersistentTelemetryEvent("pet_interaction_action_skipped", {
      type: "bodyAttentionTurn",
      skipReason: "active_action",
      requestId: "must-not-persist",
      actionInstanceId: "must-not-persist"
    }),
    {
      type: "pet_interaction_action_skipped",
      payload: { actionType: "bodyAttentionTurn", skipReason: "active_action" }
    }
  );
  assert.deepEqual(
    parsePersistentTelemetryEvent({
      type: "pet_interaction_action_finished",
      payload: { actionType: "headPat", terminalStatus: "completed" }
    }),
    {
      type: "pet_interaction_action_finished",
      payload: { actionType: "headPat", terminalStatus: "completed" }
    }
  );
  assert.deepEqual(
    parsePersistentTelemetryEvent({
      type: "provider_health_checked",
      payload: { status: "model_missing", latencyBucketMs: 0 }
    }),
    { type: "provider_health_checked", payload: { status: "model_missing", latencyBucketMs: 0 } }
  );
});

test("P2-91C1 skipped persistence requires the exact safe skipReason closed set", () => {
  for (const skipReason of [
    "active_action", "global_cooldown", "head_pat_cooldown",
    "same_action_cooldown", "window_shake_feedback_cooldown"
  ]) {
    assert.deepEqual(parsePersistentTelemetryEvent({
      type: "pet_interaction_action_skipped",
      payload: { actionType: "bodyAttentionTurn", skipReason }
    }), {
      type: "pet_interaction_action_skipped",
      payload: { actionType: "bodyAttentionTurn", skipReason }
    });
  }
  for (const payload of [
    { actionType: "bodyAttentionTurn" },
    { actionType: "bodyAttentionTurn", skipReason: "unknown" },
    { actionType: "bodyAttentionTurn", skipReason: "active_action", requestId: "private" }
  ]) assert.equal(parsePersistentTelemetryEvent({ type: "pet_interaction_action_skipped", payload }), null);
});

test("P2-91C1 catalog fails closed for unknown, extra, deep, prototype, nonfinite, and sensitive input", () => {
  const valid = { type: "provider_config_saved", payload: { source: "file", configured: true } };
  assert.equal(parsePersistentTelemetryEvent({ type: "not_registered", payload: {} }), null);
  assert.equal(parsePersistentTelemetryEvent({ ...valid, payload: { ...valid.payload, extra: true } }), null);
  assert.equal(parsePersistentTelemetryEvent({ ...valid, payload: { source: "file", configured: { deep: true } } }), null);
  assert.equal(parsePersistentTelemetryEvent({ type: "provider_health_checked", payload: { status: "ready", latencyBucketMs: Infinity } }), null);
  assert.equal(parsePersistentTelemetryEvent({ type: "provider_config_saved", payload: { source: "file", configured: true, requestId: "x" } }), null);
  assert.equal(parsePersistentTelemetryEvent({ type: "provider_config_saved", payload: Object.assign(Object.create({ inherited: true }), { source: "file", configured: true }) }), null);
  assert.equal(toPersistentTelemetryEvent("provider_config_saved", { source: "file", configured: true, baseURLHost: "poison" }), null);
  for (const key of ["actionId", "requestId", "baseURLHost", "apiKeyRef", "metadata"]) {
    assert.equal(parsePersistentTelemetryEvent({
      type: "pet_interaction_action_finished",
      payload: { actionType: "headPat", terminalStatus: "completed", [key]: "poison" }
    }), null, `${key} must not be persistent`);
  }
});

test("P2-91C1 rejects acceptance-only events and sentinel values without serializing substitutes", () => {
  for (const value of [
    "C1_PROMPT_SENTINEL",
    "C1_BODY_SENTINEL",
    "C1_PATH_SENTINEL",
    "C1_REQUEST_ID_SENTINEL",
    "C1_ACTION_ID_SENTINEL",
    "C1_MODEL_SENTINEL",
    "C1_HOST_SENTINEL",
    "C1_KEY_SENTINEL",
    "C1_METADATA_SENTINEL"
  ]) {
    assert.equal(toPersistentTelemetryEvent("provider_config_saved", { source: "file", configured: true, value }), null);
  }
  assert.equal(parsePersistentTelemetryEvent({ type: "p2_91c_acceptance_observation", payload: {} }), null);
});

test("P2-91C1 empty schemas reject every extra shape instead of reducing to empty", () => {
  for (const payload of [
    { userDataPath: "C1_PATH_SENTINEL" },
    { deep: { value: true } },
    { array: ["value"] },
    { providerId: "fake" },
    { actionInstanceId: "operational-only" },
    { count: Number.NaN }
  ]) {
    assert.equal(toPersistentTelemetryEvent("startup", payload), null);
  }
  assert.deepEqual(toPersistentTelemetryEvent("startup", {}), { type: "startup", payload: {} });
});

test("P2-91C1 proactive overlay diagnostics persist only exact empty payloads", () => {
  for (const type of [
    "proactive_bubble_overlay_region_changed",
    "proactive_bubble_overlay_hit_changed"
  ] as const) {
    const emptyEvent = { type, payload: {} };
    assert.deepEqual(parsePersistentTelemetryEvent(emptyEvent), emptyEvent);
    assert.deepEqual(toPersistentTelemetryEvent(type, {}), emptyEvent);
  }
  for (const { type, payload } of [
    { type: "proactive_bubble_overlay_region_changed", payload: { regionState: "registered" } },
    { type: "proactive_bubble_overlay_region_changed", payload: { authority: "main" } },
    { type: "proactive_bubble_overlay_hit_changed", payload: { overlayHitState: "active" } },
    { type: "proactive_bubble_overlay_hit_changed", payload: { overlayHitAuthority: "main_poll" } }
  ] as const) {
    assert.equal(parsePersistentTelemetryEvent({ type, payload }), null);
    assert.equal(toPersistentTelemetryEvent(type, payload), null);
  }
});

test("P2-91C1 rejected writer input creates no file and changes no rotation state", () => {
  const userDataPath = mkdtempSync(join(tmpdir(), "p2-91c-rejected-writer-"));
  try {
    const service = createTelemetryService({ userDataPath });
    service.logEvent({ type: "startup", payload: { path: "C1_PATH_SENTINEL" } } as never);
    assert.equal(fs.existsSync(service.getLogDirectory()), false);
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test("P2-91C1 rotates at the real 10 MiB boundary and prunes to five newest files", () => {
  const userDataPath = mkdtempSync(join(tmpdir(), "p2-91c-rotation-"));
  const logDirectory = join(userDataPath, "logs");
  const now = new Date("2030-01-02T03:04:05.000Z");
  const currentName = "telemetry-2030-01-02T03-04-05-000Z.jsonl";
  const event = parsePersistentTelemetryEvent({ type: "startup", payload: {} });
  assert.ok(event);
  const line = `${encodePersistentTelemetryEvent(event, now.toISOString())}\n`;
  try {
    fs.mkdirSync(logDirectory, { recursive: true });
    for (let index = 0; index < 5; index += 1) {
      const path = join(logDirectory, `telemetry-2029-01-01T00-00-0${index}-000Z.jsonl`);
      writeFileSync(path, "old\n", "utf8");
      fs.utimesSync(path, new Date(1_000 + index), new Date(1_000 + index));
    }
    writeFileSync(join(logDirectory, currentName), Buffer.alloc(10 * 1024 * 1024 - Buffer.byteLength(line)));
    const service = createTelemetryService({ userDataPath, now: () => now });
    service.logEvent(event);
    assert.equal(fs.statSync(join(logDirectory, currentName)).size, 10 * 1024 * 1024);
    service.logEvent(event);
    const logs = readdirSync(logDirectory).filter((name) => name.endsWith(".jsonl"));
    assert.equal(logs.length, 5);
    assert.ok(logs.includes(currentName));
    assert.ok(logs.some((name) => name.includes("-1893553445000.jsonl")));
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test("P2-91C1 writer failures are fixed-category, leave no half line, and recover", () => {
  const userDataPath = mkdtempSync(join(tmpdir(), "p2-91c-writer-errors-"));
  const warnings: string[] = [];
  let failEncode = true;
  let failAppend = true;
  let failMkdir = true;
  const event = parsePersistentTelemetryEvent({ type: "startup", payload: {} });
  assert.ok(event);
  const fileSystem = {
    appendFileSync(path: fs.PathOrFileDescriptor, data: string | Uint8Array) {
      if (failAppend && String(data).length > 0) {
        failAppend = false;
        fs.appendFileSync(path, String(data).slice(0, 4));
        throw new Error("C1_BODY_SENTINEL");
      }
      fs.appendFileSync(path, data);
    },
    existsSync: fs.existsSync,
    mkdirSync(path: fs.PathLike, options?: fs.MakeDirectoryOptions & { recursive?: boolean }) {
      if (failMkdir) {
        failMkdir = false;
        throw new Error("C1_PATH_SENTINEL");
      }
      return fs.mkdirSync(path, options as fs.MakeDirectoryOptions & { recursive: true });
    },
    readdirSync: fs.readdirSync,
    renameSync: fs.renameSync,
    statSync: fs.statSync,
    truncateSync: fs.truncateSync,
    unlinkSync: fs.unlinkSync
  } as typeof fs;
  const service = createTelemetryService({
    userDataPath,
    fileSystem,
    encodeEvent(value, timestamp) {
      if (failEncode) {
        failEncode = false;
        throw new Error("C1_METADATA_SENTINEL");
      }
      return encodePersistentTelemetryEvent(value, timestamp);
    },
    warn(category) { warnings.push(category); }
  });
  try {
    service.logEvent(event);
    service.logEvent(event);
    service.logEvent(event);
    service.logEvent(event);
    const logPath = join(service.getLogDirectory(), readdirSync(service.getLogDirectory())[0] ?? "missing");
    const raw = fs.readFileSync(logPath, "utf8");
    assert.equal(raw.split(/\r?\n/u).filter(Boolean).length, 1);
    assert.doesNotMatch(raw, /C1_/u);
    assert.deepEqual(warnings, ["write_failed", "write_failed", "write_failed"]);
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test("P2-91C1 stat, rename, and prune failures retry without false success", async (context) => {
  const event = parsePersistentTelemetryEvent({ type: "startup", payload: {} });
  assert.ok(event);
  const now = new Date("2031-02-03T04:05:06.000Z");
  const currentName = "telemetry-2031-02-03T04-05-06-000Z.jsonl";

  await context.test("stat failure", () => {
    const userDataPath = mkdtempSync(join(tmpdir(), "p2-91c-stat-failure-"));
    const logDirectory = join(userDataPath, "logs");
    const warnings: string[] = [];
    let failStat = true;
    try {
      fs.mkdirSync(logDirectory, { recursive: true });
      writeFileSync(join(logDirectory, currentName), "", "utf8");
      const service = createTelemetryService({
        userDataPath,
        now: () => now,
        fileSystem: {
          ...fs,
          statSync(path: fs.PathLike) {
            if (failStat && String(path).endsWith(currentName)) {
              failStat = false;
              throw new Error("C1_PATH_SENTINEL");
            }
            return fs.statSync(path);
          }
        } as typeof fs,
        warn(category) { warnings.push(category); }
      });
      service.logEvent(event);
      service.logEvent(event);
      const raw = fs.readFileSync(join(logDirectory, currentName), "utf8");
      assert.equal(raw.split(/\r?\n/u).filter(Boolean).length, 1);
      assert.deepEqual(warnings, ["write_failed"]);
      assert.doesNotMatch(raw, /C1_/u);
    } finally {
      rmSync(userDataPath, { recursive: true, force: true });
    }
  });

  await context.test("rename failure", () => {
    const userDataPath = mkdtempSync(join(tmpdir(), "p2-91c-rename-failure-"));
    const logDirectory = join(userDataPath, "logs");
    const warnings: string[] = [];
    let failRename = true;
    try {
      fs.mkdirSync(logDirectory, { recursive: true });
      writeFileSync(join(logDirectory, currentName), Buffer.alloc(10 * 1024 * 1024));
      const service = createTelemetryService({
        userDataPath,
        now: () => now,
        fileSystem: {
          ...fs,
          renameSync(oldPath: fs.PathLike, newPath: fs.PathLike) {
            if (failRename) {
              failRename = false;
              throw new Error("C1_PATH_SENTINEL");
            }
            fs.renameSync(oldPath, newPath);
          }
        } as typeof fs,
        warn(category) { warnings.push(category); }
      });
      service.logEvent(event);
      service.logEvent(event);
      const raw = fs.readFileSync(join(logDirectory, currentName), "utf8");
      assert.equal(raw.split(/\r?\n/u).filter(Boolean).length, 1);
      assert.deepEqual(warnings, ["write_failed"]);
      assert.doesNotMatch(raw, /C1_/u);
    } finally {
      rmSync(userDataPath, { recursive: true, force: true });
    }
  });

  await context.test("prune failure", () => {
    const userDataPath = mkdtempSync(join(tmpdir(), "p2-91c-prune-failure-"));
    const logDirectory = join(userDataPath, "logs");
    const warnings: string[] = [];
    let failUnlink = true;
    try {
      fs.mkdirSync(logDirectory, { recursive: true });
      for (let index = 0; index < 6; index += 1) {
        const path = join(logDirectory, `telemetry-2030-01-01T00-00-0${index}-000Z.jsonl`);
        writeFileSync(path, "old\n", "utf8");
        fs.utimesSync(path, new Date(1_000 + index), new Date(1_000 + index));
      }
      const service = createTelemetryService({
        userDataPath,
        now: () => now,
        fileSystem: {
          ...fs,
          unlinkSync(path: fs.PathLike) {
            if (failUnlink) {
              failUnlink = false;
              throw new Error("C1_PATH_SENTINEL");
            }
            fs.unlinkSync(path);
          }
        } as typeof fs,
        warn(category) { warnings.push(category); }
      });
      service.logEvent(event);
      service.logEvent(event);
      const raw = fs.readFileSync(join(logDirectory, currentName), "utf8");
      assert.equal(raw.split(/\r?\n/u).filter(Boolean).length, 1);
      assert.equal(readdirSync(logDirectory).filter((name) => name.endsWith(".jsonl")).length, 5);
      assert.deepEqual(warnings, ["write_failed"]);
      assert.doesNotMatch(raw, /C1_/u);
    } finally {
      rmSync(userDataPath, { recursive: true, force: true });
    }
  });
});

test("P2-91C1 static audit enumerates every production telemetry ingress", () => {
  const sourceRoot = join(process.cwd(), "src");
  const files: string[] = [];
  const visitDirectory = (directory: string): void => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visitDirectory(path);
      else if (entry.isFile() && entry.name.endsWith(".ts")) files.push(path);
    }
  };
  visitDirectory(sourceRoot);

  const normalize = (path: string): string => path.slice(process.cwd().length + 1).replaceAll("\\", "/");
  const loggerTypeFiles = new Set([
    "src/shared/telemetry-contract.ts",
    "src/main/services/chat/provider-health.ts",
    "src/main/services/chat/provider-factory.ts",
    "src/main/services/chat/openai-compatible-provider.ts",
    "src/main/services/config/provider-config-store.ts",
    "src/main/services/config/secure-key-store.ts",
    "src/main/services/config/user-profile-store.ts"
  ]);
  const producerFiles = new Set([...loggerTypeFiles].filter((path) => path !== "src/shared/telemetry-contract.ts"));
  const observed = { logTelemetry: 0, logEvent: 0, appendFileSync: 0, loggerType: 0 };

  for (const path of files) {
    const relativePath = normalize(path);
    const source = ts.createSourceFile(path, fs.readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
    const walk = (node: ts.Node): void => {
      if (ts.isIdentifier(node) && node.text === "PersistentTelemetryLogger") {
        observed.loggerType += 1;
        assert.equal(loggerTypeFiles.has(relativePath), true, `unregistered logger type ingress: ${relativePath}`);
      }
      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        const name = ts.isIdentifier(callee)
          ? callee.text
          : ts.isPropertyAccessExpression(callee)
            ? callee.name.text
            : null;
        if (name === "logTelemetry") {
          observed.logTelemetry += 1;
          assert.equal(relativePath === "src/main/app.ts" || producerFiles.has(relativePath), true,
            `unregistered logTelemetry call: ${relativePath}`);
          if (relativePath === "src/main/app.ts" && node.arguments.length > 1) {
            const first = node.arguments[0];
            const explicitlyMapped = ts.isStringLiteral(first) && first.text === "provider_config_loaded";
            const actionMapped = ts.isPropertyAccessExpression(first) && first.name.text === "type";
            assert.equal(explicitlyMapped || actionMapped, true, `broad app telemetry payload: ${relativePath}`);
          }
        }
        if (name === "logEvent") {
          observed.logEvent += 1;
          assert.equal(relativePath, "src/main/app.ts", `second telemetry sink: ${relativePath}`);
        }
        if (name === "appendFileSync") {
          observed.appendFileSync += 1;
          assert.equal(relativePath, "src/main/services/telemetry.ts", `direct telemetry writer: ${relativePath}`);
        }
      }
      ts.forEachChild(node, walk);
    };
    walk(source);
  }

  assert.ok(observed.logTelemetry > 50);
  assert.equal(observed.logEvent, 1);
  assert.equal(observed.appendFileSync, 4);
  assert.ok(observed.loggerType >= loggerTypeFiles.size);
});
