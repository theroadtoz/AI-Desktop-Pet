import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  resolveBundledPackRoot,
  validateBlockedTransitionSequence,
  validatePositiveTransitionSequence
} from "./p2-88e-attention-micro-cue-real-ui.mjs";

test("P2-88E bundled acceptance freezes the repository pack root and rejects an external override", () => {
  const realpath = (path: string): string => path.replaceAll("/", "\\");
  const defaultResolution = resolveBundledPackRoot({
    repoRoot: "C:/repo",
    override: "",
    realpath
  });
  assert.deepEqual(defaultResolution, {
    ok: true,
    bundledRootExact: true,
    packRoot: "C:\\repo\\resources\\local-llm"
  });

  const exactOverride = resolveBundledPackRoot({
    repoRoot: "C:/repo",
    override: "c:/REPO/resources/local-llm",
    realpath
  });
  assert.equal(exactOverride.ok, true);
  assert.equal(exactOverride.bundledRootExact, true);

  assert.deepEqual(resolveBundledPackRoot({
    repoRoot: "C:/repo",
    override: "D:/external/local-llm",
    realpath
  }), {
    ok: false,
    bundledRootExact: false,
    failure: "external_source_override"
  });
});

test("P2-88E bundled root resolution fails closed without exposing a path", () => {
  const failed = resolveBundledPackRoot({
    repoRoot: "C:/repo",
    override: "",
    realpath: () => { throw new Error("sensitive path"); }
  });
  assert.deepEqual(failed, {
    ok: false,
    bundledRootExact: false,
    failure: "bundled_root_unavailable"
  });
  assert.doesNotMatch(JSON.stringify(failed), /C:|sensitive/u);
});

test("P2-88E polluted source override exits before Electron and cannot claim bundled evidence", () => {
  const child = spawnSync(process.execPath, [
    "--no-warnings",
    "scripts/p2-88e-attention-micro-cue-real-ui.mjs"
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AI_DESKTOP_PET_LOCAL_LLM_SOURCE_ROOT: "Z:\\p2-88e-external-source"
    },
    encoding: "utf8",
    timeout: 10_000
  });
  assert.equal(child.status, 1);
  const summary = JSON.parse(child.stdout.trim());
  assert.deepEqual(summary, {
    ok: false,
    runtimePath: "preflight",
    provider: "unproven",
    bundledRootExact: false,
    failure: "external_source_override"
  });
  assert.doesNotMatch(child.stdout, /Z:|resources[\\/]local-llm|embedded-llama-cpp/u);
});

test("P2-88E positive transition contract requires one ordered start and one terminal", () => {
  assert.deepEqual(validatePositiveTransitionSequence([
    { accepted: true, status: "started" },
    { accepted: false, status: "owner-active" }
  ]), {
    ok: true,
    transitionCount: 2,
    startedCount: 1,
    terminalCount: 1,
    ordered: true,
    replayed: false,
    releasedAfterOwnershipLoss: false,
    terminalStatus: "owner-active"
  });
  assert.equal(validatePositiveTransitionSequence([
    { accepted: false, status: "owner-active" },
    { accepted: true, status: "started" }
  ]).ok, false);
  assert.equal(validatePositiveTransitionSequence([
    { accepted: true, status: "started" },
    { accepted: true, status: "started" },
    { accepted: false, status: "owner-active" }
  ]).ok, false);
  assert.equal(validatePositiveTransitionSequence([
    { accepted: true, status: "started" },
    { accepted: false, status: "owner-active" },
    { accepted: true, status: "released" }
  ]).ok, false);
});

test("P2-88E blocked transition contract rejects conflict or recovery that starts first", () => {
  assert.deepEqual(validateBlockedTransitionSequence([
    { accepted: false, status: "owner-active" }
  ], "owner-active"), {
    ok: true,
    transitionCount: 1,
    startedCount: 0,
    releasedCount: 0,
    blockedCount: 1,
    exactBlockedOnly: true
  });
  assert.equal(validateBlockedTransitionSequence([
    { accepted: true, status: "started" },
    { accepted: false, status: "owner-active" }
  ], "owner-active").ok, false);
  assert.equal(validateBlockedTransitionSequence([
    { accepted: true, status: "started" },
    { accepted: false, status: "recovering" }
  ], "recovering").ok, false);
  assert.equal(validateBlockedTransitionSequence([
    { accepted: false, status: "recovering" },
    { accepted: true, status: "released" }
  ], "recovering").ok, false);
});
