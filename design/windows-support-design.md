# Windows 支持最佳方案设计

日期：2026-05-02

## 结论

Windows 版应按“独立 RNW 应用壳 + 共享业务层 + Windows 原生能力模块”的方式落地，而不是继续在一个 `package.json` 里强行混用 macOS 与 Windows 的 out-of-tree 平台依赖。

当前根目录依赖为 `react-native@0.85.2`、`react-native-macos@0.81.7`、`react-native-windows@0.82.5`。本地核对 npm metadata 后，`react-native-macos@0.81.7` peer 依赖 `react-native@0.81.6`，`react-native-windows@0.82.5` peer 依赖 `react-native@^0.82.0`。旧的 `scripts/build-windows-release.ps1` 曾通过大量 patch 修改 `node_modules` 来让 RNW 0.82 编译 RN 0.85 代码，这条路会持续放大维护成本。最佳方案是拆出平台应用壳，让 macOS 与 Windows 各自使用可支持的 RN 版本线，业务代码通过 workspace 共享。

## 硬性约束

- 禁止对 `react-native`、`react-native-windows`、`react-native-macos`、Hermes、ReactCommon 或 `node_modules` 做源码级 hook、patch、替换头文件、postinstall 改写。
- 禁止在 CI 或 release 脚本里复制、sed、PowerShell rewrite 上游依赖源码。
- 禁止依赖私有 fork 的 RN/RNW 来完成核心构建。若未来确需上游修复，先升级到已发布版本；不能升级时，该功能降级或延期。
- Windows 原生能力必须通过官方扩展点实现：RNW 应用工程、C++/WinRT Turbo Native Module、Win32/WinRT API、独立 helper 进程、MSBuild/NuGet 配置。
- GitHub Actions 必须能从 clean checkout 编译安装包；构建链路不得依赖开发者本机状态。

## 提前声明的限制

- **硬件 fn 键不做**：Windows 下大多数键盘的 fn 在固件层处理，不稳定暴露给 OS。第一版使用 F8；后续可支持用户选择其它标准快捷键。
- **管理员权限窗口无法保证写入**：Windows UIPI 限制普通权限进程向更高完整性级别窗口注入输入。遇到管理员权限应用、UAC 安全桌面或受保护窗口时，只能降级为复制到剪贴板并提示用户手动粘贴。
- **独占全屏覆盖无法保证**：Win32 topmost overlay 可覆盖普通窗口、无边框全屏和大多数桌面场景，但不能承诺覆盖 DirectX 独占全屏游戏或安全桌面。
- **麦克风隐私不能自动打开**：如果用户在 Windows 隐私设置里禁用麦克风，应用只能检测失败并打开设置页，不能静默授权。
- **CI 不能验证交互能力**：GitHub-hosted Windows runner 可以编译和跑单元测试，但无法可靠验证真实麦克风、全局热键、跨应用 `SendInput` 粘贴。交互验收需要手动测试或后续自建 Windows 桌面 runner。
- **可安装包必须签名**：GitHub Actions 可以生成 MSIX 和证书。内测可使用 CI 生成或仓库 secret 注入的证书；正式分发需要可信代码签名证书，否则会有 SmartScreen/证书信任提示。

## 目标

- Windows 10/11 x64 可安装、可启动、可长期使用。
- 使用全局快捷键启动/停止录音。Windows 默认使用 F8，不承诺支持硬件 fn 键。
- 录音状态 overlay 独立于配置窗口，不抢焦点，可覆盖普通窗口和全屏窗口。
- 录音结束后执行本地 ASR、LLM 润色，并把最终文本写入当前光标位置。
- ASR runtime 与模型仍按需下载，不随安装包内置。
- 构建链路不修改 `node_modules`，不依赖一次性兼容补丁。
- Windows 安装包可由 GitHub Actions 从 clean checkout 编译并上传 artifact。
- Windows CI 依赖尽量少：Node.js、npm、MSBuild/Visual Studio Build Tools、NuGet/MSIX 工具链，其余依赖随 repo 或 npm/NuGet 恢复。

