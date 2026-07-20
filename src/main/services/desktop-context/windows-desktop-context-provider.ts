import { execFile, type ChildProcess } from "node:child_process";
import { win32 } from "node:path";
import type {
  CompanionEnvironmentActivity,
  CompanionEnvironmentInterruptibility,
  CompanionEnvironmentMedia
} from "./companion-environment";

export type DesktopContextProbeStatus = "available" | "unavailable" | "failed";

export type DesktopContextMediaProbeResult = {
  status: DesktopContextProbeStatus;
  value: CompanionEnvironmentMedia;
  capability: "available" | "unavailable" | "unknown";
};

export type DesktopContextInterruptibilityProbeResult = {
  status: DesktopContextProbeStatus;
  value: CompanionEnvironmentInterruptibility;
  capability: "available" | "unavailable" | "unknown";
};

export type DesktopContextProvider = {
  sampleMedia(): Promise<DesktopContextMediaProbeResult>;
  sampleInterruptibility(): Promise<DesktopContextInterruptibilityProbeResult>;
  cancelMediaPending(): void;
  cancelBasicPending(): void;
  dispose(): void;
};

export type DesktopContextCommandRunner = {
  execute(): Promise<string>;
  cancel(): void;
  dispose(): void;
};

type ExecFileLike = typeof execFile;

const UNAVAILABLE_MEDIA_PROBE: DesktopContextMediaProbeResult = Object.freeze({
  status: "unavailable",
  value: "unknown",
  capability: "unavailable"
});

const UNAVAILABLE_INTERRUPTIBILITY_PROBE: DesktopContextInterruptibilityProbeResult = Object.freeze({
  status: "unavailable",
  value: "unknown",
  capability: "unavailable"
});

export const WINDOWS_GSMTC_PLAYBACK_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$mediaPlaying = $false
$mediaCapability = 'unavailable'

try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType=WindowsRuntime] | Out-Null
  $operation = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()
  $asTaskMethod = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetParameters().Count -eq 1 } |
    Select-Object -First 1
  $closedMethod = $asTaskMethod.MakeGenericMethod([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager])
  $task = $closedMethod.Invoke($null, @($operation))
  if ($task.Wait(3000)) {
    $mediaCapability = 'available'
    foreach ($session in $task.Result.GetSessions()) {
      if ($session.GetPlaybackInfo().PlaybackStatus.ToString() -eq 'Playing') {
        $mediaPlaying = $true
        break
      }
    }
  }
} catch {
  $mediaPlaying = $false
}

[Console]::Out.Write((ConvertTo-Json @{
  mediaPlaying = $mediaPlaying
  mediaCapability = $mediaCapability
} -Compress))
`;

export const WINDOWS_QUNS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$state = 0

try {
  Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;

public static class CompanionQunsNative {
  [DllImport("shell32.dll")]
  public static extern int SHQueryUserNotificationState(out int state);
}
'@
  [int]$nativeState = 0
  $callCode = [CompanionQunsNative]::SHQueryUserNotificationState([ref]$nativeState)
  if ($callCode -eq 0) {
    $state = $nativeState
  }
} catch {
  $state = 0
}

[Console]::Out.Write((ConvertTo-Json @{ state = $state } -Compress))
`;

export function bucketIdleSeconds(value: unknown): CompanionEnvironmentActivity {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return "unknown";
  }
  if (value < 60) {
    return "active";
  }
  if (value < 300) {
    return "idle-short";
  }
  if (value < 1_800) {
    return "idle-long";
  }
  return "away";
}

