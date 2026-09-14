# iML Notes for iPad（v0 骨架）

与 Mac 端共用同一个笔记库文件夹的 iPad 端，目标是 GoodNotes 式的"正文 + Apple Pencil 手写"。

## 状态

**未经编译验证。** 这台开发机只有 Command Line Tools，没有 Xcode，所以这些文件是按 iOS 17 / Swift 5.9 的公开 API 写的，第一次在 Xcode 里打开大概率需要修几处小问题。逻辑和文件格式已经和 Mac 端对齐，见 [docs/ink-sidecar-format.md](../docs/ink-sidecar-format.md)。

## 怎么跑

1. Xcode 15 或更新，直接打开 `iMLNotes.swiftpm`（App Playground 形式，无需 .xcodeproj）。
2. 选真机或 iPad 模拟器运行。手写需要真机 + Apple Pencil；模拟器可以用鼠标画。
3. 首次启动点右上角文件夹图标，选笔记库。推荐选 iCloud Drive 里 Mac 端设置的那个文件夹（Mac 端：设置 → 笔记库 → "使用 iCloud Drive"）。

如果更想要正式工程：Xcode 新建 App（SwiftUI, iOS），把本目录下所有 `.swift` 文件拖进去，删掉模板自带的 `ContentView.swift` 即可，没有第三方依赖。

## 已实现（v0）

- 选择笔记库文件夹并记住访问权限（security-scoped bookmark）
- 逐级浏览文件夹与笔记；文件过滤规则与 Mac 端侧边栏一致（只显示 .md/.markdown/.txt，跳过隐藏文件）
- 正文源码编辑，停止输入 0.8s 自动保存；简单的预览模式
- 手写覆盖层（PencilKit），按规范保存为 `笔记.ink` + `笔记.ink.png` + `笔记.ink.json`
- 所有读写走 `NSFileCoordinator`，适配 iCloud / 同步盘

## 下一步

- 正文所见即所得编辑（可考虑 Down / MarkdownUI）
- 段落级手写锚定（规范第 4 节）
- iCloud 冲突版本处理（`NSFileVersion`）
- 新建文件夹、重命名、删除
- Mac 端只读叠加显示 `.ink.png`