## 非目标

- 不在第一版支持 Windows ARM64。
- 不在第一版做 Microsoft Store 上架。
- 不保证向管理员权限窗口或更高完整性级别窗口注入文本。
- 不做 macOS 与 Windows 之间的数据自动同步。

## 关键决策

### 1. 工程结构

建议调整为 workspace：

```text
apps/
  macos/                 # macOS React Native macOS 应用壳
  windows/               # React Native Windows 应用壳
packages/
  app-shared/            # App.tsx、src/、assets、业务服务与 UI
  native-specs/          # NativeModule TS specs 与平台适配层
design/
```

短期可先保留现有根目录 macOS 工程，把 Windows 新工程放到 `apps/windows`，通过 Metro alias 引用根目录 `src/`。中期再把共享代码搬到 `packages/app-shared`。

版本线建议：

- macOS：维持当前已验证链路，后续单独升级。
- Windows：使用 `react-native@0.82.x` + `react-native-windows@0.82.x`，按 RNW 官方 `init-windows` / `run-windows` / `codegen-windows` 流程生成 WinUI 3 C++ 工程。
- Windows 的 `package.json` 与 lockfile 放在 `apps/windows`，只安装 Windows 需要的依赖，不把 `react-native-macos` 放进 Windows app 的依赖树。
- 根目录脚本只做编排，不让 Windows build 脚本 patch RN/RNW 源码。

Windows app 最小依赖原则：

- JS 依赖：`react`、`react-native`、`react-native-windows`、共享包、当前 UI 需要的 RN 兼容依赖。
- Native 依赖：RNW NuGet、Windows App SDK、Microsoft C++ toolchain，全部通过 Visual Studio runner / NuGet restore 获得。
- 不引入 Electron、.NET 桌面外壳、WiX/Inno Setup、Chocolatey 安装步骤、Python/CMake 额外构建链，除非某个已确认必需的上游依赖要求。
- `OffhandSherpaHelper.exe` 放进同一个 Visual Studio solution，由 MSBuild 一起编译，避免 CI 额外安装第三方 C++ 构建系统。

### 2. 原生模块边界

现有 JS 工作流依赖这些模块：

- `OverlayManager`
- `AudioRecorder`
- `TextInserter`
- `SherpaTranscriber`
- `ModelDownloader`
- `AppPaths`
- `MarkdownFileImporter`（Windows 可后置）

Windows 侧统一用 C++/WinRT Turbo Native Modules 实现，并保留 JS adapter，使现有 `NativeModules.*` 调用能逐步迁移到 spec：

```text
src/native/
  NativeOverlayManager.ts
  NativeAudioRecorder.ts
  NativeTextInserter.ts
  NativeSherpaTranscriber.ts
  NativeModelDownloader.ts
  NativeAppPaths.ts
```

JS 层 `RecorderWorkflow.ts` 不应关心平台细节，只消费相同事件和方法。

## Windows 原生实现

### OverlayManager

职责：

- 注册/注销全局快捷键。
- 维护录音状态，并向 JS 发送 `onRecordingStateChange`。
- 创建不抢焦点的录音 overlay 窗口。
- 提供日志与权限状态 API。

快捷键策略：

- 默认注册 F8，使用 Win32 `RegisterHotKey`，接收 `WM_HOTKEY`。
- 使用 `MOD_NOREPEAT` 避免长按重复触发。
- 若 F8 被其他应用占用，返回明确错误并在设置页提示用户改快捷键。第一版可只内置 F8，第二版再开放配置。
- 不使用硬件 fn 键。多数 Windows 键盘的 fn 在键盘固件层处理，不稳定暴露为系统虚拟键；现有 `ShortcutSettings.tsx` 已写明 Windows 使用 F8。

