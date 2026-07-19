import { execFile, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, win32 } from "node:path";

export const GSMTC_CAPABILITY_PROTOTYPE_TARGETS = [
  "dev",
  "win-unpacked",
  "installer"
] as const;
export const GSMTC_CAPABILITY_PROTOTYPE_CAPABILITIES = [
  "available",
  "unavailable",
  "unknown"
] as const;
export const GSMTC_CAPABILITY_PROTOTYPE_STATUSES = [
  "playing",
  "stopped",
  "unknown"
] as const;
export const GSMTC_CAPABILITY_PROTOTYPE_HEALTH_VALUES = [
  "ready",
  "stopped",
  "error",
  "not-run"
] as const;
export const GSMTC_CAPABILITY_PROTOTYPE_FAILURE_CODES = [
  "none",
  "settings-disabled",
  "unsupported-platform",
  "capability-unavailable",
  "probe-timeout",
  "host-failed",
  "invalid-output",
  "target-not-run"
] as const;

export type GsmtcCapabilityPrototypeTarget = typeof GSMTC_CAPABILITY_PROTOTYPE_TARGETS[number];
export type GsmtcCapabilityPrototypeCapability = typeof GSMTC_CAPABILITY_PROTOTYPE_CAPABILITIES[number];
export type GsmtcCapabilityPrototypeStatus = typeof GSMTC_CAPABILITY_PROTOTYPE_STATUSES[number];
export type GsmtcCapabilityPrototypeHealth = typeof GSMTC_CAPABILITY_PROTOTYPE_HEALTH_VALUES[number];
export type GsmtcCapabilityPrototypeFailureCode = typeof GSMTC_CAPABILITY_PROTOTYPE_FAILURE_CODES[number];

export type GsmtcCapabilityPrototypeResult = {
  target: GsmtcCapabilityPrototypeTarget;
  capability: GsmtcCapabilityPrototypeCapability;
  status: GsmtcCapabilityPrototypeStatus;
  health: GsmtcCapabilityPrototypeHealth;
  failureCode: GsmtcCapabilityPrototypeFailureCode;
};

export type GsmtcCapabilityPrototypeCommandRunner = {
  execute(target: GsmtcCapabilityPrototypeTarget): Promise<string>;
  cancel(): void;
  dispose(): void;
};

type ResultValues = Omit<GsmtcCapabilityPrototypeResult, "target">;

const RESULT_KEYS = ["target", "capability", "status", "health", "failureCode"] as const;
const OUTPUT_DIRECTORY = join(".tmp", "p2-82a-1-gsmtc-capability");

export function createGsmtcCapabilityPrototypeResult(
  target: GsmtcCapabilityPrototypeTarget,
  values: ResultValues
): GsmtcCapabilityPrototypeResult {
  return {
    target,
    capability: values.capability,
    status: values.status,
    health: values.health,
    failureCode: values.failureCode
  };
}

export function isGsmtcCapabilityPrototypeTarget(
  value: unknown
): value is GsmtcCapabilityPrototypeTarget {
  return GSMTC_CAPABILITY_PROTOTYPE_TARGETS.includes(value as GsmtcCapabilityPrototypeTarget);
}

export function parseGsmtcCapabilityPrototypeResult(
  value: string
): GsmtcCapabilityPrototypeResult | null {
  try {
    const parsed = JSON.parse(value.trim().replace(/^\uFEFF/, "")) as Record<string, unknown> | null;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      return null;
    }
    const keys = Object.keys(parsed);
    if (keys.length !== RESULT_KEYS.length || RESULT_KEYS.some((key) => !keys.includes(key))) {
      return null;
    }
    if (
      !isGsmtcCapabilityPrototypeTarget(parsed.target) ||
      !GSMTC_CAPABILITY_PROTOTYPE_CAPABILITIES.includes(
        parsed.capability as GsmtcCapabilityPrototypeCapability
      ) ||
      !GSMTC_CAPABILITY_PROTOTYPE_STATUSES.includes(parsed.status as GsmtcCapabilityPrototypeStatus) ||
      !GSMTC_CAPABILITY_PROTOTYPE_HEALTH_VALUES.includes(parsed.health as GsmtcCapabilityPrototypeHealth) ||
      !GSMTC_CAPABILITY_PROTOTYPE_FAILURE_CODES.includes(
        parsed.failureCode as GsmtcCapabilityPrototypeFailureCode
      )
    ) {
      return null;
    }

    const result = parsed as GsmtcCapabilityPrototypeResult;
    return isCoherentResult(result)
      ? createGsmtcCapabilityPrototypeResult(result.target, {
        capability: result.capability,
        status: result.status,
        health: result.health,
        failureCode: result.failureCode
      })
      : null;
  } catch {
    return null;
  }
}

export async function runGsmtcCapabilityPrototype({
  target,
  musicEnabled,
  platform = process.platform,
  commandRunner
}: {
  target: GsmtcCapabilityPrototypeTarget;
  musicEnabled: boolean;
  platform?: NodeJS.Platform;
  commandRunner?: GsmtcCapabilityPrototypeCommandRunner;
}): Promise<GsmtcCapabilityPrototypeResult> {
  if (!musicEnabled) {
    commandRunner?.dispose();
    return createGsmtcCapabilityPrototypeResult(target, {
      capability: "unknown",
      status: "unknown",
      health: "stopped",
      failureCode: "settings-disabled"
    });
  }

  if (platform !== "win32") {
    commandRunner?.dispose();
    return createGsmtcCapabilityPrototypeResult(target, {
      capability: "unavailable",
      status: "unknown",
      health: "error",
      failureCode: "unsupported-platform"
    });
  }

  const runner = commandRunner ?? createPowerShellGsmtcCapabilityPrototypeCommandRunner();
  try {
    const parsed = parseGsmtcCapabilityPrototypeResult(await runner.execute(target));
    if (!parsed || parsed.target !== target) {
      return createGsmtcCapabilityPrototypeResult(target, {
        capability: "unknown",
        status: "unknown",
        health: "error",
        failureCode: "invalid-output"
      });
    }
    return parsed;
  } catch (error) {
    return createGsmtcCapabilityPrototypeResult(target, {
      capability: "unknown",
      status: "unknown",
      health: "error",
      failureCode: error instanceof GsmtcPrototypeCommandError
        ? error.failureCode
        : "host-failed"
    });
  } finally {
    runner.dispose();
  }
}

