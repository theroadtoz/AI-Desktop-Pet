import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  cleanupAttentionRun,
  finalizeAttentionModeResult,
  runWindowsAcceptanceCommand,
  resolveBundledPackRoot,
  validateBlockedTransitionSequence,
  validatePositiveTransitionSequence
} from "./p2-88e-attention-micro-cue-real-ui.mjs";
import { readFileSync } from "node:fs";
import {
  parseInnerSummary,
  runAttentionPostExitAcceptance,
  verifyAttentionPostExit
} from "./p2-91b-attention-post-exit-verifier.mjs";

test("P2-91B Windows acceptance commands fail closed on error, signal, or nonzero status", () => {
  for (const result of [
    { status: null, signal: null, error: new Error("spawn failed"), stdout: "" },
    { status: null, signal: "SIGTERM", stdout: "" },
    { status: 1, signal: null, stdout: "" }
  ]) {
    assert.equal(
      runWindowsAcceptanceCommand("tasklist.exe", [], () => result).ok,
      false
    );
  }
  assert.deepEqual(
    runWindowsAcceptanceCommand("tasklist.exe", [], () => ({
      status: 0,
      signal: null,
      stdout: "clean"
    })),
    { ok: true, stdout: "clean" }
  );
});

test("P2-91B real UI verifies the default cue with no rollout override and explicit zero off", () => {
  const source = readFileSync("scripts/p2-88e-attention-micro-cue-real-ui.mjs", "utf8");
  assert.match(source, /summary\.checks = \{ off, defaultOn \}/);
  assert.match(source, /rollout \? \{\} : \{ AI_DESKTOP_PET_ATTENTION_MICRO_CUE_ROLLOUT: "0" \}/);
  assert.doesNotMatch(source, /AI_DESKTOP_PET_ATTENTION_MICRO_CUE_ROLLOUT: rollout \? "1"/);
});

test("P2-91B attention cleanup kills a recorded child tree even after the launcher exited", async () => {
  const killed: number[] = [];
  const context = {
    child: { pid: 4100, exitCode: 0, signalCode: null },
    p288eOwnedPids: new Set([4100, 4200]),
    port: 9751,
    runParentDir: "C:\\repo\\.tmp\\p2-88e-run"
  };
  const cleanup = await cleanupAttentionRun(context, {
    discoverProcessTree: () => ({
      ok: true,
      processes: [{ pid: 4100, name: "electron.exe" }, { pid: 4200, name: "llama-server.exe" }]
    }),
    stopElectron: async () => {},
    terminateProcessTree: async (pid: number) => { killed.push(pid); return true; },
    inspectProcess: async () => ({ ok: true, alive: true }),
    cleanupRun: () => {},
    inspectResidue: async () => ({
      ok: true,
      liveOwnedPids: [],
      listeningPorts: [],
      liveOwnedLlamaPids: [],
      tmpExists: false
    })
  });

  assert.deepEqual(killed, [4100, 4200]);
  assert.equal(cleanup.ok, true);
});

test("P2-91B attention cleanup cannot pass when owned process discovery fails", async () => {
  const cleanup = await cleanupAttentionRun({
    child: { pid: 4100, exitCode: null, signalCode: null },
    port: 9751,
    runParentDir: "C:\\repo\\.tmp\\p2-88e-run"
  }, {
    discoverProcessTree: () => ({ ok: false, processes: [] }),
    inspectProcess: async () => ({ ok: true, alive: false }),
    stopElectron: async () => {},
    terminateProcessTree: async () => true,
    cleanupRun: () => {},
    inspectResidue: async () => ({
      ok: true,
      liveOwnedPids: [],
      listeningPorts: [],
      liveOwnedLlamaPids: [],
      tmpExists: false
    })
  });

  assert.equal(cleanup.ok, false);
  assert.equal(cleanup.processDiscoveryOk, false);
});

test("P2-91B tasklist, taskkill, or netstat failure makes cleanup fail closed", async () => {
  const baseContext = {
    child: { pid: 4100, exitCode: null, signalCode: null },
    port: 9751,
    runParentDir: "C:\\repo\\.tmp\\p2-88e-run"
  };
  const baseDependencies = {
    discoverProcessTree: () => ({ ok: true, processes: [{ pid: 4100, name: "electron.exe" }] }),
    stopElectron: async () => {},
    cleanupRun: () => {},
    inspectResidue: async () => ({
      ok: true,
      liveOwnedPids: [],
      listeningPorts: [],
      liveOwnedLlamaPids: [],
      tmpExists: false
    })
  };
  const tasklistFailure = await cleanupAttentionRun({ ...baseContext }, {
    ...baseDependencies,
    inspectProcess: async () => ({ ok: false, alive: false }),
    terminateProcessTree: async () => true
  });
  assert.equal(tasklistFailure.ok, false);

  const taskkillFailure = await cleanupAttentionRun({ ...baseContext }, {
    ...baseDependencies,
    inspectProcess: async () => ({ ok: true, alive: true }),
    terminateProcessTree: async () => false
  });
  assert.equal(taskkillFailure.ok, false);

  const netstatFailure = await cleanupAttentionRun({ ...baseContext }, {
    ...baseDependencies,
    inspectProcess: async () => ({ ok: true, alive: false }),
    terminateProcessTree: async () => true,
    inspectResidue: async () => ({
      ok: false,
      liveOwnedPids: [],
      listeningPorts: [],
      liveOwnedLlamaPids: [],
      tmpExists: false
    })
  });
  assert.equal(netstatFailure.ok, false);
});

