import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import {
  assertNoScreenshotResidue,
  connectToElectron,
  createRealUiRunContext,
  evaluate,
  sleep,
  startElectron,
  waitFor,
  waitForWindow
} from "./support/real-ui-harness.mjs";
import {
  P2_85_EVIDENCE_BOUNDARY_SUMMARY,
  P2_85_SCENARIO_IDS,
  cleanupP285ProductionContext,
  getP285AcceptanceEnvironment,
  getP285ElectronArgs,
  inspectP285AcceptanceHooks,
  readP285Telemetry,
  resetP285AcceptanceBaseline,
  resolveP285RenderMode,
  validateScenarioObservation,
  waitForP285Observation
} from "./p2-85-context-emotion-proactive-real-ui.mjs";

const execFileAsync = promisify(execFile);
const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const APP_PATH = join(ROOT, "src", "main", "app.ts");
const ACCEPTANCE_SCENARIOS_PATH = join(ROOT, "src", "main", "services", "companion-context", "p2-85-acceptance-scenarios.ts");
const PET_PRELOAD_PATH = join(ROOT, "src", "preload", "pet-preload.ts");
const IPC_CONTRACT_PATH = join(ROOT, "src", "shared", "ipc-contract.ts");

export const P2_85_SOAK_DEFAULT_DURATION_MS = 20 * 60_000;
export const P2_85_SOAK_DEFAULT_INTERVAL_MS = 60_000;
export const P2_85_SOAK_EVIDENCE_BOUNDARY_SUMMARY = [
  P2_85_EVIDENCE_BOUNDARY_SUMMARY,
  "single continuous production Electron with fake acceptance fixtures;",
  "resource samples describe this host process only;",
  "not real OS media/game, model quality, user-affect understanding, MCP, or visual-review evidence"
].join(" ");

function parsePositiveInteger(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum) return fallback;
  return Math.min(parsed, maximum);
}

export function resolveP285SoakConfig(env = process.env) {
  const durationMs = parsePositiveInteger(
    env.P2_85_SOAK_DURATION_MS,
    P2_85_SOAK_DEFAULT_DURATION_MS,
    1_000,
    8 * 60 * 60_000
  );
  const requestedIntervalMs = parsePositiveInteger(
    env.P2_85_SOAK_INTERVAL_MS,
    P2_85_SOAK_DEFAULT_INTERVAL_MS,
    250,
    30 * 60_000
  );
  const intervalMs = Math.min(requestedIntervalMs, durationMs);
  const qualifiesAsTwentyMinuteSoak = durationMs >= P2_85_SOAK_DEFAULT_DURATION_MS;
  return Object.freeze({
    durationMs,
    intervalMs,
    plannedInvocationCount: Math.max(1, Math.ceil(durationMs / intervalMs)),
    qualifiesAsTwentyMinuteSoak,
    runQualification: qualifiesAsTwentyMinuteSoak ? "twenty_minute_or_longer" : "short_non_qualifying"
  });
}

export function normalizeP285ProcessSample(sample = {}) {
  return {
    mainAlive: sample.mainAlive === true,
    cdpAvailable: sample.cdpAvailable === true,
    processCount: Math.max(0, Number(sample.processCount) || 0),
    workingSetBytes: Math.max(0, Number(sample.workingSetBytes) || 0),
    cpuTimeSeconds: Math.max(0, Number(sample.cpuTimeSeconds) || 0)
  };
}

export function evaluateP285SoakTrend(samples) {
  const normalized = samples.map(normalizeP285ProcessSample);
  const first = normalized.at(0) ?? null;
  const last = normalized.at(-1) ?? null;
  const processCounts = normalized.map((sample) => sample.processCount);
  const strictlyGrowingProcessCount = processCounts.length >= 4 &&
    processCounts.every((count, index) => index === 0 || count > processCounts[index - 1]);
  const cpuTimeRegressed = normalized.some((sample, index) =>
    index > 0 && sample.cpuTimeSeconds < normalized[index - 1].cpuTimeSeconds
  );
  return {
    sampleCount: normalized.length,
    mainAliveThroughout: normalized.every((sample) => sample.mainAlive),
    cdpAvailableThroughout: normalized.every((sample) => sample.cdpAvailable),
    cpuTimeRegressed,
    processCountStart: first?.processCount ?? 0,
    processCountEnd: last?.processCount ?? 0,
    processCountDelta: first && last ? last.processCount - first.processCount : 0,
    processCountStrictlyGrowing: strictlyGrowingProcessCount,
    workingSetBytesStart: first?.workingSetBytes ?? 0,
    workingSetBytesEnd: last?.workingSetBytes ?? 0,
    workingSetBytesDelta: first && last ? last.workingSetBytes - first.workingSetBytes : 0,
    cpuTimeSecondsStart: first?.cpuTimeSeconds ?? 0,
    cpuTimeSecondsEnd: last?.cpuTimeSeconds ?? 0,
    cpuTimeSecondsDelta: first && last ? last.cpuTimeSeconds - first.cpuTimeSeconds : 0
  };
}