Overlay 窗口：

- 创建独立 WinUI 3 / XAML 窗口或轻量 Win32 layered window。
- 推荐第一版使用独立 WinUI 3 窗口承载原生 XAML UI，便于复刻 macOS `OverlayView` 状态。
- 通过 HWND interop 设置 `WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE`，并用 `SetWindowPos(HWND_TOPMOST, ..., SWP_NOACTIVATE | SWP_SHOWWINDOW)` 保持前置且不抢焦点。
- 使用 `MonitorFromWindow` + work area 把窗口放在当前活动显示器底部居中。

权限 API 映射：

- `accessibility`：Windows 不需要，返回 `true`。
- `inputMonitoring`：热键注册成功则为 `true`，失败返回 `false` 并带错误信息。
- `microphone`：读取 Windows 隐私状态可作为增强项；第一版可在录音初始化失败时提示并打开 `ms-settings:privacy-microphone`。

### AudioRecorder

职责：

- 录制麦克风音频到 WAV 文件。
- 输出 `onRecordComplete({success, filePath, error?})`。
- 可选输出 `onAudioLevel({level})`；当前 JS 已不依赖真实 level，overlay 可继续原生模拟。

推荐实现：

- 使用 C++/WinRT `Windows.Media.Capture.MediaCapture`，初始化 `StreamingCaptureMode::Audio`。
- package manifest 声明 `microphone` capability。
- 录音文件写到 `AppPaths.recordingsDirectory()`，命名保持 `recording_yyyyMMdd_HHmmss.wav`。
- 使用 WAV profile；录音完成后校验文件可被 Sherpa 读取。若 profile 不能稳定产出 16k/mono/PCM，则增加 Media Foundation 归一化步骤，把文件转为 16k mono PCM WAV 后再发给 JS。

备选方案：

- 若 `MediaCapture` 在权限、格式或后台行为上不可控，改用 WASAPI shared-mode capture + Media Foundation resampler。WASAPI 能精确控制 PCM 流，但实现成本高于 `MediaCapture`。

### TextInserter

职责：

- 把润色后的文本插入当前光标所在位置。
- 尽量恢复用户剪贴板。
- 避免在终端里因尾随换行触发命令。

推荐插入策略：

1. 清理文本尾部 `\r` / `\n`。
2. 记录当前剪贴板所有可恢复格式，设置 `CF_UNICODETEXT` 为临时文本。
3. 使用 `SendInput` 发送 `Ctrl+V`。
4. 800-1200ms 后恢复剪贴板。若剪贴板内容超过阈值，例如 20MB，只恢复文本类格式或放弃恢复，避免内存峰值。
5. 失败时保留文本在剪贴板并返回错误，让 UI 提示用户手动粘贴。

UI Automation 只作为辅助：

- 可用于检查当前焦点控件是否可编辑。
- 不作为主插入手段。`ValuePattern.SetValue()` 容易替换整个输入框内容，而不是在光标处插入；`TextPattern` 也不提供通用写入能力。

限制：

- Windows UIPI 限制下，普通权限应用不能向管理员权限窗口可靠注入输入。此时应提示“已复制到剪贴板，请手动粘贴”。

### AppPaths

Windows 数据目录使用：

```text
%LOCALAPPDATA%\Offhand-native
  Logs\
  Recordings\
  Database\
  models\
  sherpa-onnx\runtime\
```

需要新增 Windows `AppPaths` NativeModule，方法与 macOS 对齐：

- `getPaths()`
- `getAppDir()`
- `getDatabaseOpenOptions(databaseName)`

同时把 `src/db/database.ts` 的平台判断从 `Platform.OS === 'macos'` 扩展为 `macos || windows`，让 Windows SQLite 也打开到统一数据目录。

### ModelDownloader

职责：

