import { execFile, type ChildProcess } from "node:child_process";
import { win32 } from "node:path";

export const GAME_PRESENCE_VALUES = ["game", "non-game", "unknown"] as const;

export type GamePresence = typeof GAME_PRESENCE_VALUES[number];

export type DesktopContextSnapshot = {
  mediaPlaying: boolean;
  gamePresence: GamePresence;
};

export type DesktopContextCapability = "available" | "unavailable";

export type DesktopContextProbeStatus = "available" | "unavailable" | "failed";

export type DesktopContextProbeResult = {
  status: DesktopContextProbeStatus;
  snapshot: DesktopContextSnapshot;
  capabilities: {
    media: DesktopContextCapability;
    game: DesktopContextCapability;
  };
};

export type DesktopContextProvider = {
  sample(): Promise<DesktopContextProbeResult>;
  cancelPending(): void;
  dispose(): void;
};

export type DesktopContextCommandRunner = {
  execute(): Promise<string>;
  cancel(): void;
  dispose(): void;
};

export const UNKNOWN_DESKTOP_CONTEXT_SNAPSHOT: DesktopContextSnapshot = Object.freeze({
  mediaPlaying: false,
  gamePresence: "unknown"
});

export const UNAVAILABLE_DESKTOP_CONTEXT_PROBE: DesktopContextProbeResult = Object.freeze({
  status: "unavailable",
  snapshot: UNKNOWN_DESKTOP_CONTEXT_SNAPSHOT,
  capabilities: Object.freeze({ media: "unavailable", game: "unavailable" })
});

const WINDOWS_DESKTOP_CONTEXT_SCRIPT = String.raw`
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
  gamePresence = 'unknown'
  mediaCapability = $mediaCapability
  gameCapability = 'unavailable'
} -Compress))
`;

export function createWindowsDesktopContextProvider({
  platform = process.platform,
  commandRunner = createPowerShellDesktopContextCommandRunner()
}: {
  platform?: NodeJS.Platform;
  commandRunner?: DesktopContextCommandRunner;
} = {}): DesktopContextProvider {
  let disposed = false;
  let inFlight: Promise<DesktopContextProbeResult> | null = null;

  return {
    sample() {
      if (disposed || platform !== "win32") {
        return Promise.resolve({ ...UNAVAILABLE_DESKTOP_CONTEXT_PROBE });
      }

      if (inFlight) {
        return inFlight;
      }

      const request = commandRunner.execute()
        .then(parseDesktopContextProbeResult)
        .catch(() => createFailedDesktopContextProbe())
        .finally(() => {
          if (inFlight === request) {
            inFlight = null;
          }
        });
      inFlight = request;
      return inFlight;
    },
    cancelPending() {
      commandRunner.cancel();
      inFlight = null;
    },
    dispose() {
      disposed = true;
      commandRunner.cancel();
      commandRunner.dispose();
      inFlight = null;
    }
  };
}

export function createPowerShellDesktopContextCommandRunner({
  timeoutMs = 5_000,
  systemRoot = process.env.SystemRoot
}: {
  timeoutMs?: number;
  systemRoot?: string;
} = {}): DesktopContextCommandRunner {
  let activeChild: ChildProcess | null = null;
  let disposed = false;
  const encodedCommand = Buffer.from(WINDOWS_DESKTOP_CONTEXT_SCRIPT, "utf16le").toString("base64");
  const powershellExecutablePath = resolvePowerShellExecutablePath(systemRoot);

  return {
    execute() {
      if (disposed) {
        return Promise.reject(new Error("Desktop context command runner disposed"));
      }

      return new Promise<string>((resolve, reject) => {
        const child = execFile(
          powershellExecutablePath,
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
              reject(error);
              return;
            }
            resolve(stdout);
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

export function resolvePowerShellExecutablePath(systemRoot = process.env.SystemRoot): string {
  const root = systemRoot && win32.isAbsolute(systemRoot)
    ? systemRoot
    : String.raw`C:\Windows`;
  return win32.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

export function parseDesktopContextProbeResult(value: string): DesktopContextProbeResult {
  try {
    const parsed = JSON.parse(value.trim()) as (Partial<DesktopContextSnapshot> & {
      mediaCapability?: unknown;
      gameCapability?: unknown;
    }) | null;
    if (
      !parsed ||
      Object.keys(parsed).some((key) => (
        key !== "mediaPlaying" &&
        key !== "gamePresence" &&
        key !== "mediaCapability" &&
        key !== "gameCapability"
      )) ||
      typeof parsed.mediaPlaying !== "boolean" ||
      !GAME_PRESENCE_VALUES.includes(parsed.gamePresence as GamePresence) ||
      !isDesktopContextCapability(parsed.mediaCapability) ||
      !isDesktopContextCapability(parsed.gameCapability) ||
      parsed.gamePresence !== "unknown" ||
      parsed.gameCapability !== "unavailable"
    ) {
      return createFailedDesktopContextProbe();
    }

    return {
      status: "available",
      snapshot: {
        mediaPlaying: parsed.mediaPlaying,
        gamePresence: parsed.gamePresence as GamePresence
      },
      capabilities: {
        media: parsed.mediaCapability,
        game: parsed.gameCapability
      }
    };
  } catch {
    return createFailedDesktopContextProbe();
  }
}

function isDesktopContextCapability(value: unknown): value is DesktopContextCapability {
  return value === "available" || value === "unavailable";
}

function createFailedDesktopContextProbe(): DesktopContextProbeResult {
  return {
    status: "failed",
    snapshot: { ...UNKNOWN_DESKTOP_CONTEXT_SNAPSHOT },
    capabilities: { media: "unavailable", game: "unavailable" }
  };
}