export function isP285SoakTrendAcceptable(trend) {
  return trend.mainAliveThroughout && trend.cdpAvailableThroughout &&
    !trend.cpuTimeRegressed && !trend.processCountStrictlyGrowing;
}

export function createP285SoakScenarioPlan(invocationCount) {
  const count = Math.max(0, Math.floor(Number(invocationCount) || 0));
  return Array.from({ length: count }, (_, index) =>
    P2_85_SCENARIO_IDS[index % P2_85_SCENARIO_IDS.length]
  );
}

export function serializeP285SoakFailure(error) {
  if (!error) return null;
  return {
    name: error instanceof Error ? error.name : typeof error,
    message: error instanceof Error ? error.message : "unknown_failure"
  };
}

async function sampleP285ProductionProcess(pid) {
  const numericPid = Number(pid);
  if (!Number.isSafeInteger(numericPid) || numericPid <= 0) {
    throw new Error("invalid_electron_pid");
  }
  const command = `
$rootPid = ${numericPid}
$records = @(Get-CimInstance Win32_Process)
$pending = [System.Collections.Generic.Queue[int]]::new()
$seen = [System.Collections.Generic.HashSet[int]]::new()
$pending.Enqueue($rootPid)
while ($pending.Count -gt 0) {
  $current = $pending.Dequeue()
  if (-not $seen.Add($current)) { continue }
  foreach ($child in $records | Where-Object { $_.ParentProcessId -eq $current }) {
    $pending.Enqueue([int]$child.ProcessId)
  }
}
$live = @()
foreach ($id in $seen) {
  $process = Get-Process -Id $id -ErrorAction SilentlyContinue
  if ($null -ne $process) { $live += $process }
}
[pscustomobject]@{
  mainAlive = [bool]($live | Where-Object { $_.Id -eq $rootPid })
  processCount = @($live).Count
  processIds = @($live | ForEach-Object { [int]$_.Id })
  workingSetBytes = [Int64](($live | Measure-Object -Property WorkingSet64 -Sum).Sum)
  cpuTimeSeconds = [double](($live | Measure-Object -Property CPU -Sum).Sum)
} | ConvertTo-Json -Compress
`;
  const { stdout } = await execFileAsync("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    command
  ], { windowsHide: true, timeout: 10_000, maxBuffer: 64 * 1024 });
  const parsed = JSON.parse(stdout);
  const rawProcessIds = Array.isArray(parsed.processIds) ? parsed.processIds : [parsed.processIds];
  return {
    ...normalizeP285ProcessSample(parsed),
    processIds: rawProcessIds.filter((id) => Number.isSafeInteger(id) && id > 0)
  };
}

async function isP285CdpPortReleased(port) {
  try {
    await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1_000) });
    return false;
  } catch {
    return true;
  }
}

async function waitForP285OwnedProcessExit(processIds, timeoutMs = 10_000) {
  const ids = [...new Set(processIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  if (ids.length === 0) return true;
  const command = `$ids = @(${ids.join(",")}); @($ids | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue }).Count`;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { stdout } = await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      command
    ], { windowsHide: true, timeout: 5_000, maxBuffer: 1024 });
    if (Number(stdout.trim()) === 0) return true;
    await sleep(250);
  }
  return false;
}

async function runP285SoakScenario(context, pet, scenarioId) {
  await resetP285AcceptanceBaseline(pet);
  const startIndex = readP285Telemetry(context).length;
  const accepted = await evaluate(
    pet,
    `window.petApi.runP285ScenarioForAcceptance(${JSON.stringify(scenarioId)})`
  );
  if (accepted !== true) throw new Error(`scenario_rejected:${scenarioId}`);
  const { observation } = await waitForP285Observation(context, startIndex, scenarioId);
  await sleep(250);
  const events = readP285Telemetry(context).slice(startIndex);
  const matchingObservations = events.filter((event) =>
    event.type === "p2_85_acceptance_observation" && event.payload?.scenarioId === scenarioId
  );
  if (matchingObservations.length !== 1) throw new Error(`non_unique_observation:${scenarioId}`);
  const validation = validateScenarioObservation(scenarioId, observation.payload, events);
  if (!validation.ok) throw new Error(`${scenarioId}:${validation.reason}`);
  return {
    scenarioId,
    requestId: observation.payload?.requestId ?? null,
    candidateCount: observation.payload?.proactiveCandidateCount ?? null
  };
}

