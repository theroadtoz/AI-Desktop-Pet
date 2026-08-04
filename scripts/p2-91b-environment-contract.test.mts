import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import test from "node:test";
import {
  normalizeCompanionEnvironmentSignalInputs,
  normalizeCompanionEnvironmentSnapshot
} from "../src/main/services/desktop-context/companion-environment.ts";
import {
  parseMediaProbeResult,
  parseQunsProbeResult
} from "../src/main/services/desktop-context/windows-desktop-context-provider.ts";

const dependencyRoots = [
  "src/main/services/desktop-context/desktop-context-monitor.ts",
  "src/main/services/automatic-situation/coarse-user-state-coordinator.ts",
  "src/main/services/automatic-situation/automatic-situation-coordinator.ts",
  "src/main/services/proactive-companion/proactive-bubble-coordinator.ts",
  "src/main/services/companion-context/companion-context-arbitration-policy.ts"
] as const;

const directIntegrationRoots = ["src/main/app.ts"] as const;

const forbiddenCollectionSources = [
  /desktopCapturer/u,
  /getDisplayMedia/u,
  /getUserMedia/u,
  /mediaDevices/u,
  /Get-Process/u,
  /Win32_Process/u,
  /GetForegroundWindow/u,
  /MainWindowTitle/u,
  /TryGetMediaProperties/u,
  /SourceAppUserModelId/u,
  /TimelineProperties/u
] as const;

function findForbiddenCollectionSources(
  entries: readonly Readonly<{ path: string; source: string }>[]
): string[] {
  return entries.flatMap(({ path, source }) => forbiddenCollectionSources
    .filter((pattern) => pattern.test(source))
    .map((pattern) => `${path}: ${pattern}`));
}

