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
  $PatchedAny = $false
  $ReactNativeJsInspectorDir = Join-Path $RootDir "node_modules\react-native\ReactCommon\jsinspector-modern"
  $WindowsTempJsInspectorDir = Join-Path $RootDir "node_modules\react-native-windows\ReactCommon\TEMP_UntilReactCommonUpdate\jsinspector-modern"
  $JsInspectorCompatibilityFiles = @(
    "NetworkIOAgent.cpp",
    "NetworkIOAgent.h"
  )

  if ((Test-Path $ReactNativeJsInspectorDir) -and (Test-Path $WindowsTempJsInspectorDir)) {
    foreach ($FileName in $JsInspectorCompatibilityFiles) {
      $SourcePath = Join-Path $ReactNativeJsInspectorDir $FileName
      $DestinationPath = Join-Path $WindowsTempJsInspectorDir $FileName
      if (!(Test-Path $SourcePath)) {
        continue
      }

      Copy-Item $SourcePath $DestinationPath -Force
      Write-Host "Synced jsinspector compatibility file: $DestinationPath"
      $PatchedAny = $true
    }
  }

  $ReactNativeTurboModuleDir = Join-Path $RootDir "node_modules\react-native\ReactCommon\react\nativemodule\core\ReactCommon"
  $WindowsTempTurboModuleDir = Join-Path $RootDir "node_modules\react-native-windows\ReactCommon\TEMP_UntilReactCommonUpdate\react\nativemodule\core\ReactCommon"
  if ((Test-Path $ReactNativeTurboModuleDir) -and (Test-Path $WindowsTempTurboModuleDir)) {
    Get-ChildItem $ReactNativeTurboModuleDir -File | Where-Object { $_.Extension -in ".h", ".cpp" } | ForEach-Object {
      $DestinationPath = Join-Path $WindowsTempTurboModuleDir $_.Name
      Copy-Item $_.FullName $DestinationPath -Force
      Write-Host "Synced TurboModule compatibility file: $DestinationPath"
      $PatchedAny = $true
    }
  }

  $ReactCommonProject = Join-Path $RootDir "node_modules\react-native-windows\ReactCommon\ReactCommon.vcxproj"
  if (Test-Path $ReactCommonProject) {
    $ReactCommonProjectText = Get-Content $ReactCommonProject -Raw
    $UpdatedReactCommonProjectText = $ReactCommonProjectText.Replace(
      '$(ReactNativeDir)\ReactCommon\jsinspector-modern\tracing\NetworkReporter.h',
      '$(ReactNativeDir)\ReactCommon\jsinspector-modern\network\NetworkHandler.h'
    ).Replace(
      '$(ReactNativeDir)\ReactCommon\jsinspector-modern\network\NetworkReporter.cpp',
      '$(ReactNativeDir)\ReactCommon\jsinspector-modern\network\NetworkHandler.cpp'
    ).Replace(
      '<DisableSpecificWarnings>4715;4251;4800;4804;4305;4722;%(DisableSpecificWarnings)</DisableSpecificWarnings>',
      '<DisableSpecificWarnings>4715;4251;4800;4804;4305;4722;4244;4267;4996;%(DisableSpecificWarnings)</DisableSpecificWarnings>'
    ).Replace(
      '    <ClInclude Include="$(ReactNativeDir)\ReactCommon\react\nativemodule\core\ReactCommon\TurboCxxModule.h" />' + [Environment]::NewLine,
      ''
    ).Replace(
      '    <ClCompile Include="$(ReactNativeDir)\ReactCommon\react\nativemodule\core\ReactCommon\TurboCxxModule.cpp" />' + [Environment]::NewLine,
      ''
    ).Replace(
      '    <ClInclude Include="$(ReactNativeDir)\ReactCommon\react\nativemodule\core\ReactCommon\TurboModuleBinding.h" />',
      '    <ClInclude Include="$(ReactNativeDir)\ReactCommon\react\nativemodule\core\ReactCommon\TurboModuleBinding.h" />' + [Environment]::NewLine +
      '    <ClInclude Include="$(ReactNativeDir)\ReactCommon\react\nativemodule\core\ReactCommon\CxxTurboModuleUtils.h" />' + [Environment]::NewLine +
      '    <ClInclude Include="$(ReactNativeDir)\ReactCommon\react\nativemodule\core\ReactCommon\TurboModulePerfLogger.h" />'
    ).Replace(
      '    <ClCompile Include="$(ReactNativeDir)\ReactCommon\react\nativemodule\core\ReactCommon\TurboModuleBinding.cpp" />',
      '    <ClCompile Include="$(ReactNativeDir)\ReactCommon\react\nativemodule\core\ReactCommon\TurboModuleBinding.cpp" />' + [Environment]::NewLine +
      '    <ClCompile Include="$(ReactNativeDir)\ReactCommon\react\nativemodule\core\ReactCommon\CxxTurboModuleUtils.cpp" />' + [Environment]::NewLine +
      '    <ClCompile Include="$(ReactNativeDir)\ReactCommon\react\nativemodule\core\ReactCommon\TurboModulePerfLogger.cpp" />'
    )

    if ($UpdatedReactCommonProjectText -ne $ReactCommonProjectText) {
      Set-Content -Path $ReactCommonProject -Value $UpdatedReactCommonProjectText -NoNewline
      Write-Host "Applied ReactCommon jsinspector project compatibility patch: $ReactCommonProject"
      $PatchedAny = $true
    } else {
      Write-Host "ReactCommon jsinspector project compatibility patch was not needed: $ReactCommonProject"
    }
  }

  $FabricUIManagerHeader = Join-Path $RootDir "node_modules\react-native-windows\Microsoft.ReactNative\Fabric\FabricUIManagerModule.h"
  if (Test-Path $FabricUIManagerHeader) {
    $FabricUIManagerHeaderText = Get-Content $FabricUIManagerHeader -Raw
    $HeaderNeedle = @(
      "  virtual void schedulerShouldRenderTransactions(",
      "      const std::shared_ptr<const facebook::react::MountingCoordinator> &mountingCoordinator) override;",
      "  virtual void schedulerDidRequestPreliminaryViewAllocation(const facebook::react::ShadowNode &shadowView) override;"
    ) -join [Environment]::NewLine
    $HeaderReplacement = @(
      "  virtual void schedulerShouldRenderTransactions(",
      "      const std::shared_ptr<const facebook::react::MountingCoordinator> &mountingCoordinator) override;",
      "  virtual void schedulerShouldMergeReactRevision(facebook::react::SurfaceId surfaceId) override;",
      "  virtual void schedulerDidRequestPreliminaryViewAllocation(const facebook::react::ShadowNode &shadowView) override;"
    ) -join [Environment]::NewLine
    $UpdatedFabricUIManagerHeaderText = $FabricUIManagerHeaderText.Replace($HeaderNeedle, $HeaderReplacement)
    if ($UpdatedFabricUIManagerHeaderText -eq $FabricUIManagerHeaderText) {
      $UpdatedFabricUIManagerHeaderText = $FabricUIManagerHeaderText.Replace(
        ($HeaderNeedle -replace "`r`n", "`n"),
        ($HeaderReplacement -replace "`r`n", "`n")
      )
    }

    if ($UpdatedFabricUIManagerHeaderText -ne $FabricUIManagerHeaderText) {
      Set-Content -Path $FabricUIManagerHeader -Value $UpdatedFabricUIManagerHeaderText -NoNewline
      Write-Host "Applied FabricUIManager SchedulerDelegate compatibility patch: $FabricUIManagerHeader"
      $PatchedAny = $true
    } else {
      Write-Host "FabricUIManager SchedulerDelegate compatibility patch was not needed: $FabricUIManagerHeader"
    }
  }

  $FabricUIManagerSource = Join-Path $RootDir "node_modules\react-native-windows\Microsoft.ReactNative\Fabric\FabricUIManagerModule.cpp"
  if (Test-Path $FabricUIManagerSource) {
    $FabricUIManagerSourceText = Get-Content $FabricUIManagerSource -Raw
    $SourceNeedle = @(
      "void FabricUIManager::schedulerShouldRenderTransactions(",
      "    const std::shared_ptr<const facebook::react::MountingCoordinator> &mountingCoordinator) {",
      "  if (m_context.UIDispatcher().HasThreadAccess()) {",
      "    initiateTransaction(mountingCoordinator);",
      "  } else {",
      "    m_context.UIDispatcher().Post(",
      "        [mountingCoordinator, self = shared_from_this()]() { self->initiateTransaction(mountingCoordinator); });",
      "  }",
      "}",
      "",
      "void FabricUIManager::schedulerDidRequestPreliminaryViewAllocation(const facebook::react::ShadowNode &shadowView) {"
    ) -join [Environment]::NewLine
    $SourceReplacement = @(
      "void FabricUIManager::schedulerShouldRenderTransactions(",
      "    const std::shared_ptr<const facebook::react::MountingCoordinator> &mountingCoordinator) {",
      "  if (m_context.UIDispatcher().HasThreadAccess()) {",
      "    initiateTransaction(mountingCoordinator);",
      "  } else {",
      "    m_context.UIDispatcher().Post(",
      "        [mountingCoordinator, self = shared_from_this()]() { self->initiateTransaction(mountingCoordinator); });",
      "  }",
      "}",
      "",
      "void FabricUIManager::schedulerShouldMergeReactRevision(facebook::react::SurfaceId /*surfaceId*/) {}",
      "",
      "void FabricUIManager::schedulerDidRequestPreliminaryViewAllocation(const facebook::react::ShadowNode &shadowView) {"
    ) -join [Environment]::NewLine
    $UpdatedFabricUIManagerSourceText = $FabricUIManagerSourceText.Replace($SourceNeedle, $SourceReplacement)
    if ($UpdatedFabricUIManagerSourceText -eq $FabricUIManagerSourceText) {
      $UpdatedFabricUIManagerSourceText = $FabricUIManagerSourceText.Replace(
        ($SourceNeedle -replace "`r`n", "`n"),
        ($SourceReplacement -replace "`r`n", "`n")
      )
    }

    if ($UpdatedFabricUIManagerSourceText -ne $FabricUIManagerSourceText) {
      Set-Content -Path $FabricUIManagerSource -Value $UpdatedFabricUIManagerSourceText -NoNewline
      Write-Host "Applied FabricUIManager SchedulerDelegate source compatibility patch: $FabricUIManagerSource"
      $PatchedAny = $true
    } else {
      Write-Host "FabricUIManager SchedulerDelegate source compatibility patch was not needed: $FabricUIManagerSource"
    }
  }

  $AbiDescriptorSources = @(
    (Join-Path $RootDir "node_modules\react-native-windows\Microsoft.ReactNative\Fabric\AbiComponentDescriptor.cpp"),
    (Join-Path $RootDir "node_modules\react-native-windows\Microsoft.ReactNative\Fabric\AbiViewComponentDescriptor.h")
  )

  foreach ($AbiDescriptorSource in $AbiDescriptorSources) {
    if (!(Test-Path $AbiDescriptorSource)) {
      continue
    }

    $AbiDescriptorText = Get-Content $AbiDescriptorSource -Raw
    $UpdatedAbiDescriptorText = $AbiDescriptorText.Replace(
      'std::make_shared<const ConcreteEventEmitter>(',
      'std::make_shared<ConcreteEventEmitter>('
    )

    if ($UpdatedAbiDescriptorText -ne $AbiDescriptorText) {
      Set-Content -Path $AbiDescriptorSource -Value $UpdatedAbiDescriptorText -NoNewline
      Write-Host "Applied ABI event emitter compatibility patch: $AbiDescriptorSource"
      $PatchedAny = $true
    } else {
      Write-Host "ABI event emitter compatibility patch was not needed: $AbiDescriptorSource"
    }
  }

  $CandidateSources = @(
    (Join-Path $RootDir "node_modules\react-native\ReactCommon\cxxreact\JSIndexedRAMBundle.cpp"),
    (Join-Path $RootDir "node_modules\react-native-windows\ReactCommon\TEMP_UntilReactCommonUpdate\cxxreact\JSIndexedRAMBundle.cpp")
  )

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

  $MapBufferSource = Join-Path $RootDir "node_modules\react-native\ReactCommon\react\renderer\mapbuffer\MapBuffer.cpp"
  if (Test-Path $MapBufferSource) {
    $MapBufferText = Get-Content $MapBufferSource -Raw
    $UpdatedMapBufferText = $MapBufferText.Replace(
      "    mapBufferLength = maxLength;",
      "    mapBufferLength = static_cast<int32_t>(maxLength);"
    )

    if ($UpdatedMapBufferText -ne $MapBufferText) {
      Set-Content -Path $MapBufferSource -Value $UpdatedMapBufferText -NoNewline
      Write-Host "Applied React Native Windows MapBuffer compatibility patch: $MapBufferSource"
      $PatchedAny = $true
    } else {
      Write-Host "React Native Windows MapBuffer compatibility patch was not needed: $MapBufferSource"
    }
  }

  # React Native 0.85 made SharedViewEventEmitter const-qualified
  # (std::shared_ptr<const ViewEventEmitter>) while SharedEventEmitter remains
  # non-const (std::shared_ptr<EventEmitter>). RNW 0.82 still expects the
  # implicit conversion to work. Cast away const so the function compiles.
  $CompositionEventHandlerSource = Join-Path $RootDir "node_modules\react-native-windows\Microsoft.ReactNative\Fabric\Composition\CompositionEventHandler.cpp"
  if (Test-Path $CompositionEventHandlerSource) {
    $CompositionEventHandlerText = Get-Content $CompositionEventHandlerSource -Raw
    if ($CompositionEventHandlerText.Contains("std::static_pointer_cast<const facebook::react::EventEmitter>(emitter)")) {
      Write-Host "CompositionEventHandler EventEmitter constness patch is already applied: $CompositionEventHandlerSource"
    } else {
      $CompositionEventHandlerNeedle = @(
        "  auto emitter = viewComponent->GetEventEmitter();",
        "  if (emitter)",
        "    return emitter;",
        "",
        "  for (auto it = view.Parent(); it; it = it.Parent()) {",
        "    auto emitter =",
        "        it.as<winrt::Microsoft::ReactNative::Composition::implementation::ComponentView>()->GetEventEmitter();",
        "    if (emitter)",
        "      return emitter;",
        "  }"
      ) -join [Environment]::NewLine
      $CompositionEventHandlerReplacement = @(
        "  auto emitter = viewComponent->GetEventEmitter();",
        "  if (emitter)",
        "    return std::const_pointer_cast<facebook::react::EventEmitter>(",
        "        std::static_pointer_cast<const facebook::react::EventEmitter>(emitter));",
        "",
        "  for (auto it = view.Parent(); it; it = it.Parent()) {",
        "    auto emitter =",
        "        it.as<winrt::Microsoft::ReactNative::Composition::implementation::ComponentView>()->GetEventEmitter();",
        "    if (emitter)",
        "      return std::const_pointer_cast<facebook::react::EventEmitter>(",
        "          std::static_pointer_cast<const facebook::react::EventEmitter>(emitter));",
        "  }"
      ) -join [Environment]::NewLine
      $UpdatedCompositionEventHandlerText = $CompositionEventHandlerText.Replace(
        $CompositionEventHandlerNeedle,
        $CompositionEventHandlerReplacement
      )
      if ($UpdatedCompositionEventHandlerText -eq $CompositionEventHandlerText) {
        $UpdatedCompositionEventHandlerText = $CompositionEventHandlerText.Replace(
          ($CompositionEventHandlerNeedle -replace "`r`n", "`n"),
          ($CompositionEventHandlerReplacement -replace "`r`n", "`n")
        )
      }
      if ($UpdatedCompositionEventHandlerText -ne $CompositionEventHandlerText) {
        Set-Content -Path $CompositionEventHandlerSource -Value $UpdatedCompositionEventHandlerText -NoNewline
        Write-Host "Applied CompositionEventHandler EventEmitter constness patch: $CompositionEventHandlerSource"
        $PatchedAny = $true
      } else {
        Write-Host "CompositionEventHandler EventEmitter constness patch was not needed: $CompositionEventHandlerSource"
      }
    }
  }

  # React Native 0.85 changed ImageResponseObserverCoordinator::addObserver /
  # removeObserver to take std::shared_ptr<const ImageResponseObserver> instead
  # of a const ImageResponseObserver&. RNW 0.82 still calls them with a
  # dereferenced shared_ptr<WindowsImageResponseObserver>. Forward the
  # shared_ptr (cast to the base type) instead.
  $ImageComponentViewSource = Join-Path $RootDir "node_modules\react-native-windows\Microsoft.ReactNative\Fabric\Composition\ImageComponentView.cpp"
  if (Test-Path $ImageComponentViewSource) {
    $ImageComponentViewText = Get-Content $ImageComponentViewSource -Raw
    if ($ImageComponentViewText.Contains("std::static_pointer_cast<const facebook::react::ImageResponseObserver>(m_imageResponseObserver)")) {
      Write-Host "ImageComponentView observer compatibility patch is already applied: $ImageComponentViewSource"
    } else {
      $UpdatedImageComponentViewText = $ImageComponentViewText.Replace(
        "observerCoordinator.removeObserver(*m_imageResponseObserver);",
        "observerCoordinator.removeObserver(std::static_pointer_cast<const facebook::react::ImageResponseObserver>(m_imageResponseObserver));"
      ).Replace(
        "observerCoordinator.addObserver(*m_imageResponseObserver);",
        "observerCoordinator.addObserver(std::static_pointer_cast<const facebook::react::ImageResponseObserver>(m_imageResponseObserver));"
      )

      if ($UpdatedImageComponentViewText -ne $ImageComponentViewText) {
        Set-Content -Path $ImageComponentViewSource -Value $UpdatedImageComponentViewText -NoNewline
        Write-Host "Applied ImageComponentView observer compatibility patch: $ImageComponentViewSource"
        $PatchedAny = $true
      } else {
        Write-Host "ImageComponentView observer compatibility patch was not needed: $ImageComponentViewSource"
      }
    }
  }

  # React Native 0.85 added a MeasuredPreparedTextLayout measuredLayout member
  # and a 4-arg constructor to the Android variant of ParagraphState. RNW 0.82
  # picks up that header through its include path but the Windows toolchain
  # fails to recognise `MeasuredPreparedTextLayout`. Strip the new member and
  # constructor so the file compiles back to its 0.82-compatible shape.
  $ParagraphStateAndroidHeader = Join-Path $RootDir "node_modules\react-native\ReactCommon\react\renderer\components\text\platform\android\react\renderer\components\text\ParagraphState.h"
  $ParagraphStateFixture = Join-Path $PSScriptRoot "patches\ParagraphState.android.h"
  if ((Test-Path $ParagraphStateAndroidHeader) -and (Test-Path $ParagraphStateFixture)) {
    $ExistingText = Get-Content $ParagraphStateAndroidHeader -Raw
    $FixtureText = Get-Content $ParagraphStateFixture -Raw
    if ($ExistingText -ne $FixtureText) {
      Copy-Item -Path $ParagraphStateFixture -Destination $ParagraphStateAndroidHeader -Force
      Write-Host "Replaced ParagraphState.h with 0.82-compatible fixture: $ParagraphStateAndroidHeader"
      $PatchedAny = $true
    } else {
      Write-Host "ParagraphState.h already matches fixture: $ParagraphStateAndroidHeader"
    }
  }

  if (!$PatchedAny) {
    Write-Host "No Windows React Native source files required patching."
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

Write-Step "Update Windows native module autolinks"
npx @react-native-community/cli autolink-windows `
  --sln "windows\OffhandReactnative.sln" `
  --proj "windows\OffhandReactnative\OffhandReactnative.vcxproj"

if ($LASTEXITCODE -ne 0) {
  throw "Windows autolink failed with exit code $LASTEXITCODE"
}

Write-Step "Build Windows package"
$MSBuild = Get-MSBuildPath
$ReactNativeWindowsDir = Join-Path $RootDir "node_modules\react-native-windows"
$SolutionPath = Join-Path $WindowsDir "OffhandReactnative.sln"
& $MSBuild $PackageProject `
  /m `
  /restore `
  "/p:Configuration=$Configuration" `
  "/p:Platform=$Platform" `
  "/p:SolutionDir=$WindowsDir\" `
  "/p:SolutionPath=$SolutionPath" `
  "/p:SolutionFileName=OffhandReactnative.sln" `
  "/p:ReactNativeWindowsDir=$ReactNativeWindowsDir\" `
  "/p:AppxBundle=Never" `
  "/p:UapAppxPackageBuildMode=SideloadOnly" `
  "/p:AppxPackageSigningEnabled=false" `
  "/p:WindowsAppSDKVerifyTransitiveDependencies=false" `
  "/p:RnwNewArch=true" `
  "/p:UseWinUI3=true" `
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