- 下载 Sherpa runtime archive。
- 下载 SenseVoice / Whisper 模型文件。
- 发送下载进度与完成事件。
- 安装 runtime 到 `sherpa-onnx/runtime/current`。

实现建议：

- C++/WinRT 使用 `Windows.Web.Http.HttpClient` 或 WinHTTP 下载文件，写入临时文件后原子移动。
- 下载事件保持 `onDownloadProgress` / `onDownloadComplete`，字段与 macOS 一致。
- runtime archive 使用现有 JS 中定义的 Windows 文件：

```text
sherpa-onnx-v1.12.39-win-x64-shared-MD-MinSizeRel-no-tts-lib.tar.bz2
```

- 解压后递归查找 `sherpa-onnx-c-api.dll` 与 `onnxruntime.dll`，再归一化到：

```text
sherpa-onnx/runtime/current/
  bin/
    sherpa-onnx-c-api.dll
    onnxruntime.dll
  lib/
  include/
```

- 第一版可调用系统 `tar.exe -xjf` 解包；若目标 Windows 版本或企业环境不可靠，再引入 libarchive 或改为下载 zip 资产。

### SherpaTranscriber

职责：

- 判断 runtime / model 是否就绪。
- 以子进程方式运行 Sherpa 推理，空闲后释放内存。
- 提供 `transcribeFile(filePath, engine, modelKey, language)`。

推荐实现：

- 新建 `OffhandSherpaHelper.exe` 控制台子进程，作为 Windows 工程中的独立 C++ 项目，随 MSIX 一起打包。
- 父进程通过 `CreateProcessW` + anonymous pipes 与 helper 用 JSON lines 通信，协议复用 macOS：

```json
{"cmd":"transcribe","runtimeDir":"...","engine":"sensevoice","modelKey":"senseVoiceSmall","modelDir":"...","language":"auto","filePath":"..."}
```

- helper 使用 `LoadLibraryW` / `GetProcAddress` 动态加载 `sherpa-onnx-c-api.dll`，先加载 `onnxruntime.dll`，再加载 Sherpa C API。
- 保留 recognizer 缓存，按 `engine|modelKey|modelDir|language` 复用。
- 父进程保留当前 `setIdleReleaseTimeoutMs` 语义，空闲到期后关闭 helper。

这样可以把 ONNX Runtime 的内存生命周期与主 RNW UI 进程隔离，行为与 macOS 一致。

### MarkdownFileImporter

Windows 第一版不是主流程阻塞项。需要时用 WinRT `FileOpenPicker` 实现 `.md` 文件选择和读取，API 对齐 macOS：

```ts
importMarkdownFile(): Promise<{
  fileName?: string;
  filePath?: string;
  content?: string;
} | null>
```

## 安装与分发

第一版使用 MSIX sideload：

- `apps/windows/windows/OffhandReactnative.sln`
- `OffhandReactnative.Package.wapproj`
- x64 Release
- 产物输出：

```text
dist/windows/释手-Windows-<version>-x64/
dist/windows/释手-Windows-<version>-x64.zip
```

manifest 必需项：

- `runFullTrust`：桌面全信任能力，用于 Win32 hotkey、SendInput、helper 子进程、文件系统。
- `microphone`：麦克风能力。
- `internetClient`：下载 runtime/model 与访问 LLM API。

签名策略：

- 开发阶段：本地 self-signed cert + 安装脚本。
- GitHub Actions 内测包：优先使用 repository secrets 注入 PFX 证书；没有证书时由 CI 生成临时 self-signed cert，产物同时上传 `.msix`、`.cer` 和 `Install.ps1`。安装脚本把 `.cer` 导入 CurrentUser TrustedPeople 后安装 MSIX。
- 正式分发：使用组织代码签名证书或受信任证书签名。是否上 Store 单独评估，因为全局热键、输入注入、helper 进程可能触发额外审核。

## GitHub Actions 构建方案