export function createWindowsDesktopContextProvider({
  platform = process.platform,
  mediaCommandRunner = createPowerShellDesktopContextCommandRunner(),
  interruptibilityCommandRunner = createPowerShellQunsCommandRunner()
}: {
  platform?: NodeJS.Platform;
  mediaCommandRunner?: DesktopContextCommandRunner;
  interruptibilityCommandRunner?: DesktopContextCommandRunner;
} = {}): DesktopContextProvider {
  let disposed = false;
  let mediaGeneration = 0;
  let interruptibilityGeneration = 0;
  let mediaInFlight: Promise<DesktopContextMediaProbeResult> | null = null;
  let interruptibilityInFlight: Promise<DesktopContextInterruptibilityProbeResult> | null = null;

  function sampleMedia(): Promise<DesktopContextMediaProbeResult> {
    if (disposed || platform !== "win32") {
      return Promise.resolve({ ...UNAVAILABLE_MEDIA_PROBE });
    }
    if (mediaInFlight) {
      return mediaInFlight;
    }
    const generation = mediaGeneration;
    const request = mediaCommandRunner.execute()
      .then((output) => generation === mediaGeneration
        ? parseMediaProbeResult(output)
        : createFailedMediaProbe())
      .catch(() => createFailedMediaProbe())
      .finally(() => {
        if (mediaInFlight === request) {
          mediaInFlight = null;
        }
      });
    mediaInFlight = request;
    return request;
  }

  function sampleInterruptibility(): Promise<DesktopContextInterruptibilityProbeResult> {
    if (disposed || platform !== "win32") {
      return Promise.resolve({ ...UNAVAILABLE_INTERRUPTIBILITY_PROBE });
    }
    if (interruptibilityInFlight) {
      return interruptibilityInFlight;
    }
    const generation = interruptibilityGeneration;
    const request = interruptibilityCommandRunner.execute()
      .then((output) => generation === interruptibilityGeneration
        ? parseQunsProbeResult(output)
        : createFailedInterruptibilityProbe())
      .catch(() => createFailedInterruptibilityProbe())
      .finally(() => {
        if (interruptibilityInFlight === request) {
          interruptibilityInFlight = null;
        }
      });
    interruptibilityInFlight = request;
    return request;
  }

  return {
    sampleMedia,
    sampleInterruptibility,
    cancelMediaPending() {
      mediaGeneration += 1;
      mediaInFlight = null;
      mediaCommandRunner.cancel();
    },
    cancelBasicPending() {
      interruptibilityGeneration += 1;
      interruptibilityInFlight = null;
      interruptibilityCommandRunner.cancel();
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      mediaGeneration += 1;
      interruptibilityGeneration += 1;
      mediaInFlight = null;
      interruptibilityInFlight = null;
      mediaCommandRunner.dispose();
      interruptibilityCommandRunner.dispose();
    }
  };
}

export function createPowerShellDesktopContextCommandRunner({
  timeoutMs = 5_000,
  systemRoot = process.env.SystemRoot,
  execFileFn = execFile
}: {
  timeoutMs?: number;
  systemRoot?: string;
  execFileFn?: ExecFileLike;
} = {}): DesktopContextCommandRunner {
  return createPowerShellCommandRunner({
    script: WINDOWS_GSMTC_PLAYBACK_SCRIPT,
    timeoutMs,
    systemRoot,
    execFileFn
  });
}

export function createPowerShellQunsCommandRunner({
  timeoutMs = 2_000,
  systemRoot = process.env.SystemRoot,
  execFileFn = execFile
}: {
  timeoutMs?: number;
  systemRoot?: string;
  execFileFn?: ExecFileLike;
} = {}): DesktopContextCommandRunner {
  return createPowerShellCommandRunner({
    script: WINDOWS_QUNS_SCRIPT,
    timeoutMs,
    systemRoot,
    execFileFn
  });
}