function inspectP285SoakHooks() {
  return inspectP285AcceptanceHooks({
    appSource: readFileSync(APP_PATH, "utf8"),
    scenarioSource: readFileSync(ACCEPTANCE_SCENARIOS_PATH, "utf8"),
    petPreloadSource: readFileSync(PET_PRELOAD_PATH, "utf8"),
    ipcContractSource: readFileSync(IPC_CONTRACT_PATH, "utf8")
  });
}

export async function runP285ProductionSoak(config = resolveP285SoakConfig()) {
  const hooks = inspectP285SoakHooks();
  if (!hooks.ready) {
    return {
      ok: false,
      status: "blocked_missing_hooks",
      runtimePath: "not_started",
      evidenceBoundary: `${P2_85_SOAK_EVIDENCE_BOUNDARY_SUMMARY}; no production Electron claim because required hooks are absent`,
      missingHooks: hooks.requiredHooks,
      ...config
    };
  }
  const renderMode = resolveP285RenderMode();
  const context = createRealUiRunContext({
    runName: "p2-85-context-emotion-proactive-soak-real-ui",
    port: Number(process.env.P2_85_SOAK_CDP_PORT || 9736),
    env: getP285AcceptanceEnvironment(renderMode),
    tmpResiduePatterns: [/^p2-85-context-emotion-proactive-soak-real-ui$/i]
  });
  context.electronArgs = getP285ElectronArgs(renderMode);
  const observations = [];
  const samples = [];
  let cleanup = { electronStopped: false, runnerTmpRemoved: false, cdpPortReleased: false };
  let summary = null;
  let primaryFailure = null;
  let cleanupFailure = null;
  try {
    startElectron(context);
    await connectToElectron(context, 30_000);
    const pet = await waitForWindow(context, "renderer/pet/index.html", 30_000);
    await waitFor(pet, "Boolean(window.petApi?.runP285ScenarioForAcceptance)", { timeoutMs: 15_000 });
    const deadline = Date.now() + config.durationMs;
    let cycleIndex = 0;
    while (Date.now() < deadline) {
      const scenarioId = createP285SoakScenarioPlan(cycleIndex + 1).at(-1);
      if (!scenarioId) throw new Error("p2_85_missing_soak_scenario");
      observations.push(await runP285SoakScenario(context, pet, scenarioId));
      const processSample = await sampleP285ProductionProcess(context.child?.pid);
      await evaluate(pet, "true");
      samples.push({ ...processSample, cdpAvailable: true });
      cycleIndex += 1;
      const remainingMs = deadline - Date.now();
      if (remainingMs > 0) await sleep(Math.min(config.intervalMs, remainingMs));
    }
    assertNoScreenshotResidue(context);
    const trend = evaluateP285SoakTrend(samples);
    summary = {
      ok: isP285SoakTrendAcceptable(trend),
      status: config.qualifiesAsTwentyMinuteSoak ? "completed" : "completed_short_non_qualifying",
      runtimePath: "production_electron",
      renderMode,
      evidenceBoundary: P2_85_SOAK_EVIDENCE_BOUNDARY_SUMMARY,
      ...config,
      observationCount: observations.length,
      observations,
      trend
    };
  } catch (error) {
    primaryFailure = serializeP285SoakFailure(error);
  } finally {
    try {
      const baseCleanup = await cleanupP285ProductionContext(context);
      cleanup = {
        ...baseCleanup,
        cdpPortReleased: await isP285CdpPortReleased(context.port),
        ownedProcessTreeExited: await waitForP285OwnedProcessExit(samples.flatMap((sample) => sample.processIds ?? []))
      };
      if (!cleanup.electronStopped || !cleanup.runnerTmpRemoved || !cleanup.cdpPortReleased || !cleanup.ownedProcessTreeExited) {
        throw new Error("soak_cleanup_incomplete");
      }
    } catch (error) {
      cleanupFailure = serializeP285SoakFailure(error);
    }
  }
  if (primaryFailure || cleanupFailure) {
    const failure = new Error(primaryFailure?.message ?? cleanupFailure?.message ?? "p2_85_soak_failed");
    Object.assign(failure, { primaryFailure, cleanupFailure, cleanup });
    throw failure;
  }
  return { ...summary, cleanup };
}

async function main() {
  const config = resolveP285SoakConfig();
  try {
    const summary = await runP285ProductionSoak(config);
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (!summary.ok) process.exitCode = 1;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      ok: false,
      status: "failed",
      runtimePath: "production_electron",
      evidenceBoundary: P2_85_SOAK_EVIDENCE_BOUNDARY_SUMMARY,
      failureCode: error instanceof Error ? error.message : "unknown_failure",
      primaryFailure: error?.primaryFailure ?? serializeP285SoakFailure(error),
      cleanupFailure: error?.cleanupFailure ?? null,
      ...config
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
