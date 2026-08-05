import assert from "node:assert/strict";
import * as fs from "node:fs";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createAcceptanceEvidenceService,
  isCanonicalAcceptanceRunId,
  parseAcceptanceEvidenceEvent,
  readAcceptanceEvidence
} from "../src/main/services/acceptance-evidence.ts";

const RUN_ID = "123e4567-e89b-42d3-a456-426614174000";

test("P2-91C1 acceptance evidence is disabled unless every main-only run gate is exact", () => {
  assert.equal(isCanonicalAcceptanceRunId(RUN_ID), true);
  for (const runId of [undefined, "", RUN_ID.toUpperCase(), "123e4567-e89b-12d3-a456-426614174000", `../${RUN_ID}`, `${RUN_ID}.ndjson`]) {
    assert.equal(isCanonicalAcceptanceRunId(runId), false);
  }
  const userDataPath = mkdtempSync(join(tmpdir(), "p2-91c-evidence-disabled-"));
  try {
    for (const options of [
      { isPackaged: true, acceptanceTelemetryEnabled: true, runId: RUN_ID, p285ObservationEnabled: true, p285FixtureEnabled: true },
      { isPackaged: false, acceptanceTelemetryEnabled: false, runId: RUN_ID, p285ObservationEnabled: true, p285FixtureEnabled: true },
      { isPackaged: false, acceptanceTelemetryEnabled: true, runId: undefined, p285ObservationEnabled: true, p285FixtureEnabled: true },
      { isPackaged: false, acceptanceTelemetryEnabled: true, runId: RUN_ID, p285ObservationEnabled: true, p285FixtureEnabled: false },
      { isPackaged: false, acceptanceTelemetryEnabled: true, runId: RUN_ID, p288bFixtureEnabled: false }
    ]) {
      const service = createAcceptanceEvidenceService({ userDataPath, ...options });
      assert.equal(service.enabled, false);
      assert.equal(service.report({}), false);
    }
    assert.equal(fs.existsSync(join(userDataPath, "acceptance-evidence")), false);
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test("P2-91C1 P2-88B gate dispatch and lifecycle evidence are exact and correlated only in the run file", () => {
  const userDataPath = mkdtempSync(join(tmpdir(), "p2-91c-evidence-p288-"));
  try {
    const service = createAcceptanceEvidenceService({
      userDataPath, isPackaged: false, acceptanceTelemetryEnabled: true,
      runId: RUN_ID, p288bFixtureEnabled: true
    });
    const requestId = "c".repeat(32);
    for (const event of [
      {
        type: "p2_88b_affect_reply_action_gate",
        payload: { decision: "suppress", reason: "presentation_busy", activeMainReason: "chat_reply_waiting", localBusyReason: null }
      },
      { type: "dialogue_affect_action_dispatch", payload: { status: "accepted", reason: "accepted", requestId } },
      { type: "pet_interaction_action_started", payload: { actionType: "softSmile", reason: "state_idle", requestId } },
      { type: "pet_interaction_action_finished", payload: { actionType: "softSmile", reason: "state_idle", requestId, terminalStatus: "completed" } }
    ]) assert.equal(service.report(event), true);
    const result = readAcceptanceEvidence({ userDataPath, runId: RUN_ID, expectedSuite: "p2-88b" });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.events.length, 4);
    const raw = fs.readFileSync(service.filePath as string, "utf8");
    assert.doesNotMatch(raw, /prompt|body|path|host|model|key|metadata/iu);
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});

test("P2-91C1 evidence parser rejects foreign suites, unknown enums, unsafe IDs, and forbidden or extra data", () => {
  const base = {
    runId: RUN_ID,
    suite: "p2-88b",
    type: "dialogue_affect_action_dispatch",
    payload: { status: "accepted", reason: "accepted", requestId: "d".repeat(32) }
  };
  assert.ok(parseAcceptanceEvidenceEvent(base));
  for (const value of [
    { ...base, suite: "p2-85" },
    { ...base, payload: { ...base.payload, requestId: "unsafe/id" } },
    { ...base, payload: { ...base.payload, reason: "unknown" } },
    { ...base, payload: { ...base.payload, body: "C1_BODY_SENTINEL" } },
    { ...base, payload: { ...base.payload, extra: true } },
    { ...base, raw: {} }
  ]) assert.equal(parseAcceptanceEvidenceEvent(value), null);
});

test("P2-91C1 reader fails closed on foreign sibling, wrong suite, corrupt, truncated, and non-UTF8 evidence", () => {
  for (const fixture of [
    { name: "foreign-sibling", sibling: true, content: "" },
    { name: "wrong-suite", content: `${JSON.stringify({ runId: RUN_ID, suite: "p2-88b", type: "dialogue_affect_action_dispatch", payload: { status: "accepted", reason: "accepted", requestId: "e".repeat(32) } })}\n` },
    { name: "corrupt", content: "{bad}\n" },
    { name: "truncated", content: JSON.stringify({ runId: RUN_ID }) },
    { name: "non-utf8", bytes: Buffer.from([0xff, 0xfe, 0x0a]) }
  ]) {
    const userDataPath = mkdtempSync(join(tmpdir(), `p2-91c-evidence-${fixture.name}-`));
    try {
      const parent = join(userDataPath, "acceptance-evidence");
      mkdirSync(parent, { recursive: true });
      if (fixture.sibling) writeFileSync(join(parent, "foreign.ndjson"), "", "utf8");
      else writeFileSync(join(parent, `${RUN_ID}.ndjson`), fixture.bytes ?? fixture.content ?? "");
      assert.equal(readAcceptanceEvidence({ userDataPath, runId: RUN_ID, expectedSuite: "p2-85" }).ok, false, fixture.name);
    } finally {
      rmSync(userDataPath, { recursive: true, force: true });
    }
  }
});

test("P2-91C1 append, fsync, and close failures leave no accepted line and poison the run", () => {
  for (const failure of ["write", "fsync", "close"] as const) {
    const userDataPath = mkdtempSync(join(tmpdir(), `p2-91c-evidence-${failure}-`));
    let failed = false;
    const fileSystem = {
      closeSync(fd: number) {
        if (failure === "close" && !failed) { failed = true; throw new Error("private close"); }
        return fs.closeSync(fd);
      },
      existsSync: fs.existsSync,
      fsyncSync(fd: number) {
        if (failure === "fsync" && !failed) { failed = true; throw new Error("private fsync"); }
        return fs.fsyncSync(fd);
      },
      mkdirSync: fs.mkdirSync,
      openSync: fs.openSync,
      readFileSync: fs.readFileSync,
      readdirSync: fs.readdirSync,
      statSync: fs.statSync,
      truncateSync: fs.truncateSync,
      writeSync(fd: number, data: string) {
        if (failure === "write" && !failed) { failed = true; fs.writeSync(fd, data.slice(0, 4)); throw new Error("private write"); }
        return fs.writeSync(fd, data);
      }
    } as typeof fs;
    try {
      const service = createAcceptanceEvidenceService({
        userDataPath, isPackaged: false, acceptanceTelemetryEnabled: true, runId: RUN_ID,
        p288bFixtureEnabled: true, fileSystem
      });
      const event = { type: "dialogue_affect_action_dispatch", payload: { status: "accepted", reason: "accepted", requestId: "f".repeat(32) } };
      assert.equal(service.report(event), false);
      assert.equal(service.report(event), false);
      assert.equal(service.close(), false);
      const result = readAcceptanceEvidence({ userDataPath, runId: RUN_ID, expectedSuite: "p2-88b" });
      assert.equal(result.ok, true);
      if (result.ok) assert.equal(result.events.length, 0);
    } finally {
      rmSync(userDataPath, { recursive: true, force: true });
    }
  }
});

test("P2-91C1 acceptance evidence round-trips one strict P2-85 observation at the fixed path", () => {
  const userDataPath = mkdtempSync(join(tmpdir(), "p2-91c-evidence-p285-"));
  try {
    const service = createAcceptanceEvidenceService({
      userDataPath,
      isPackaged: false,
      acceptanceTelemetryEnabled: true,
      runId: RUN_ID,
      p285ObservationEnabled: true,
      p285FixtureEnabled: true
    });
    assert.equal(service.enabled, true);
    assert.equal(service.report({
      type: "p2_85_acceptance_observation",
      payload: {
        scenarioId: "chat_opened_replace_active",
        runtimeBoundary: "live_renderer_chain",
        actionAttempted: true,
        requestId: "a".repeat(32),
        replacedRequestId: "b".repeat(32),
        replacementAccepted: true,
        lateLifecycleIgnored: true,
        terminalObserved: true
      }
    }), true);
    assert.equal(service.close(), true);
    assert.equal(service.filePath, join(userDataPath, "acceptance-evidence", `${RUN_ID}.ndjson`));
    const result = readAcceptanceEvidence({ userDataPath, runId: RUN_ID, expectedSuite: "p2-85" });
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.events.length, 1);
  } finally {
    rmSync(userDataPath, { recursive: true, force: true });
  }
});