目标是提交到 GitHub 后由 Actions 直接产出 Windows 安装 artifact，不要求本地 Windows 机器。

Workflow 建议：

```yaml
name: Windows Release Build

on:
  workflow_dispatch:
  push:
    branches: [main]
    paths:
      - ".github/workflows/windows-release.yml"
      - "apps/windows/**"
      - "packages/app-shared/**"
      - "packages/native-specs/**"
      - "assets/**"

permissions:
  contents: read

jobs:
  build-windows:
    runs-on: windows-2022
    timeout-minutes: 90

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: "22.11.0"
          cache: npm
          cache-dependency-path: apps/windows/package-lock.json

      - uses: microsoft/setup-msbuild@v3
        with:
          msbuild-architecture: x64

      - name: Install dependencies
        working-directory: apps/windows
        run: npm ci

      - name: TypeScript check
        working-directory: apps/windows
        run: npx tsc --noEmit --pretty false

      - name: Build MSIX
        shell: pwsh
        working-directory: apps/windows
        run: .\scripts\build-release.ps1 -Configuration Release -Platform x64

      - uses: actions/upload-artifact@v4
        with:
          name: offhand-windows-msix
          path: |
            dist/windows/*.zip
            apps/windows/windows/OffhandReactnative.Package/AppPackages/**
          if-no-files-found: error
```

`build-release.ps1` 职责应保持窄：

- 校验 `windows/OffhandReactnative.sln` 和 package project 存在。
- 运行 `npx react-native bundle --platform windows` 生成 JS bundle。
- 运行 `npx react-native autolink-windows` 和 RNW codegen。
- 调用 MSBuild restore/build package。
- 生成或导入签名证书，签名 MSIX。
- 收集 `.msix` / `.cer` / `Install.ps1` / 日志到 repo 根目录 `dist/windows/` 并压缩。

禁止事项：

- 不允许 patch `node_modules`。
- 不允许下载 Visual Studio、Windows SDK、CMake、WiX 等大型构建工具。
- 不允许依赖本机绝对路径。
- 不允许把 ASR runtime 或模型塞进安装包。

构建机器选择：

- 固定使用 `windows-2022`，不要用会漂移的 `windows-latest`。GitHub-hosted Windows runner 已提供 Windows x64 环境；`microsoft/setup-msbuild` 用于把 MSBuild 加入 PATH。
- 如果 RNW / Windows App SDK 后续明确要求更新的 SDK，再评估切到 `windows-2025`，但应通过 PR 单独验证。

CI 可验证范围：

- `npm ci`
- TypeScript / Jest
- RNW codegen
- MSBuild restore/build
- MSIX 打包与签名
- artifact 上传

CI 不验证范围：

- F8 全局热键真实触发。
- 麦克风真实录音授权。
- 向第三方应用粘贴。
- overlay 在用户桌面上的置顶表现。

这些交互能力在 release checklist 中做手动验收。

## 前端改动

必要改动：

- `database.ts` 支持 Windows `AppPaths.getDatabaseOpenOptions()`。
- `ShortcutSettings.tsx` 保持 Windows F8 文案，后续增加快捷键冲突状态。
- `SettingsScreen` 权限区把 macOS 权限文案与 Windows 权限文案区分：
  - macOS：辅助功能、输入监控、麦克风。
  - Windows：全局快捷键注册状态、麦克风隐私设置。
- `ModelSettings` / `ASRSettings` 下载逻辑无需改变，但错误文案要能显示 Windows runtime 安装失败原因。

建议改动：

- 建立 `src/native/modules.ts`，集中解析 native module，避免业务代码直接散落 `NativeModules.*`。
- 建立平台能力对象：

```ts
export const platformCapabilities = {
  shortcutKeyLabel: Platform.OS === 'windows' ? 'F8' : 'fn',
  needsAccessibilityPermission: Platform.OS === 'macos',
  supportsMarkdownImport: Platform.OS === 'macos' || Platform.OS === 'windows',
};
```

