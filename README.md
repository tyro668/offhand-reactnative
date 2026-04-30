# 释手 Offhand

言之所至，释手而书。 / Speak freely, write unbound.

基于 React Native 的 macOS + Windows 桌面应用，提供语音转文字与文本增强功能。

## 技术栈

- React Native 0.85 + react-native-macos 0.81 + react-native-windows 0.82
- SQLite 本地配置存储
- Sherpa-onnx（SenseVoice / Whisper）语音识别
- OpenAI / Anthropic 兼容协议文本增强
- Fn 键全局热键 + 独立录音悬浮窗

## 开发环境

```sh
# 安装依赖
npm install --legacy-peer-deps

# 安装 CocoaPods（仅首次或 native 依赖变更后）
cd macos && pod install && cd ..

# 启动 Metro 开发服务器
npm start

# 启动 macOS 应用（会自动检测或启动 Metro）
npm run macos
```

### Sherpa-onnx 按需下载

SenseVoice / Whisper 模型文件和 Sherpa-onnx runtime 都由应用设置页按需下载到用户数据目录，安装包不内置 Sherpa dylib/dll 或 ONNX 模型。首次点击下载 ASR 模型时，应用会先下载当前平台的 Sherpa-onnx shared runtime，再下载模型文件。

macOS runtime 安装到：
`~/Library/Application Support/Offhand-native/sherpa-onnx/runtime/current`

## 辅助功能权限

首次启动需授权辅助功能权限（F键全局监听）：
系统设置 → 隐私与安全性 → 辅助功能 → 开启「释手」

## 构建 Release 版本

```sh
npm run macos:release
# 或
npm run build:release
```

Release 脚本会生成 macOS 图标、同步 react-native-macos codegen、在需要时执行
`pod install`、应用 fmt 的 macOS SDK 兼容补丁、构建 Release app，并生成 zip 包。

产物路径：
- App: `macos/build/Build/Products/Release/释手.app`
- Zip: `dist/释手-macOS-0.0.1.zip`

## 项目结构

```
src/
├── i18n/                  # 中英文国际化
├── theme/                 # 亮/暗主题
├── db/database.ts         # SQLite 配置存储
├── models/textModels.json  # 内置模型提供商
├── services/
│   ├── textEnhancement.ts  # OpenAI/Anthropic API 调用
│   └── OverlayManager.ts   # 录音悬浮窗 JS 桥接
├── components/
│   ├── Sidebar.tsx         # 左侧菜单
│   ├── ErrorBoundary.tsx   # 错误捕获
│   └── ...
└── screens/
    ├── HomeScreen.tsx       # 主页（使用统计）
    ├── MemoryScreen.tsx     # 记忆库管理
    ├── SettingsScreen.tsx   # 系统设置
    ├── ASRSettings.tsx      # 语音模型（SenseVoice/Whisper）
    ├── ModelSettings.tsx    # 文本模型（供应商/自定义）
    └── ShortcutSettings.tsx # 快捷键配置
```

## 数据库表结构

| 表名 | 字段 | 说明 |
|---|---|---|
| `asr_config` | engine, model, language, sample_rate | 语音识别配置 |
| `text_model_config` | provider, model, base_url, api_key, style, max_tokens, thinking | 文本模型配置 |
| `shortcut_config` | modifier, key | 快捷键配置 |
| `app_settings` | setting_key, setting_value | 主题/语言等键值 |

## 设计理念

- **Typeless** — 极简无装饰排版风格，聚焦内容本身
- **开箱即用** — 内置 z.ai / moonshot / deepseek / openai / anthropic 五大模型提供商
- **本地持久化** — SQLite 存储，应用重启配置不丢失
- **全局热键** — CGEventTap 实现 Fn 键系统级监听，无需应用焦点
- **独立悬浮窗** — NSPanel 录音状态指示器，跨桌面、全屏可见
