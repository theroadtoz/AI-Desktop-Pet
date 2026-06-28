Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function New-IcoFromPng {
  param(
    [Parameter(Mandatory = $true)]
    [string] $PngPath,

    [Parameter(Mandatory = $true)]
    [string] $IcoPath
  )

  $pngBytes = [System.IO.File]::ReadAllBytes($PngPath)
  $stream = [System.IO.File]::Create($IcoPath)
  $writer = [System.IO.BinaryWriter]::new($stream)

  try {
    $writer.Write([UInt16] 0)
    $writer.Write([UInt16] 1)
    $writer.Write([UInt16] 1)
    $writer.Write([Byte] 0)
    $writer.Write([Byte] 0)
    $writer.Write([Byte] 0)
    $writer.Write([Byte] 0)
    $writer.Write([UInt16] 1)
    $writer.Write([UInt16] 32)
    $writer.Write([UInt32] $pngBytes.Length)
    $writer.Write([UInt32] 22)
    $writer.Write($pngBytes)
  }
  finally {
    $writer.Dispose()
    $stream.Dispose()
  }
}

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$launcherPath = Join-Path $projectRoot 'Start-AIDesktopPet.cmd'
$iconPngPath = Join-Path $projectRoot 'resources\icons\app-icon-256.png'
$iconPath = Join-Path $projectRoot 'resources\icons\app-icon.ico'
$desktopPath = [Environment]::GetFolderPath([Environment+SpecialFolder]::DesktopDirectory)
$shortcutPath = Join-Path $desktopPath 'AI Desktop Pet.lnk'

if (-not (Test-Path -LiteralPath $launcherPath)) {
  throw "Launcher was not found: $launcherPath"
}

if (-not (Test-Path -LiteralPath $iconPath)) {
  if (-not (Test-Path -LiteralPath $iconPngPath)) {
    throw "Icon source was not found: $iconPngPath"
  }

  New-IcoFromPng -PngPath $iconPngPath -IcoPath $iconPath
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $launcherPath
$shortcut.WorkingDirectory = $projectRoot
$shortcut.IconLocation = "$iconPath,0"
$shortcut.Description = 'Start AI Desktop Pet'
$shortcut.Save()

Write-Output "Created shortcut: $shortcutPath"
Write-Output "Target: $launcherPath"
Write-Output "Working directory: $projectRoot"
Write-Output "Icon: $iconPath"