## 实施阶段

### 阶段 0：版本线与工程骨架

- 决定 workspace 结构。
- 新建 `apps/windows`，使用 RNW 官方流程初始化 WinUI 3 C++ 工程。
- 移除 Windows build 中所有 `node_modules` patch 逻辑。
- 新增/改造 `.github/workflows/windows-release.yml`，让 GitHub Actions 能编译空壳 MSIX。
- 验证空壳 Windows app 可 `run-windows`、本机 Release build 和 Actions Release build。

验收：

- Windows x64 Debug 能启动。
- Release MSIX 能安装启动。
- 不修改 `node_modules`。
- Actions artifact 中包含 `.msix`、证书/安装脚本和 zip。

### 阶段 1：共享代码与 NativeModule specs

- 抽出共享 JS/TS 代码。
- 建立 NativeModule spec 与 adapter。
- Windows 空实现返回明确 “not implemented” 错误，保证 UI 不崩。

验收：

- macOS 功能不回退。
- Windows 配置界面能打开、切换页面、读写 SQLite。

### 阶段 2：快捷键与 overlay

- 实现 `OverlayManager`。
- F8 触发 `onRecordingStateChange`。
- overlay 独立显示、隐藏、更新状态。

验收：

- Notepad / VS Code / Chrome 聚焦时按 F8 能启动/停止。
- overlay 不抢焦点。
- F8 冲突能被检测并提示。

### 阶段 3：录音与文本写入

- 实现 `AudioRecorder`。
- 实现 `TextInserter`。
- 打通录音文件生成与插入流程，ASR 可先 mock。

验收：

- 录音文件能生成并播放。
- 文本能插入 Notepad、Chrome 输入框、VS Code、微信/企业微信输入框。
- 剪贴板能恢复；大剪贴板不导致明显内存峰值。

### 阶段 4：Sherpa runtime 与模型

- 实现 `ModelDownloader`。
- 实现 `OffhandSherpaHelper.exe` 与 `SherpaTranscriber`。
- 下载 SenseVoice small 后完成真实转写。

验收：

- fresh install 后下载 runtime + model。
- F8 录音后转写中文/英文短句。
- 空闲回收 helper 后内存下降，再次录音可重新拉起 helper。

### 阶段 5：安装包、日志与 QA

- 完成 MSIX release 脚本。
- 统一日志到 `%LOCALAPPDATA%\Offhand-native\Logs\OffhandReactnative.log`。
- 增加 Windows README / develop notes。
- 完成 GitHub Actions release artifact 上传。
- 做 Windows 10/11 x64 手动回归。

验收：

- `npm run windows:release` 和 GitHub Actions 都能生成 zip。
- 新机器安装后不需要 Visual Studio / Node。
- 关键失败路径有用户可理解的错误提示。

## 测试矩阵

系统：

- Windows 11 23H2/24H2 x64
- Windows 10 22H2 x64

目标应用：

- Notepad
- Chrome / Edge textarea
- VS Code
- Word / WPS
- Windows Terminal / PowerShell
- 微信 / 企业微信 / 飞书
- 管理员权限窗口（预期无法可靠注入，需降级为复制到剪贴板）

场景：

- 首次安装启动。
- 首次麦克风授权。
- runtime/model 下载中断、取消、重试。
- F8 被占用。
- 多显示器。
- 全屏应用上方 overlay。
- 网络不可用时使用本地 cleanup fallback。
- LLM API 超时或密钥缺失。

自动化：

- `npx tsc --noEmit --pretty false`
- `npm run test:windows`
- Windows native unit tests：路径、runtime readiness、model readiness、WAV header、helper JSON protocol。
- Release build smoke test：安装、启动、打开日志目录。
- GitHub Actions build：至少覆盖 `npm ci`、typecheck、bundle、MSBuild、MSIX package、artifact upload。

