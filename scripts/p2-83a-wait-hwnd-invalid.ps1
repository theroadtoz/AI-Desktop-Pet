param(
  [Parameter(Mandatory = $true)]
  [UInt64]$ExpectedHwnd,
  [Parameter(Mandatory = $true)]
  [string]$IdentityFile,
  [ValidateRange(100, 30000)]
  [int]$TimeoutMilliseconds = 8000
)

$ErrorActionPreference = 'Stop'

try {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class P283aOldWindowProbe {
  [DllImport("user32.dll")]
  public static extern bool IsWindow(IntPtr hwnd);
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint processId);
  public static uint GetOwnerPid(ulong hwndValue) {
    if (hwndValue == 0) return 0;
    var hwnd = new IntPtr(unchecked((long)hwndValue));
    if (!IsWindow(hwnd)) return 0;
    uint processId;
    GetWindowThreadProcessId(hwnd, out processId);
    return processId;
  }
}
'@
  if (-not (Test-Path -LiteralPath $IdentityFile -PathType Leaf)) { throw "Identity file is missing" }
  $parsed = Get-Content -LiteralPath $IdentityFile -Raw -Encoding UTF8 | ConvertFrom-Json
  $identities = @()
  if ($parsed -is [System.Array]) {
    foreach ($entry in $parsed) { $identities += $entry }
  } else {
    $identities = @($parsed)
  }
  if ($identities.Count -eq 0) { throw "Identity list is empty" }
  foreach ($identity in $identities) {
    $keys = @($identity.PSObject.Properties | ForEach-Object { $_.Name })
    [UInt32]$parsedPid = 0
    $isPidValid = [UInt32]::TryParse([string]$identity.pid, [ref]$parsedPid)
    $isTicksValid = $identity.creationTimeUtcTicks -is [string] -and
      $identity.creationTimeUtcTicks -match '^\d{1,20}$'
    $isRoleValid = $identity.role -is [string] -and @('root', 'descendant') -contains $identity.role
    $hasExactKeys = $keys.Count -eq 3 -and $keys -contains 'pid' -and
      $keys -contains 'creationTimeUtcTicks' -and $keys -contains 'role'
    if (-not $hasExactKeys -or
      -not $isPidValid -or $parsedPid -eq 0 -or -not $isTicksValid -or -not $isRoleValid) {
      throw "Invalid process identity"
    }
  }

  $clock = [System.Diagnostics.Stopwatch]::StartNew()
  while ($clock.ElapsedMilliseconds -le $TimeoutMilliseconds) {
    $windowOwnerPid = [P283aOldWindowProbe]::GetOwnerPid($ExpectedHwnd)
    if ($windowOwnerPid -eq 0) {
      [Console]::Out.WriteLine('{"ok":true,"action":"old_hwnd_invalid"}')
      exit 0
    }
    $expectedIdentity = $identities | Where-Object { [UInt32]$_.pid -eq [UInt32]$windowOwnerPid } | Select-Object -First 1
    if (-not $expectedIdentity) {
      [Console]::Out.WriteLine('{"ok":true,"action":"old_hwnd_reused"}')
      exit 0
    }
    $current = Get-CimInstance Win32_Process -Filter "ProcessId = $windowOwnerPid" | Select-Object -First 1
    if (-not $current -or -not $current.CreationDate) {
      [Console]::Out.WriteLine('{"ok":true,"action":"old_hwnd_owner_exited"}')
      exit 0
    }
    $currentTicks = ([DateTime]$current.CreationDate).ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture)
    if ($currentTicks -ne $expectedIdentity.creationTimeUtcTicks) {
      [Console]::Out.WriteLine('{"ok":true,"action":"old_hwnd_owner_reused"}')
      exit 0
    }
    Start-Sleep -Milliseconds 50
  }
  throw "Old Electron HWND is still owned by the old process identity"
} catch {
  [Console]::Error.WriteLine("safe_failure: old HWND identity wait failed: $($_.Exception.Message)")
  exit 1
}
