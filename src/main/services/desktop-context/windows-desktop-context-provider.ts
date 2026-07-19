import { execFile, type ChildProcess } from "node:child_process";
import { win32 } from "node:path";

export const GAME_PRESENCE_VALUES = ["game", "non-game", "unknown"] as const;

export type GamePresence = typeof GAME_PRESENCE_VALUES[number];

export type DesktopContextSnapshot = {
  mediaPlaying: boolean;
  gamePresence: GamePresence;
};

export type DesktopContextProvider = {
  sample(): Promise<DesktopContextSnapshot>;
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

const WINDOWS_DESKTOP_CONTEXT_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$mediaPlaying = $false
$gamePresence = 'unknown'

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

try {
  $registeredGamePaths = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
  foreach ($entry in Get-ChildItem 'HKCU:\System\GameConfigStore\Children' -ErrorAction Stop) {
    $item = Get-ItemProperty $entry.PSPath -ErrorAction SilentlyContinue
    if ($null -ne $item -and $item.Type -eq 1 -and -not [string]::IsNullOrWhiteSpace($item.MatchedExeFullPath)) {
      [void]$registeredGamePaths.Add($item.MatchedExeFullPath)
    }
  }

  $gamePresence = 'non-game'
  foreach ($process in Get-Process -ErrorAction Stop) {
    try {
      if ($registeredGamePaths.Contains($process.Path)) {
        $gamePresence = 'game'
        break
      }
    } catch {
    }
  }
} catch {
  $gamePresence = 'unknown'
}

[Console]::Out.Write((ConvertTo-Json @{
  mediaPlaying = $mediaPlaying
  gamePresence = $gamePresence
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
  let inFlight: Promise<DesktopContextSnapshot> | null = null;

  return {
    sample() {
      if (disposed || platform !== "win32") {
        return Promise.resolve({ ...UNKNOWN_DESKTOP_CONTEXT_SNAPSHOT });
      }

      if (inFlight) {
        return inFlight;
      }

      const request = commandRunner.execute()
        .then(parseDesktopContextSnapshot)
        .catch(() => ({ ...UNKNOWN_DESKTOP_CONTEXT_SNAPSHOT }))
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

export function parseDesktopContextSnapshot(value: string): DesktopContextSnapshot {
  try {
    const parsed = JSON.parse(value.trim()) as Partial<DesktopContextSnapshot> | null;
    if (
      !parsed ||
      Object.keys(parsed).some((key) => key !== "mediaPlaying" && key !== "gamePresence") ||
      typeof parsed.mediaPlaying !== "boolean" ||
      !GAME_PRESENCE_VALUES.includes(parsed.gamePresence as GamePresence)
    ) {
      return { ...UNKNOWN_DESKTOP_CONTEXT_SNAPSHOT };
    }

    return {
      mediaPlaying: parsed.mediaPlaying,
      gamePresence: parsed.gamePresence as GamePresence
    };
  } catch {
    return { ...UNKNOWN_DESKTOP_CONTEXT_SNAPSHOT };
  }
}
