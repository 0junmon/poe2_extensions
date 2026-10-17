# Builds dist/poe-ninja-korean and packages it for the Chrome Web Store.
#
#   .\package-extension.ps1
#   .\package-extension.ps1 -DataRoot "D:\work\poe2_translation"
#
# ZIP entry names must use forward slashes; Compress-Archive on Windows writes
# backslashes, so the archive is written with System.IO.Compression instead.

[CmdletBinding()]
param(
  [string]$DataRoot = ""
)

$ErrorActionPreference = "Stop"

$codeRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
if (-not $DataRoot) {
  $DataRoot = Join-Path $codeRoot "..\poe2_translation"
}
if (-not (Test-Path (Join-Path $DataRoot "translations"))) {
  throw "Data root not found (expected translations/ inside): $DataRoot"
}
$DataRoot = (Resolve-Path $DataRoot).Path

$env:TRANSLATION_ROOT = $DataRoot
Push-Location (Join-Path $codeRoot "pipeline")
try {
  npm run build:extension
  if ($LASTEXITCODE -ne 0) {
    throw "npm run build:extension failed with exit code $LASTEXITCODE"
  }
} finally {
  Pop-Location
}

$dist = (Resolve-Path (Join-Path $codeRoot "dist\poe-ninja-korean")).Path
$manifest = Get-Content (Join-Path $dist "manifest.json") -Raw -Encoding UTF8 | ConvertFrom-Json
$zipPath = Join-Path $codeRoot "dist\poe-ninja-korean-v$($manifest.version).zip"
if (Test-Path $zipPath) {
  Remove-Item $zipPath -Force
}

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::Open(
  $zipPath,
  [System.IO.Compression.ZipArchiveMode]::Create
)
try {
  Get-ChildItem $dist -Recurse -File | ForEach-Object {
    $relative = $_.FullName.Substring($dist.Length + 1).Replace("\", "/")
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $archive,
      $_.FullName,
      $relative,
      [System.IO.Compression.CompressionLevel]::Optimal
    ) | Out-Null
  }
} finally {
  $archive.Dispose()
}

$hash = (Get-FileHash $zipPath -Algorithm SHA256).Hash
$size = (Get-Item $zipPath).Length
Write-Host "Created: $zipPath"
Write-Host ("Size: {0:N0} bytes" -f $size)
Write-Host "SHA256: $hash"
