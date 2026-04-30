# Development Notes

这份文档记录当前工程里容易接错的约定。后续开发优先按这里执行，避免重新引入已经移除或过期的调用路径。

## macOS Markdown 导入

记忆库右上角 `+ MD` 只允许调用 macOS 原生模块：

```ts
NativeModules.MarkdownFileImporter.importMarkdownFile()
```

不要调用 `FilePicker` 或 `pickMarkdownFile`。旧的 `FilePicker.h/.m` 已删除，`FilePicker` 不是当前工程的有效 bridge。

`MarkdownFileImporter.importMarkdownFile()` 返回：

```ts
type MarkdownImportResult = {
  fileName?: string;
  filePath?: string;
  content?: string;
} | null;
```

前端位置：

- `src/screens/MemoryScreen.tsx`

原生实现：

- `macos/OffhandReactnative-macOS/MarkdownFileImporter.h`
- `macos/OffhandReactnative-macOS/MarkdownFileImporter.m`

如果后续要扩展文件类型或读取逻辑，直接扩展 `MarkdownFileImporter`，不要新建第二套文件选择 bridge。

## macOS App 名称

macOS 构建产物名是 `释手.app`，不是 `OffhandReactnative.app`。

关键配置：

- macOS target `PRODUCT_NAME = "释手"`
- `CFBundleDisplayName = 释手`
- `CFBundleName = 释手`

Release 产物路径：

- `macos/build/Build/Products/Release/释手.app`
- `dist/释手-macOS-0.0.1.zip`

不要用旧的 `OffhandReactnative.app` 路径判断构建是否成功。

## Bundle Identifier 与数据目录

macOS bundle id 当前为：

```text
com.metis.reactnative.offhand
```

用户数据目录使用应用自定义目录名：

```text
~/Library/Application Support/Offhand-native
```

不要写回旧的：

```text
~/Library/Application Support/OffhandReactnative
```

## Sherpa Runtime 与模型

Sherpa-onnx runtime 和 ASR 模型都按需下载，不随安装包内置，也不要求用户本机编译 sherpa-onnx。

macOS runtime 安装位置：

```text
~/Library/Application Support/Offhand-native/sherpa-onnx/runtime/current
```

不要把 sherpa dylib/dll 或 ONNX 模型重新加入应用包体。

## 常用验证命令

TypeScript 检查：

```sh
npx tsc --noEmit --pretty false
```

启动 macOS 开发版：

```sh
npm run macos
```

构建 Release app 和 zip：

```sh
npm run build:release
```

Release 脚本会输出 `释手.app` 和 `释手-macOS-<version>.zip`。
