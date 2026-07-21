param(
  [Parameter(Mandatory = $true)]
  [ValidateRange(1, [UInt32]::MaxValue)]
  [UInt32]$RootPid,
  [Parameter(Mandatory = $true)]
  [ValidateRange(1, [UInt32]::MaxValue)]
  [UInt32]$ExpectedParentPid,
  [Parameter(Mandatory = $true)]
  [ValidateSet('electron.exe')]
  [string]$ExpectedRootName,
  [string]$SnapshotFile
)

$ErrorActionPreference = 'Stop'

try {
  $processes = if ($SnapshotFile) {
    if (-not (Test-Path -LiteralPath $SnapshotFile -PathType Leaf)) { throw "Snapshot file is missing" }
    @(Get-Content -LiteralPath $SnapshotFile -Raw -Encoding UTF8 | ConvertFrom-Json)
  } else {
    @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, CreationDate)
  }
  $root = $processes | Where-Object { [UInt32]$_.ProcessId -eq $RootPid } | Select-Object -First 1
  if (-not $root) {
    [Console]::Out.WriteLine('[]')
    exit 0
  }
  if (-not $root.CreationDate -or [string]::IsNullOrWhiteSpace([string]$root.Name)) {
    throw "Root process identity is incomplete"
  }
  if ([string]$root.Name -cne $ExpectedRootName -or [UInt32]$root.ParentProcessId -ne $ExpectedParentPid) {
    [Console]::Out.WriteLine('[]')
    throw "Root process ownership does not match the expected parent and name"
  }
  $rootName = [string]$root.Name
  $allowedAuxiliaryNames = @('crashpad_handler.exe')

  $owned = [System.Collections.Generic.HashSet[UInt32]]::new()
  $queue = [System.Collections.Generic.Queue[UInt32]]::new()
  [void]$owned.Add($RootPid)
  $queue.Enqueue($RootPid)
  while ($queue.Count -gt 0) {
    $parentPid = $queue.Dequeue()
    $parent = $processes | Where-Object { [UInt32]$_.ProcessId -eq $parentPid } | Select-Object -First 1
    if (-not $parent -or -not $parent.CreationDate) { throw "Owned parent identity is incomplete" }
    $parentCreation = ([DateTime]$parent.CreationDate).ToUniversalTime()
    foreach ($process in $processes) {
      $processId = [UInt32]$process.ProcessId
      if ([UInt32]$process.ParentProcessId -ne $parentPid -or $owned.Contains($processId)) { continue }
      if (-not $process.CreationDate -or [string]::IsNullOrWhiteSpace([string]$process.Name)) { continue }
      $nameAllowed = [string]$process.Name -ieq $rootName -or
        $allowedAuxiliaryNames -icontains [string]$process.Name
      $childCreation = ([DateTime]$process.CreationDate).ToUniversalTime()
      if (-not $nameAllowed -or $childCreation -lt $parentCreation) { continue }
      if ($owned.Count -ge 32) { throw "Owned process identity limit exceeded" }
      [void]$owned.Add($processId)
      $queue.Enqueue($processId)
    }
  }

  $identities = @($owned | Sort-Object | ForEach-Object {
    $pidValue = [UInt32]$_
    $process = $processes | Where-Object { [UInt32]$_.ProcessId -eq $pidValue } | Select-Object -First 1
    if (-not $process -or -not $process.CreationDate) {
      throw "Creation time unavailable for PID $pidValue"
    }
    $creationTime = ([DateTime]$process.CreationDate).ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture)
    $role = if ($pidValue -eq $RootPid) { 'root' } else { 'descendant' }
    [pscustomobject]@{ pid = $pidValue; creationTimeUtcTicks = $creationTime; role = $role }
  })
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject $identities -Compress))
  exit 0
} catch {
  [Console]::Error.WriteLine("safe_failure: process tree capture failed: $($_.Exception.Message)")
  exit 1
}