function collectLocalDependencyCone(roots: readonly string[]): string[] {
  const pending = roots.map((path) => resolve(path));
  const visited = new Set<string>();
  while (pending.length > 0) {
    const path = pending.pop()!;
    if (visited.has(path)) continue;
    visited.add(path);
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(/(?:from\s+|import\s*\()(["'])(\.\.?\/[^"']+)\1/gu)) {
      const specifier = match[2];
      const candidate = resolve(dirname(path), specifier);
      const choices = extname(candidate)
        ? [candidate]
        : [`${candidate}.ts`, `${candidate}.mts`, `${candidate}.mjs`, resolve(candidate, "index.ts")];
      const dependency = choices.find((choice) => existsSync(choice));
      if (dependency && !visited.has(dependency)) pending.push(dependency);
    }
  }
  return [...visited].sort();
}

test("P2-91B environment dependency cone contains no forbidden collection source", () => {
  const dependencyCone = collectLocalDependencyCone(dependencyRoots);
  assert.ok(dependencyCone.length > dependencyRoots.length);
  assert.ok(dependencyCone.some((path) => path.endsWith("windows-desktop-context-provider.ts")));
  assert.ok(dependencyCone.some((path) => path.endsWith("companion-environment.ts")));
  const auditedPaths = [...dependencyCone, ...directIntegrationRoots.map((path) => resolve(path))];
  assert.ok(auditedPaths.some((path) => path.endsWith("src\\main\\app.ts")));
  assert.deepEqual(findForbiddenCollectionSources(auditedPaths.map((path) => ({
    path,
    source: readFileSync(path, "utf8")
  }))), []);

  const provider = readFileSync(
    "src/main/services/desktop-context/windows-desktop-context-provider.ts",
    "utf8"
  );
  assert.match(provider, /GetPlaybackInfo\(\)\.PlaybackStatus/);
  assert.doesNotMatch(provider, /title|artist|album|sourceAppId/iu);
});

test("P2-91B direct integration audit rejects a forbidden source mutation", () => {
  assert.deepEqual(
    findForbiddenCollectionSources([{ path: "src/main/app.ts", source: "desktopCapturer.getSources()" }]),
    ["src/main/app.ts: /desktopCapturer/u"]
  );
});

test("P2-91B environment status and probes expose exact closed keys only", () => {
  const preload = readFileSync("src/preload/chat-preload.ts", "utf8");
  assert.match(
    preload,
    /hasExactKeys\(status, \["providerStatus", "monitorStatus", "mediaCapability", "gameCapability"\]\)/
  );

  assert.deepEqual(parseMediaProbeResult('{"mediaPlaying":false,"mediaCapability":"available"}'), {
    status: "available",
    value: "stopped",
    capability: "available"
  });
  assert.deepEqual(parseQunsProbeResult('{"state":5}'), {
    status: "available",
    value: "allowed",
    capability: "available"
  });
  assert.equal(parseMediaProbeResult('{"mediaPlaying":false,"mediaCapability":"available","title":"x"}').status, "failed");
  assert.equal(parseQunsProbeResult('{"state":5,"windowTitle":"x"}').status, "failed");
});

test("P2-91B parser-boundary sentinel is rejected and cannot survive closed normalization", () => {
  const sentinel = "P2_91B_PRIVATE_SENTINEL_7f53";
  const signal = (value: string, source: string) => ({
    value,
    source,
    capability: "available",
    confidence: "high"
  });
  const inputs = {
    activity: signal("active", "power-monitor"),
    interruptibility: signal("allowed", "quns"),
    media: { ...signal("stopped", "gsmtc"), title: sentinel },
    game: signal("inactive", "user-explicit"),
    timeBand: signal("daytime", "local-clock")
  };
  assert.equal(normalizeCompanionEnvironmentSignalInputs(inputs), null);

  const snapshot = {
    schemaVersion: 1,
    revision: 1,
    updatedAtMs: 1,
    activity: { ...signal("active", "power-monitor"), changedAtMs: 1, stableSinceMs: 1 },
    interruptibility: { ...signal("allowed", "quns"), changedAtMs: 1, stableSinceMs: 1 },
    media: { ...signal("stopped", "gsmtc"), changedAtMs: 1, stableSinceMs: 1 },
    game: { ...signal("inactive", "user-explicit"), changedAtMs: 1, stableSinceMs: 1 },
    timeBand: { ...signal("daytime", "local-clock"), changedAtMs: 1, stableSinceMs: 1 },
    rawSnapshot: sentinel
  };
  const outputs = [
    normalizeCompanionEnvironmentSnapshot(snapshot),
    parseMediaProbeResult(JSON.stringify({
      mediaPlaying: false,
      mediaCapability: "available",
      title: sentinel
    })),
    parseQunsProbeResult(JSON.stringify({ state: 5, windowTitle: sentinel }))
  ];
  assert.equal(outputs[0], null);
  assert.doesNotMatch(JSON.stringify(outputs), new RegExp(sentinel));

});

test("P2-91B source audit keeps environment snapshots outside observable sinks", () => {
  for (const path of [
    "src/main/services/chat/chat-message-mapper.ts",
    "src/renderer/chat/main.ts",
    "src/preload/chat-preload.ts",
    "src/main/services/chat/history-store.ts",
    "src/main/services/chat/memory-store.ts"
  ]) {
    assert.doesNotMatch(readFileSync(path, "utf8"), /CompanionEnvironmentSnapshot|rawSnapshot/);
  }
});

test("P2-91B environment intents traverse proactive arbitration and the main action owner", () => {
  const app = readFileSync("src/main/app.ts", "utf8");
  const provider = readFileSync(
    "src/main/services/desktop-context/windows-desktop-context-provider.ts",
    "utf8"
  );
  const monitor = readFileSync("src/main/services/desktop-context/desktop-context-monitor.ts", "utf8");
  const setupStart = app.indexOf("proactiveBubbleCoordinator = createProactiveBubbleCoordinator");
  const setupEnd = app.indexOf("environmentActionSettingsStore =", setupStart);
  const setup = app.slice(setupStart, setupEnd);

  assert.match(setup, /requestAction: requestPetActionTrigger/);
  assert.match(setup, /resolveContextGate[\s\S]*"proactive-environment"/);
  assert.match(setup, /resolveCompanionContextArbitration/);
  assert.doesNotMatch(provider, /webContents\.send|ipcMain|ipcRenderer/);
  assert.doesNotMatch(monitor, /webContents\.send|pet:action-trigger|ipcMain|ipcRenderer/);
});

test("P2-91B real Electron evidence uses the production closed probes without injection", () => {
  const probe = readFileSync("scripts/p2-91b-windows-closed-probe.mjs", "utf8");
  const runner = readFileSync("scripts/p2-91b-environment-real-ui.mjs", "utf8");

  assert.match(probe, /createWindowsDesktopContextProvider\(\)/);
  assert.match(probe, /powerMonitor\.getSystemIdleTime\(\)/);
  assert.match(probe, /sampleInterruptibility\(\)/);
  assert.match(probe, /sampleMedia\(\)/);
  assert.match(runner, /electron\.exe/);
  assert.match(runner, /injectionUsed: false/);
  assert.match(runner, /taskkill\.exe/);
  assert.match(runner, /"\/T", "\/F"/);
  assert.match(runner, /hasOwnedProcessResidue/);
  assert.match(runner, /hasAcceptancePortResidue/);
  assert.match(runner, /existsSync\(appDirectory\)/);
  assert.doesNotMatch(`${probe}\n${runner}`, /SAFE_INJECTION|fixture|mock|fake|TryGetMediaProperties/iu);
});
