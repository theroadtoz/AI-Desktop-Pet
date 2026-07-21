param(
  [Parameter(Mandatory = $true)]
  [string]$IdentityFile,
  [ValidateRange(100, 30000)]
  [int]$TimeoutMilliseconds = 8000
)

$ErrorActionPreference = 'Stop'

function Read-Identities([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Identity file is missing" }
  $parsed = Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
  $items = @()
  if ($parsed -is [System.Array]) {
    foreach ($entry in $parsed) { $items += $entry }
  } else {
    $items = @($parsed)
  }
  if ($items.Count -eq 0) { throw "Identity list is empty" }
  foreach ($item in $items) {
    $keys = @($item.PSObject.Properties | ForEach-Object { $_.Name })
    [UInt32]$parsedPid = 0
    $isPidValid = [UInt32]::TryParse([string]$item.pid, [ref]$parsedPid)
    $isTicksValid = $item.creationTimeUtcTicks -is [string] -and
      $item.creationTimeUtcTicks -match '^\d{1,20}$'
    $isRoleValid = $item.role -is [string] -and @('root', 'descendant') -contains $item.role
    $hasExactKeys = $keys.Count -eq 3 -and $keys -contains 'pid' -and
      $keys -contains 'creationTimeUtcTicks' -and $keys -contains 'role'
    if (-not $hasExactKeys -or
      -not $isPidValid -or $parsedPid -eq 0 -or -not $isTicksValid -or -not $isRoleValid) {
      throw "Invalid process identity"
    }
  }
  return $items
}

function Get-CreationTicks($Process) {
  if (-not $Process.CreationDate) { throw "Creation time unavailable" }
  return ([DateTime]$Process.CreationDate).ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture)
}

try {
  $identities = @(Read-Identities $IdentityFile)
  $clock = [System.Diagnostics.Stopwatch]::StartNew()
  while ($clock.ElapsedMilliseconds -le $TimeoutMilliseconds) {
    $processes = @(Get-CimInstance Win32_Process | Select-Object ProcessId, CreationDate)
    $survivors = @()
    foreach ($identity in $identities) {
      $current = $processes | Where-Object { [UInt32]$_.ProcessId -eq [UInt32]$identity.pid } | Select-Object -First 1
      if ($current -and (Get-CreationTicks $current) -eq $identity.creationTimeUtcTicks) {
        $survivors += $identity
      }
    }
    if ($survivors.Count -eq 0) {
      [Console]::Out.WriteLine('{"ok":true,"action":"owned_process_identities_exited"}')
      exit 0
    }
    Start-Sleep -Milliseconds 50
  }
  $rootAlive = @($survivors | Where-Object { $_.role -eq 'root' }).Count -gt 0
  $descendantAliveCount = @($survivors | Where-Object { $_.role -eq 'descendant' }).Count
  [Console]::Error.WriteLine((ConvertTo-Json -Compress -InputObject ([ordered]@{
    survivorCount = $survivors.Count
    rootAlive = $rootAlive
    descendantAliveCount = $descendantAliveCount
  })))
  exit 1
} catch {
  [Console]::Error.WriteLine("safe_failure: owned process identity wait failed: $($_.Exception.Message)")
  exit 1
}
