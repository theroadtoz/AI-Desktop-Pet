param(
  [Parameter(Mandatory = $true)]
  [string]$IdentityFile
)

$ErrorActionPreference = 'Stop'

try {
  if (-not (Test-Path -LiteralPath $IdentityFile -PathType Leaf)) { throw "Identity file is missing" }
  $parsed = Get-Content -LiteralPath $IdentityFile -Raw -Encoding UTF8 | ConvertFrom-Json
  $identities = if ($parsed -is [System.Array]) { @($parsed) } else { @($parsed) }
  if ($identities.Count -eq 0) { throw "Identity list is empty" }
  $processes = @(Get-CimInstance Win32_Process | Select-Object ProcessId, CreationDate)
  $survivors = @()
  foreach ($identity in $identities) {
    $keys = @($identity.PSObject.Properties | ForEach-Object { $_.Name })
    [UInt32]$parsedPid = 0
    $valid = $keys.Count -eq 3 -and $keys -contains 'pid' -and
      $keys -contains 'creationTimeUtcTicks' -and $keys -contains 'role' -and
      [UInt32]::TryParse([string]$identity.pid, [ref]$parsedPid) -and $parsedPid -gt 0 -and
      $identity.creationTimeUtcTicks -is [string] -and $identity.creationTimeUtcTicks -match '^\d{1,20}$' -and
      $identity.role -is [string] -and @('root', 'descendant') -contains $identity.role
    if (-not $valid) { throw "Invalid process identity" }
    $current = $processes | Where-Object { [UInt32]$_.ProcessId -eq $parsedPid } | Select-Object -First 1
    if ($current -and $current.CreationDate) {
      $ticks = ([DateTime]$current.CreationDate).ToUniversalTime().Ticks.ToString([Globalization.CultureInfo]::InvariantCulture)
      if ($ticks -eq $identity.creationTimeUtcTicks) {
        $survivors += [pscustomobject]@{
          pid = $parsedPid
          creationTimeUtcTicks = $identity.creationTimeUtcTicks
          role = $identity.role
        }
      }
    }
  }
  [Console]::Out.WriteLine((ConvertTo-Json -InputObject @($survivors) -Compress))
  exit 0
} catch {
  [Console]::Error.WriteLine("safe_failure: owned process probe failed: $($_.Exception.Message)")
  exit 1
}