function createPowerShellCommandRunner({
  script,
  timeoutMs,
  systemRoot,
  execFileFn
}: {
  script: string;
  timeoutMs: number;
  systemRoot?: string | undefined;
  execFileFn: ExecFileLike;
}): DesktopContextCommandRunner {
  let active: {
    child: ChildProcess;
    promise: Promise<string>;
    reject(error: Error): void;
  } | null = null;
  let disposed = false;
  let generation = 0;
  const encodedCommand = Buffer.from(script, "utf16le").toString("base64");
  const powershellExecutablePath = resolvePowerShellExecutablePath(systemRoot);

  function cancel(): void {
    generation += 1;
    const pending = active;
    active = null;
    if (pending) {
      pending.child.kill();
      pending.reject(new Error("Desktop context command cancelled"));
    }
  }

  return {
    execute() {
      if (disposed) {
        return Promise.reject(new Error("Desktop context command runner disposed"));
      }
      if (active) {
        return active.promise;
      }
      const requestGeneration = generation;
      let rejectRequest: (error: Error) => void = () => undefined;
      let child: ChildProcess;
      const promise = new Promise<string>((resolve, reject) => {
        rejectRequest = reject;
        child = execFileFn(
          powershellExecutablePath,
          ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-EncodedCommand", encodedCommand],
          {
            windowsHide: true,
            timeout: timeoutMs,
            maxBuffer: 1_024,
            encoding: "utf8"
          },
          (error, stdout) => {
            if (active?.promise === promise) {
              active = null;
            }
            if (error || requestGeneration !== generation) {
              reject(new Error("Desktop context command failed"));
              return;
            }
            resolve(String(stdout));
          }
        );
      });
      active = { child: child!, promise, reject: rejectRequest };
      return promise;
    },
    cancel,
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      cancel();
    }
  };
}

export function resolvePowerShellExecutablePath(systemRoot = process.env.SystemRoot): string {
  const root = systemRoot && win32.isAbsolute(systemRoot)
    ? systemRoot
    : String.raw`C:\Windows`;
  return win32.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

export function parseMediaProbeResult(value: string): DesktopContextMediaProbeResult {
  try {
    const parsed = JSON.parse(value.trim()) as unknown;
    if (!hasExactKeys(parsed, ["mediaPlaying", "mediaCapability"]) ||
      typeof parsed.mediaPlaying !== "boolean" ||
      (parsed.mediaCapability !== "available" && parsed.mediaCapability !== "unavailable")) {
      return createFailedMediaProbe();
    }
    if (parsed.mediaCapability === "unavailable" && parsed.mediaPlaying) {
      return createFailedMediaProbe();
    }
    return {
      status: parsed.mediaCapability === "available" ? "available" : "unavailable",
      value: parsed.mediaCapability === "available"
        ? (parsed.mediaPlaying ? "playing" : "stopped")
        : "unknown",
      capability: parsed.mediaCapability
    };
  } catch {
    return createFailedMediaProbe();
  }
}

export function parseQunsProbeResult(value: string): DesktopContextInterruptibilityProbeResult {
  try {
    const parsed = JSON.parse(value.trim()) as unknown;
    if (!hasExactKeys(parsed, ["state"]) || !Number.isSafeInteger(parsed.state)) {
      return createFailedInterruptibilityProbe();
    }
    const mapped = mapQunsState(parsed.state as number);
    return mapped === "unknown"
      ? createFailedInterruptibilityProbe()
      : { status: "available", value: mapped, capability: "available" };
  } catch {
    return createFailedInterruptibilityProbe();
  }
}

export function mapQunsState(state: number): CompanionEnvironmentInterruptibility {
  if (state === 5) {
    return "allowed";
  }
  if (state === 4) {
    return "presentation";
  }
  if (state === 3) {
    return "full-screen-activity";
  }
  if (state === 1 || state === 2 || state === 6 || state === 7) {
    return "suppressed";
  }
  return "unknown";
}

function createFailedMediaProbe(): DesktopContextMediaProbeResult {
  return { status: "failed", value: "unknown", capability: "unknown" };
}

function createFailedInterruptibilityProbe(): DesktopContextInterruptibilityProbeResult {
  return { status: "failed", value: "unknown", capability: "unknown" };
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const actualKeys = Object.keys(value);
  return actualKeys.length === keys.length && keys.every((key) => actualKeys.includes(key));
}