export function resolveGsmtcCapabilityPrototypeOutputPath(
  projectRoot: string,
  target: GsmtcCapabilityPrototypeTarget
): string {
  if (!isGsmtcCapabilityPrototypeTarget(target)) {
    throw new Error("Invalid GSMTC capability prototype target");
  }
  const outputRoot = resolve(projectRoot, OUTPUT_DIRECTORY);
  const outputPath = resolve(outputRoot, `${target}.json`);
  const relativePath = relative(outputRoot, outputPath);
  if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    throw new Error("Invalid GSMTC capability prototype output path");
  }
  return outputPath;
}

export function writeGsmtcCapabilityPrototypeResult(
  projectRoot: string,
  result: GsmtcCapabilityPrototypeResult
): string {
  const outputPath = resolveGsmtcCapabilityPrototypeOutputPath(projectRoot, result.target);
  mkdirSync(resolve(projectRoot, OUTPUT_DIRECTORY), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return outputPath;
}

export function createPowerShellGsmtcCapabilityPrototypeCommandRunner({
  timeoutMs = 5_000,
  systemRoot = process.env.SystemRoot
}: {
  timeoutMs?: number;
  systemRoot?: string;
} = {}): GsmtcCapabilityPrototypeCommandRunner {
  let activeChild: ChildProcess | null = null;
  let disposed = false;
  const powershellPath = resolvePowerShellPath(systemRoot);

  return {
    execute(target) {
      if (disposed) {
        return Promise.reject(new GsmtcPrototypeCommandError("host-failed"));
      }
      const encodedCommand = Buffer.from(createPowerShellScript(target), "utf16le").toString("base64");
      return new Promise<string>((resolveOutput, reject) => {
        const child = execFile(
          powershellPath,
          ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", encodedCommand],
          {
            windowsHide: true,
            timeout: timeoutMs,
            maxBuffer: 1_024,
            encoding: "utf8"
          },
          (error, stdout) => {
            if (activeChild === child) {
              activeChild = null;
            }
            if (error) {
              reject(new GsmtcPrototypeCommandError(error.killed ? "probe-timeout" : "host-failed"));
              return;
            }
            resolveOutput(stdout);
          }
        );
        activeChild = child;
      });
    },
    cancel() {
      activeChild?.kill();
      activeChild = null;
    },
    dispose() {
      disposed = true;
      this.cancel();
    }
  };
}

function resolvePowerShellPath(systemRoot = process.env.SystemRoot): string {
  const root = systemRoot && win32.isAbsolute(systemRoot) ? systemRoot : String.raw`C:\Windows`;
  return win32.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

function createPowerShellScript(target: GsmtcCapabilityPrototypeTarget): string {
  return String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$target = '${target}'

function Write-ProbeResult($capability, $status, $health, $failureCode) {
  [Console]::Out.Write((ConvertTo-Json @{
    target = $target
    capability = $capability
    status = $status
    health = $health
    failureCode = $failureCode
  } -Compress))
}

try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime] | Out-Null
  $operation = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()
  $asTaskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 } |
    Select-Object -First 1
  $closedMethod = $asTaskMethod.MakeGenericMethod([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
  $task = $closedMethod.Invoke($null, @($operation))
  if (-not $task.Wait(3000)) {
    Write-ProbeResult 'unknown' 'unknown' 'error' 'probe-timeout'
    exit 0
  }

  $playing = $false
  foreach ($session in $task.Result.GetSessions()) {
    if ($session.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing') {
      $playing = $true
      break
    }
  }
  Write-ProbeResult 'available' $(if ($playing) { 'playing' } else { 'stopped' }) 'ready' 'none'
} catch {
  if ($_.Exception.HResult -eq -2147024891) {
    Write-ProbeResult 'unavailable' 'unknown' 'error' 'capability-unavailable'
  } else {
    Write-ProbeResult 'unknown' 'unknown' 'error' 'host-failed'
  }
}
`;
}

function isCoherentResult(result: GsmtcCapabilityPrototypeResult): boolean {
  if (result.health === "ready") {
    return result.capability === "available" && result.status !== "unknown" && result.failureCode === "none";
  }
  if (result.health === "stopped") {
    return result.capability === "unknown" && result.status === "unknown" && result.failureCode === "settings-disabled";
  }
  if (result.health === "not-run") {
    return result.capability === "unknown" && result.status === "unknown" && result.failureCode === "target-not-run";
  }
  if (result.failureCode === "unsupported-platform" || result.failureCode === "capability-unavailable") {
    return result.capability === "unavailable" && result.status === "unknown";
  }
  return result.capability === "unknown" &&
    result.status === "unknown" &&
    (result.failureCode === "probe-timeout" ||
      result.failureCode === "host-failed" ||
      result.failureCode === "invalid-output");
}

class GsmtcPrototypeCommandError extends Error {
  readonly failureCode: "probe-timeout" | "host-failed";

  constructor(failureCode: "probe-timeout" | "host-failed") {
    super(failureCode);
    this.failureCode = failureCode;
  }
}
