param(
  [ValidateSet("x64", "x86", "ARM64")]
  [string]$Platform = "x64",
  [ValidateSet("Debug", "Release")]
  [string]$Configuration = "Release"
)

$ErrorActionPreference = "Stop"

$RootDir = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $RootDir
$WindowsDir = Join-Path $RootDir "windows"
$AppProjectDir = Join-Path $WindowsDir "OffhandReactnative"
$PackageProject = Join-Path $WindowsDir "OffhandReactnative.Package\OffhandReactnative.Package.wapproj"
$BundleDir = Join-Path $AppProjectDir "Bundle"
$DistDir = Join-Path $RootDir "dist\windows"
$Version = node -p "require('./package.json').version || '0.0.0'"
$ZipPath = Join-Path $DistDir "释手-Windows-$Version-$Platform.zip"

function Write-Step([string]$Message) {
  Write-Host ""
  Write-Host "> $Message"
}

function Get-MSBuildPath {
  $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
  if (Test-Path $vswhere) {
    $found = & $vswhere -latest -requires Microsoft.Component.MSBuild -find "MSBuild\**\Bin\MSBuild.exe" | Select-Object -First 1
    if ($found) {
      return $found
    }
  }

  $command = Get-Command msbuild.exe -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  throw "MSBuild was not found. Install Visual Studio 2022 with Desktop development with C++ and UWP/Desktop Bridge tools."
}

function Repair-ReactNativeWindowsSources {
  $CandidateSources = @(
    (Join-Path $RootDir "node_modules\react-native\ReactCommon\cxxreact\JSIndexedRAMBundle.cpp"),
    (Join-Path $RootDir "node_modules\react-native-windows\ReactCommon\TEMP_UntilReactCommonUpdate\cxxreact\JSIndexedRAMBundle.cpp")
  )
  $PatchedAny = $false

  foreach ($BundleSource in $CandidateSources) {
    if (!(Test-Path $BundleSource)) {
      continue
    }

    $Text = Get-Content $BundleSource -Raw
    if ($Text.Contains("readBundle(m_startupCode->mutableData(), startupCodeSize - 1);")) {
      Write-Host "RAM bundle startup-code patch is already applied: $BundleSource"
      continue
    }

    $UpdatedText = $Text.Replace(
      "readBundle(m_startupCode->data(), startupCodeSize - 1);",
      "readBundle(m_startupCode->mutableData(), startupCodeSize - 1);"
    )

    $UpdatedText = $UpdatedText.Replace(
      "readBundle(bundle.data(), bundle.size());",
      "readBundle(reinterpret_cast<char *>(const_cast<uint8_t *>(bundle.data())), static_cast<std::streamsize>(bundle.size()));"
    )

    if ($UpdatedText -ne $Text) {
      Set-Content -Path $BundleSource -Value $UpdatedText -NoNewline
      Write-Host "Applied React Native Windows RAM bundle compatibility patch: $BundleSource"
      $PatchedAny = $true
      continue
    }

    Write-Host "React Native Windows RAM bundle compatibility patch was not needed: $BundleSource"
  }

  if (!$PatchedAny) {
    Write-Host "No Windows RAM bundle source files required patching."
  }
}

Write-Step "Patch React Native Windows sources"
Repair-ReactNativeWindowsSources

Write-Step "Generate Windows JS bundle"
if (Test-Path $BundleDir) {
  Remove-Item $BundleDir -Recurse -Force
}
New-Item -ItemType Directory -Path $BundleDir | Out-Null

npx react-native bundle `
  --platform windows `
  --entry-file index.js `
  --bundle-output (Join-Path $BundleDir "index.windows.bundle") `
  --assets-dest $BundleDir `
  --dev false `
  --reset-cache

Write-Step "Build Windows package"
$MSBuild = Get-MSBuildPath
& $MSBuild $PackageProject `
  /m `
  /restore `
  "/p:Configuration=$Configuration" `
  "/p:Platform=$Platform" `
  "/p:AppxBundle=Never" `
  "/p:UapAppxPackageBuildMode=SideloadOnly" `
  "/p:AppxPackageSigningEnabled=false" `
  "/p:GenerateAppxPackageOnBuild=true"

if ($LASTEXITCODE -ne 0) {
  throw "MSBuild failed with exit code $LASTEXITCODE"
}

Write-Step "Collect Windows artifacts"
if (Test-Path $DistDir) {
  Remove-Item $DistDir -Recurse -Force
}
New-Item -ItemType Directory -Path $DistDir | Out-Null

$PackageRoot = Join-Path $WindowsDir "OffhandReactnative.Package\AppPackages"
if (!(Test-Path $PackageRoot)) {
  throw "Windows package output was not produced at $PackageRoot"
}

$artifactFiles = Get-ChildItem $PackageRoot -Recurse -File |
  Where-Object { $_.Extension -in ".appx", ".msix", ".appxbundle", ".msixbundle", ".cer", ".ps1" }

if (!$artifactFiles -or $artifactFiles.Count -eq 0) {
  throw "No Windows package artifacts were found under $PackageRoot"
}

$CollectDir = Join-Path $DistDir "释手-Windows-$Version-$Platform"
New-Item -ItemType Directory -Path $CollectDir | Out-Null
foreach ($file in $artifactFiles) {
  Copy-Item $file.FullName -Destination (Join-Path $CollectDir $file.Name) -Force
}

if (Test-Path $ZipPath) {
  Remove-Item $ZipPath -Force
}
Compress-Archive -Path (Join-Path $CollectDir "*") -DestinationPath $ZipPath -Force

Write-Host ""
Write-Host "Windows release build complete."
Write-Host "Artifacts: $CollectDir"
Write-Host "Zip: $ZipPath"