手动验收：

- F8 在多个前台应用中能启动/停止录音。
- overlay 不抢焦点，并位于当前显示器底部居中。
- 麦克风隐私关闭时给出明确提示。
- 管理员权限窗口写入失败时保留剪贴板降级路径。
- fresh install 下载 runtime/model 后能完成一次真实中文转写。

## 主要风险

- **RN/RNW/RN macOS 版本漂移**：通过 workspace 分离平台依赖解决，不在 build 脚本里 patch 上游源码；无法对齐时暂停 Windows 功能而不是改上游源码。
- **F8 冲突**：第一版检测并提示；第二版支持用户配置快捷键。
- **SendInput 被 UIPI 阻止**：降级为复制到剪贴板，并提示目标应用权限更高。
- **MediaCapture 输出格式不稳定**：增加 WAV 校验与 Media Foundation 归一化；必要时替换为 WASAPI。
- **overlay 无法覆盖独占全屏游戏**：接受限制，目标是普通桌面与 borderless fullscreen 场景。
- **runtime 解压依赖 tar.exe**：若企业环境缺失或被策略禁用，引入 libarchive 或改用 zip 资产。
- **杀毒软件误报 helper**：helper 必须签名、固定路径、无网络能力，只通过父进程 pipe 通信。
- **Actions 环境漂移**：固定 runner label 和 action 主版本，避免 `windows-latest`；runner 镜像升级导致失败时优先调整工程/依赖版本，不 patch RN/RNW 源码。
- **签名证书管理**：内测可用 self-signed，正式分发必须使用可信证书；PFX 只能通过 GitHub Secrets 注入，不能提交到仓库。

## 参考资料

- React Native Windows Get Started：RNW 0.82 起 Fabric-only，并推荐 `react-native@^0.82.0` + `react-native-windows@^0.82.0` 初始化。https://microsoft.github.io/react-native-windows/docs/getting-started
- React Native Windows Native Modules：Windows 原生能力建议用 Turbo Native Module + codegen。https://microsoft.github.io/react-native-windows/docs/native-platform-modules
- RNW 0.82 发布说明：Fabric-only、WinUI/XAML controls 支持增强。https://devblogs.microsoft.com/react-native/%F0%9F%9A%80react-native-windows-v0-82-is-here/
- Win32 `RegisterHotKey`：系统级热键通过 `WM_HOTKEY` 投递。https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-registerhotkey
- Win32 `SetWindowPos`：`HWND_TOPMOST` 可让窗口保持 topmost，`SWP_NOACTIVATE` 可避免激活窗口。https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowpos
- Win32 `SendInput`：输入注入受 UIPI 限制。https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-sendinput
- Windows app capabilities：麦克风、网络、full trust 等能力需要在 manifest 声明。https://learn.microsoft.com/en-us/windows/uwp/packaging/app-capability-declarations
- MediaCapture：WinUI 3 可用的音视频采集 API。https://learn.microsoft.com/en-us/uwp/api/windows.media.capture.mediacapture
- WASAPI：低层音频 capture/render API。https://learn.microsoft.com/en-us/windows/win32/coreaudio/wasapi
- UI Automation 文本写入限制：ValuePattern 可设置值，TextPattern 不提供通用写入，因此复杂控件仍需键盘输入模拟。https://learn.microsoft.com/en-us/dotnet/framework/ui-automation/add-content-to-a-text-box-using-ui-automation
- GitHub-hosted runners：标准 Windows runner 标签、资源规格与管理员/UAC 行为。https://docs.github.com/en/actions/reference/runners/github-hosted-runners
- microsoft/setup-msbuild：在 Actions 中发现 MSBuild 并加入 PATH。https://github.com/microsoft/setup-msbuild
- MSBuild：可通过命令行构建 Visual Studio/MSBuild 项目。https://learn.microsoft.com/en-us/visualstudio/msbuild/msbuild
