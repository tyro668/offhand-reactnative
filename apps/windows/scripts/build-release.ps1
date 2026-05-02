$ErrorActionPreference = "Stop"

$appRoot = Split-Path -Parent $PSScriptRoot
$solutionPath = Join-Path $appRoot "windows\OffhandReactnative.sln"
$distDir = Join-Path $appRoot "dist\windows"
$packageDir = Join-Path $appRoot "windows\OffhandReactnative.Package\AppPackages"
$platform = if ($env:OFFHAND_WINDOWS_PLATFORM) { $env:OFFHAND_WINDOWS_PLATFORM } else { "x64" }
$configuration = if ($env:OFFHAND_WINDOWS_CONFIGURATION) { $env:OFFHAND_WINDOWS_CONFIGURATION } else { "Release" }
$windowsTargetPlatformVersion = if ($env:OFFHAND_WINDOWS_SDK_VERSION) { $env:OFFHAND_WINDOWS_SDK_VERSION } else { "10.0.22621.0" }
$windowsAppSdkFallbackPlatform = if ($env:OFFHAND_WINDOWS_APP_SDK_FALLBACK_PLATFORM) { $env:OFFHAND_WINDOWS_APP_SDK_FALLBACK_PLATFORM } else { "x86" }

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

function Repair-WindowsAppSdkFoundationProps {
  $nugetRoot = if ($env:NUGET_PACKAGES) { $env:NUGET_PACKAGES } else { Join-Path $env:USERPROFILE ".nuget\packages" }
  $foundationRoot = Join-Path $nugetRoot "microsoft.windowsappsdk.foundation"
  if (!(Test-Path $foundationRoot)) {
    Write-Host "Windows App SDK Foundation package was not restored under $foundationRoot"
    return
  }

  $propsFileNames = @(
    "MrtCore.C.props",
    "WindowsAppSDK-Nuget-Native.C.props",
    "WindowsAppSDK-Nuget-Native.WinRt.props"
  )
  $propsFiles = Get-ChildItem -Path $foundationRoot -Recurse -File | Where-Object { $propsFileNames -contains $_.Name }

  $patches = @(
    @{
      Anchor = '    <_WindowsAppSDKFoundationPlatform Condition="''$(Platform)'' != ''Win32''">$(Platform)</_WindowsAppSDKFoundationPlatform>'
      Fallback = "    <_WindowsAppSDKFoundationPlatform Condition=""'`$(_WindowsAppSDKFoundationPlatform)' == ''"">$windowsAppSdkFallbackPlatform</_WindowsAppSDKFoundationPlatform>"
    },
    @{
      Anchor = '    <_MrtCoreRuntimeIdentifier Condition="''$(Platform)'' != ''Win32''">$(Platform)</_MrtCoreRuntimeIdentifier>'
      Fallback = "    <_MrtCoreRuntimeIdentifier Condition=""'`$(_MrtCoreRuntimeIdentifier)' == ''"">$windowsAppSdkFallbackPlatform</_MrtCoreRuntimeIdentifier>"
    }
  )

  foreach ($propsFile in $propsFiles) {
    $content = Get-Content -Raw -Path $propsFile.FullName
    $updatedContent = $content

    foreach ($patch in $patches) {
      $anchor = $patch["Anchor"]
      $fallback = $patch["Fallback"]
      if ($updatedContent.Contains($fallback) -or !$updatedContent.Contains($anchor)) {
        continue
      }

      $updatedContent = $updatedContent.Replace($anchor, "$anchor`r`n$fallback")
    }

    if ($updatedContent -ne $content) {
      Set-Content -Path $propsFile.FullName -Value $updatedContent -NoNewline -Encoding UTF8
      Write-Host "Patched Windows App SDK platform fallback in $($propsFile.FullName)"
    }
  }
}

function Repair-HermesProps {
  $nugetRoot = if ($env:NUGET_PACKAGES) { $env:NUGET_PACKAGES } else { Join-Path $env:USERPROFILE ".nuget\packages" }
  $hermesRoot = Join-Path $nugetRoot "microsoft.javascript.hermes"
  if (!(Test-Path $hermesRoot)) {
    Write-Host "Hermes package was not restored under $hermesRoot"
    return
  }

  $anchor = '    <HermesPlatform Condition="''$(HermesPlatform)'' == ''Win32''">x86</HermesPlatform>'
  $fallback = "    <HermesPlatform Condition=""'`$(HermesPlatform)' == ''"">$windowsAppSdkFallbackPlatform</HermesPlatform>"
  $propsFiles = Get-ChildItem -Path $hermesRoot -Recurse -File -Filter "Microsoft.JavaScript.Hermes.props"

  foreach ($propsFile in $propsFiles) {
    $content = Get-Content -Raw -Path $propsFile.FullName
    if ($content.Contains($fallback) -or !$content.Contains($anchor)) {
      continue
    }

    $updatedContent = $content.Replace($anchor, "$anchor`r`n$fallback")
    Set-Content -Path $propsFile.FullName -Value $updatedContent -NoNewline -Encoding UTF8
    Write-Host "Patched Hermes platform fallback in $($propsFile.FullName)"
  }
}

if (!(Test-Path $solutionPath)) {
  throw "Windows solution not found at $solutionPath"
}

New-Item -ItemType Directory -Force -Path $distDir | Out-Null
if (Test-Path $packageDir) {
  Remove-Item -Recurse -Force $packageDir
}

npm run bundle
npx @react-native-community/cli autolink-windows --sln "windows\OffhandReactnative.sln" --proj "windows\OffhandReactnative\OffhandReactnative.vcxproj"

$msbuildPath = Get-MSBuildPath
$msbuildArgs = @(
  "/p:Configuration=$configuration",
  "/p:Platform=$platform",
  "/p:WindowsTargetPlatformVersion=$windowsTargetPlatformVersion",
  "/p:GenerateAppxPackageOnBuild=true",
  "/p:AppxBundle=Never",
  "/p:UapAppxPackageBuildMode=SideloadOnly",
  "/p:AppxPackageSigningEnabled=false",
  "/p:WindowsAppSDKVerifyTransitiveDependencies=false",
  "/p:WindowsAppSdkBootstrapInitialize=false",
  "/p:WindowsAppSdkDeploymentManagerInitialize=false"
)

& $msbuildPath $solutionPath /t:Restore @msbuildArgs
if ($LASTEXITCODE -ne 0) {
  throw "MSBuild restore failed with exit code $LASTEXITCODE"
}

Repair-WindowsAppSdkFoundationProps
Repair-HermesProps

& $msbuildPath $solutionPath /m @msbuildArgs

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
