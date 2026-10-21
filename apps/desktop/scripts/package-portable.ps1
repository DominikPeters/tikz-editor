param(
  [string]$ExecutablePath = "",
  [string]$OutputDirectory = ""
)

$ErrorActionPreference = "Stop"
$tauriDirectory = Join-Path $PSScriptRoot "..\src-tauri"
if (-not $ExecutablePath) {
  $ExecutablePath = Join-Path $tauriDirectory "target\release\tikz-editor.exe"
}
if (-not $OutputDirectory) {
  $OutputDirectory = Join-Path $tauriDirectory "target\portable"
}
$config = Get-Content -LiteralPath (Join-Path $tauriDirectory "tauri.conf.json") -Raw | ConvertFrom-Json
$version = [string]$config.version
if (-not (Test-Path -LiteralPath $ExecutablePath -PathType Leaf)) {
  throw "Portable executable missing. Run npm run -w @tikz-editor/desktop tauri:build:portable first."
}
$metadata = (Get-Item -LiteralPath $ExecutablePath).VersionInfo
if ($metadata.ProductName -cne $config.productName -or $metadata.ProductVersion -cne $version) {
  throw "Portable executable product metadata does not match tauri.conf.json."
}
$reader = [System.IO.BinaryReader]::new([System.IO.File]::OpenRead($ExecutablePath))
try {
  $reader.BaseStream.Position = 0x3c
  $peHeader = $reader.ReadInt32()
  $reader.BaseStream.Position = $peHeader + 4
  if ($reader.ReadUInt16() -ne 0x8664) {
    throw "This portable package currently supports Windows x64 executables only."
  }
} finally {
  $reader.Dispose()
}

New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
$archive = Join-Path $OutputDirectory "TikZ.Editor_${version}_x64-portable.zip"
$staging = Join-Path ([System.IO.Path]::GetTempPath()) ("tikz-portable-" + [guid]::NewGuid())
try {
  New-Item -ItemType Directory -Path $staging | Out-Null
  Copy-Item -LiteralPath $ExecutablePath -Destination (Join-Path $staging "tikz-editor.exe")
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot "portable-README.txt") -Destination (Join-Path $staging "README.txt")
  Compress-Archive -Path (Join-Path $staging "*") -DestinationPath $archive -Force
  Write-Output "Portable ZIP: $archive"
} finally {
  Remove-Item -LiteralPath $staging -Recurse -Force
}