test("P2-91B outer verifier requires complete mode cleanup evidence before post-exit inspection", () => {
  const summary = {
    ok: true,
    checks: {
      off: {
        ok: true,
        cleanup: {
          ok: true,
          processDiscoveryOk: true,
          rootPid: 4100,
          ownedPids: [4100],
          ownedLlamaPids: [4200],
          liveOwnedPids: [],
          listeningPorts: [],
          liveOwnedLlamaPids: [],
          tmpExists: false,
          runParentDir: "E:\\repo\\.tmp\\p2-88e-attention-micro-cue-real-ui-off"
        }
      },
      defaultOn: {
        ok: true,
        cleanup: {
          ok: true,
          processDiscoveryOk: true,
          rootPid: 4300,
          ownedPids: [4300],
          ownedLlamaPids: [4400],
          liveOwnedPids: [],
          listeningPorts: [],
          liveOwnedLlamaPids: [],
          tmpExists: false,
          runParentDir: "E:\\repo\\.tmp\\p2-88e-attention-micro-cue-real-ui-default"
        }
      }
    }
  };
  const clean = {
    inspectProcess: () => ({ ok: true, alive: false }),
    inspectPorts: () => ({ ok: true, ports: [] }),
    pathExists: () => false,
    expectedRunParentDirs: [
      "E:\\repo\\.tmp\\p2-88e-attention-micro-cue-real-ui-off",
      "E:\\repo\\.tmp\\p2-88e-attention-micro-cue-real-ui-default"
    ]
  };
  assert.equal(verifyAttentionPostExit(summary, clean).ok, true);
  assert.equal(verifyAttentionPostExit(summary, {
    ...clean,
    inspectProcess: (pid: number) => ({ ok: true, alive: pid === 4300 })
  }).ok, false);
  assert.equal(verifyAttentionPostExit(summary, {
    ...clean,
    inspectProcess: (pid: number) => ({ ok: true, alive: pid === 4400 })
  }).ok, false);
  assert.equal(verifyAttentionPostExit(summary, {
    ...clean,
    inspectPorts: () => ({ ok: true, ports: [9751] })
  }).ok, false);
  assert.equal(verifyAttentionPostExit(summary, {
    ...clean,
    inspectPorts: () => ({ ok: false, ports: [] })
  }).ok, false);
  assert.equal(verifyAttentionPostExit(summary, {
    ...clean,
    pathExists: (path: string) => path.endsWith("default")
  }).ok, false);
  assert.equal(verifyAttentionPostExit(summary, {
    ...clean,
    inspectProcess: () => ({ ok: false, alive: false })
  }).ok, false);
  assert.equal(verifyAttentionPostExit({ ok: true, checks: {} }, clean).ok, false);
  for (const mutate of [
    (copy: typeof summary) => { copy.checks.off.ok = false; },
    (copy: typeof summary) => { copy.checks.defaultOn.cleanup.ok = false; },
    (copy: typeof summary) => { copy.checks.off.cleanup.processDiscoveryOk = false; },
    (copy: typeof summary) => { copy.checks.off.cleanup.ownedPids = []; },
    (copy: typeof summary) => { copy.checks.off.cleanup.ownedPids = [4999]; },
    (copy: typeof summary) => { copy.checks.defaultOn.cleanup.ownedLlamaPids = []; },
    (copy: typeof summary) => { copy.checks.off.cleanup.liveOwnedPids = [4100]; },
    (copy: typeof summary) => { copy.checks.defaultOn.cleanup.listeningPorts = [9751]; },
    (copy: typeof summary) => { copy.checks.off.cleanup.liveOwnedLlamaPids = [4200]; },
    (copy: typeof summary) => { copy.checks.defaultOn.cleanup.tmpExists = true; },
    (copy: typeof summary) => { copy.checks.off.cleanup.runParentDir = "E:\\outside\\fake"; },
    (copy: typeof summary) => { copy.checks.defaultOn.cleanup.runParentDir = copy.checks.off.cleanup.runParentDir; }
  ]) {
    const invalid = structuredClone(summary);
    mutate(invalid);
    assert.equal(verifyAttentionPostExit(invalid, clean).ok, false);
  }
  for (const removeField of [
    (copy: typeof summary) => { delete (copy.checks.off as { cleanup?: unknown }).cleanup; },
    (copy: typeof summary) => { delete (copy.checks.off.cleanup as { ok?: boolean }).ok; },
    (copy: typeof summary) => { delete (copy.checks.off.cleanup as { processDiscoveryOk?: boolean }).processDiscoveryOk; },
    (copy: typeof summary) => { delete (copy.checks.off.cleanup as { rootPid?: number }).rootPid; },
    (copy: typeof summary) => { delete (copy.checks.off.cleanup as { ownedPids?: number[] }).ownedPids; },
    (copy: typeof summary) => { delete (copy.checks.off.cleanup as { ownedLlamaPids?: number[] }).ownedLlamaPids; },
    (copy: typeof summary) => { delete (copy.checks.off.cleanup as { liveOwnedPids?: number[] }).liveOwnedPids; },
    (copy: typeof summary) => { delete (copy.checks.off.cleanup as { listeningPorts?: number[] }).listeningPorts; },
    (copy: typeof summary) => { delete (copy.checks.off.cleanup as { liveOwnedLlamaPids?: number[] }).liveOwnedLlamaPids; },
    (copy: typeof summary) => { delete (copy.checks.off.cleanup as { tmpExists?: boolean }).tmpExists; },
    (copy: typeof summary) => { delete (copy.checks.off.cleanup as { runParentDir?: string }).runParentDir; }
  ]) {
    const invalid = structuredClone(summary);
    removeField(invalid);
    assert.equal(verifyAttentionPostExit(invalid, clean).ok, false);
  }
});

