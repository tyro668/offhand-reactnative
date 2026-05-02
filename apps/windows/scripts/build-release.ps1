$ErrorActionPreference = "Stop"

$appRoot = Split-Path -Parent $PSScriptRoot
$solutionPath = Join-Path $appRoot "windows\OffhandReactnative.sln"
$distDir = Join-Path $appRoot "dist\windows"
$packageDir = Join-Path $appRoot "windows\OffhandReactnative.Package\AppPackages"
$platform = if ($env:OFFHAND_WINDOWS_PLATFORM) { $env:OFFHAND_WINDOWS_PLATFORM } else { "x64" }
$configuration = if ($env:OFFHAND_WINDOWS_CONFIGURATION) { $env:OFFHAND_WINDOWS_CONFIGURATION } else { "Release" }

function Get-MSBuildPath {
  $msbuild = Get-Command msbuild.exe -ErrorAction SilentlyContinue
  if ($msbuild) {
    return $msbuild.Source
  }

  $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
  if (Test-Path $vswhere) {
    $installPath = & $vswhere -latest -products * -requires Microsoft.Component.MSBuild -property installationPath
    if ($installPath) {
      $candidate = Join-Path $installPath "MSBuild\Current\Bin\MSBuild.exe"
      if (Test-Path $candidate) {
        return $candidate
      }
    }
  }

  throw "MSBuild.exe was not found. Install Visual Studio 2022 Build Tools with Desktop development for C++ and UWP."
}

if (!(Test-Path $solutionPath)) {
  throw "Windows solution not found at $solutionPath"
}

New-Item -ItemType Directory -Force -Path $distDir | Out-Null
if (Test-Path $packageDir) {
  Remove-Item -Recurse -Force $packageDir
}

npm run bundle

$msbuildPath = Get-MSBuildPath
& $msbuildPath $solutionPath `
  /restore `
  /m `
  /p:Configuration=$configuration `
  /p:Platform=$platform `
  /p:GenerateAppxPackageOnBuild=true `
  /p:AppxBundle=Never `
  /p:UapAppxPackageBuildMode=SideloadOnly `
  /p:AppxPackageSigningEnabled=false

if ($LASTEXITCODE -ne 0) {
  throw "MSBuild failed with exit code $LASTEXITCODE"
}

if (!(Test-Path $packageDir)) {
  throw "Expected package output was not created at $packageDir"
}

$zipPath = Join-Path $distDir "offhand-windows-$platform.zip"
if (Test-Path $zipPath) {
  Remove-Item -Force $zipPath
}
Compress-Archive -Path (Join-Path $packageDir "*") -DestinationPath $zipPath -Force
Write-Host "Windows release package: $zipPath"
