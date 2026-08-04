import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runWindowsAcceptanceCommand } from "./p2-88e-attention-micro-cue-real-ui.mjs";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

function inspectProcess(pid) {
  const result = runWindowsAcceptanceCommand(
    "tasklist.exe",
    ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"]
  );
  return {
    ok: result.ok,
    alive: result.ok && new RegExp(`"[^\"]+","${pid}"`, "u").test(result.stdout)
  };
}

function inspectPorts() {
  const result = runWindowsAcceptanceCommand("netstat.exe", ["-ano", "-p", "tcp"]);
  return {
    ok: result.ok,
    ports: result.ok
      ? [...result.stdout.matchAll(/^\s*TCP\s+\S+:(9750|9751)\s+\S+\s+LISTENING\s+\d+\s*$/gimu)]
        .map((match) => Number(match[1]))
      : []
  };
}

function readCleanupEvidence(summary, expectedRunParentDirs) {
  if (summary?.ok !== true || !summary.checks || typeof summary.checks !== "object") return null;
  const defaultRunParentDirs = [
    resolve(root, ".tmp", "p2-88e-attention-micro-cue-real-ui-off"),
    resolve(root, ".tmp", "p2-88e-attention-micro-cue-real-ui-default")
  ];
  const runParentDirs = expectedRunParentDirs ?? defaultRunParentDirs;
  const modes = [summary.checks.off, summary.checks.defaultOn];
  if (modes.some((mode) => mode?.ok !== true || !mode?.cleanup || typeof mode.cleanup !== "object")) return null;
  const cleanups = modes.map((mode) => mode.cleanup);
  if (cleanups.some((cleanup) =>
    cleanup.ok !== true ||
    cleanup.processDiscoveryOk !== true ||
    !Number.isSafeInteger(cleanup.rootPid) || cleanup.rootPid <= 0 ||
    !Array.isArray(cleanup.ownedPids) ||
    !Array.isArray(cleanup.ownedLlamaPids) ||
    !Array.isArray(cleanup.liveOwnedPids) || cleanup.liveOwnedPids.length !== 0 ||
    !Array.isArray(cleanup.listeningPorts) || cleanup.listeningPorts.length !== 0 ||
    !Array.isArray(cleanup.liveOwnedLlamaPids) || cleanup.liveOwnedLlamaPids.length !== 0 ||
    cleanup.tmpExists !== false ||
    typeof cleanup.runParentDir !== "string" ||
    cleanup.runParentDir.length === 0 ||
    cleanup.ownedPids.length === 0 ||
    cleanup.ownedLlamaPids.length === 0 ||
    !cleanup.ownedPids.includes(cleanup.rootPid))) {
    return null;
  }
  if (!Array.isArray(runParentDirs) || runParentDirs.length !== cleanups.length) return null;
  if (cleanups.some((cleanup, index) => cleanup.runParentDir !== runParentDirs[index])) return null;
  if (new Set(cleanups.map((cleanup) => cleanup.runParentDir)).size !== cleanups.length) return null;
  const ownedPids = [...new Set(cleanups.flatMap((cleanup) => cleanup.ownedPids))];
  const ownedLlamaPids = [...new Set(cleanups.flatMap((cleanup) => cleanup.ownedLlamaPids))];
  if ([...ownedPids, ...ownedLlamaPids].some((pid) => !Number.isSafeInteger(pid) || pid <= 0)) return null;
  return {
    ownedPids,
    ownedLlamaPids,
    runParentDirs: cleanups.map((cleanup) => cleanup.runParentDir)
  };
}

export function verifyAttentionPostExit(summary, dependencies = {}) {
  const evidence = readCleanupEvidence(summary, dependencies.expectedRunParentDirs);
  if (!evidence) return { ok: false, failure: "invalid_inner_cleanup_evidence" };
  const inspectPid = dependencies.inspectProcess ?? inspectProcess;
  const inspectAcceptancePorts = dependencies.inspectPorts ?? inspectPorts;
  const pathExists = dependencies.pathExists ?? existsSync;
  const pidResults = evidence.ownedPids.map((pid) => ({ pid, ...inspectPid(pid) }));
  const llamaResults = evidence.ownedLlamaPids.map((pid) => ({ pid, ...inspectPid(pid) }));
  const portResult = inspectAcceptancePorts();
  const existingRunParentDirs = evidence.runParentDirs.filter(pathExists);
  const ok = pidResults.every((result) => result.ok && !result.alive) &&
    llamaResults.every((result) => result.ok && !result.alive) &&
    portResult.ok === true && portResult.ports.length === 0 &&
    existingRunParentDirs.length === 0;
  return {
    ok,
    checkedOwnedPids: evidence.ownedPids,
    checkedOwnedLlamaPids: evidence.ownedLlamaPids,
    listeningPorts: portResult.ports,
    existingRunParentDirs,
    inspectionFailed: pidResults.some((result) => !result.ok) ||
      llamaResults.some((result) => !result.ok) || portResult.ok !== true
  };
}

export function parseInnerSummary(stdout) {
  const lines = String(stdout ?? "").split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  if (lines.length !== 1) return null;
  try {
    return JSON.parse(lines[0]);
  } catch {
    return null;
  }
}

export function runAttentionPostExitAcceptance(dependencies = {}) {
  const spawnInner = dependencies.spawnInner ?? spawnSync;
  const verifyPostExit = dependencies.verifyPostExit ?? verifyAttentionPostExit;
  const inner = spawnInner(
    process.execPath,
    ["--no-warnings", "scripts/p2-88e-attention-micro-cue-real-ui.mjs"],
    { cwd: root, encoding: "utf8", windowsHide: true, timeout: 1_300_000 }
  );
  const summary = !inner.error && !inner.signal && inner.status === 0
    ? parseInnerSummary(inner.stdout)
    : null;
  const postExit = verifyPostExit(summary);
  return {
    ok: summary?.ok === true && postExit.ok,
    inner: summary,
    postExit,
    innerProcessOk: !inner.error && !inner.signal && inner.status === 0
  };
}

function main() {
  const result = runAttentionPostExitAcceptance();
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