test("P2-91B outer runner rejects multi-JSON output, nonzero exit, and timeout", () => {
  assert.equal(parseInnerSummary('{"ok":true}\n{"ok":true}\n'), null);
  const successfulInner = {
    status: 0,
    signal: null,
    error: undefined,
    stdout: '{"ok":true}\n'
  };
  const verified = runAttentionPostExitAcceptance({
    spawnInner: () => successfulInner,
    verifyPostExit: () => ({ ok: true })
  });
  assert.equal(verified.ok, true);
  assert.equal(verified.innerProcessOk, true);
  for (const inner of [
    { ...successfulInner, status: 1 },
    { ...successfulInner, status: null, signal: "SIGTERM" },
    { ...successfulInner, status: null, error: new Error("ETIMEDOUT") }
  ]) {
    const rejected = runAttentionPostExitAcceptance({
      spawnInner: () => inner,
      verifyPostExit: () => ({ ok: true })
    });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.innerProcessOk, false);
    assert.equal(rejected.inner, null);
  }
});

test("P2-91B acceptance command uses the outer verifier and runs the production integration contract", () => {
  const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
  assert.match(
    packageJson.scripts["accept:p2-91b-attention"],
    /scripts\/p2-91b-attention-post-exit-verifier\.mjs/u
  );
  assert.match(
    packageJson.scripts["test:p2-91b-contract"],
    /scripts\/p2-91b-affect-presentation-integration\.test\.mts/u
  );
});

test("P2-91B production cleanup commands keep exact Windows tree and listener parameters", () => {
  const inner = readFileSync("scripts/p2-88e-attention-micro-cue-real-ui.mjs", "utf8");
  const outer = readFileSync("scripts/p2-91b-attention-post-exit-verifier.mjs", "utf8");
  assert.match(inner, /Get-CimInstance Win32_Process/u);
  assert.match(inner, /"taskkill\.exe", \["\/PID", String\(pid\), "\/T", "\/F"\]/u);
  assert.match(inner, /"tasklist\.exe", \["\/FI", `PID eq \$\{pid\}`, "\/FO", "CSV", "\/NH"\]/u);
  assert.match(inner, /"netstat\.exe", \["-ano", "-p", "tcp"\]/u);
  assert.match(outer, /scripts\/p2-88e-attention-micro-cue-real-ui\.mjs/u);
  assert.match(outer, /verifyPostExit\(summary\)/u);
});

test("P2-91B attention summary cannot claim ok while owned PID, port, llama, or tmp residue remains", () => {
  const functionalPass = { ok: true, rollout: true };
  for (const residue of [
    { liveOwnedPids: [4200], listeningPorts: [], liveOwnedLlamaPids: [], tmpExists: false },
    { liveOwnedPids: [], listeningPorts: [9751], liveOwnedLlamaPids: [], tmpExists: false },
    { liveOwnedPids: [], listeningPorts: [], liveOwnedLlamaPids: [4300], tmpExists: false },
    { liveOwnedPids: [], listeningPorts: [], liveOwnedLlamaPids: [], tmpExists: true }
  ]) {
    assert.equal(finalizeAttentionModeResult(functionalPass, { ok: false, ...residue }).ok, false);
  }
});

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
