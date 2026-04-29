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

# 启动 macOS 应用
npm run macos
```

## 辅助功能权限

首次启动需授权辅助功能权限（F键全局监听）：
系统设置 → 隐私与安全性 → 辅助功能 → 开启「OffhandReactnative」

## 构建 Release 版本

```sh
# 1. 修复代码生成器兼容性（react-native-macos 版本差异）
rm -rf node_modules/react-native-macos/node_modules/@react-native/codegen
cp -r node_modules/@react-native/codegen node_modules/react-native-macos/node_modules/@react-native/codegen

# 2. 修复 fmt 库 consteval 兼容性（macOS SDK 26.x）
sed -i '' 's/#elif defined(__cpp_consteval)/#elif defined(__APPLE__)\n#  define FMT_USE_CONSTEVAL 0\n#elif defined(__cpp_consteval)/' \
  macos/Pods/fmt/include/fmt/base.h

# 3. 安装 CocoaPods 依赖
cd macos && pod install && cd ..

# 4. 构建 Release
cd macos
xcodebuild -workspace OffhandReactnative.xcworkspace \
  -scheme OffhandReactnative-macOS \
  -configuration Release \
  -destination "platform=macOS" \
  -derivedDataPath build \
  build
cd ..

# 5. 产物路径
open macos/build/Build/Products/Release/OffhandReactnative.app
```

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
