# iML 编辑器

纯粹的 Markdown 编辑器：打开一个 `.md`，写，保存。没有笔记库，没有 AI，没有后台进程。安装包不到 4 MB。

> 这是 `lite` 分支，[iML Markdown Editor](https://github.com/imoling/iml-markdown-editor)（即「iML 笔记」，`main` 分支）的轻量版。两者共用同一个编辑内核，可以装在同一台电脑上：要笔记库、双向链接、全库搜索、本机智能（转写、问你的笔记），用「iML 笔记」；只想改一份文档，用这个。

![富文本模式：属性卡片、提示块、表格、任务列表](https://cdn.jsdelivr.net/gh/imoling/iml-markdown-editor@lite/screenshots/lite-富文本.png)

---

## 它做什么

- **双模编辑**，`⌘E` 切换：富文本（Tiptap 2）和源码（CodeMirror 6，右侧实时预览、左右滚动同步）
- **原样保存**：富文本模式保存时，没碰过的块直接写回文件里的原文——表格的对齐填充、列表用 `*` 还是 `-`、Setext 标题、CRLF、文件末尾的换行都不动；`my_var` 不会变成 `my\_var`。只有你编辑过的那一块才会重新生成
- **Markdown 元素**：标题、列表、任务列表、表格、代码高亮、引用、链接、图片、脚注、`> [!NOTE]` 提示块、`[TOC]`、属性（frontmatter）卡片、KaTeX 公式（`$…$` 与 `$$`）、Mermaid 流程图、SVG、`<details>` `<kbd>` `<mark>` 等 HTML 原样保留并就地预览
- **编辑辅助**：行首 `/` 插入菜单（支持中文与拼音首字母筛选）、选中文字后的格式气泡、查找 / 替换（`⌘F` / `⌥⌘F`，两种模式通用）、`⌥↑` / `⌥↓` 整块移动、`⌘K` 插入链接、源码模式 `⌘D` 选中下一处相同的文字
- **文件**：新建 / 打开（可多选）/ 保存 / 另存为、最近打开、标签页全套（`⌘W`、`⌘⇧T` 重开、`⌃Tab`、`⌘1`~`⌘9`、右键批量关闭）、设为 `.md` 的默认打开方式、重启后恢复标签页——**没保存的修改也会恢复**
- **打开文件夹**（`⌘⇧O`，可选）：侧边栏列出里面的文档，新建、重命名、创建副本、推入废纸篓、排序。就是一棵文件树，不建索引
- **图片**：粘贴 / 拖入的图片自动压缩成 WebP，存进文档旁边的 `assets/`；粘贴网址自动取网页标题；源码模式粘贴网页内容自动转成 Markdown
- **导出**：PDF（`⌘P`，选好存哪就直接生成分页的 A4 文档；Windows 上走 WebView2 的打印面板，在里面选「另存为 PDF」）、单文件 HTML（`⌘⇧E`，图片内联）、Word（.docx）、**长图**（PNG，1500 像素宽，发群里、发朋友圈用；很长的文档自动分成几张，切在段落的边界上，每张末尾带「来自 iML 编辑器」的角标）
- **视图**：大纲、专注模式（`⌘⇧.`）、正文字体 / 字号 / 行距 / 页宽、亮色 / 深色 / 护眼、拼写检查开关
- 在别处被改过的文件：没改动的标签页静默跟随磁盘，有未保存修改的用橙点提示

![源码模式：左侧 CodeMirror，右侧实时预览](https://cdn.jsdelivr.net/gh/imoling/iml-markdown-editor@lite/screenshots/lite-源码.png)

## 和记事本一样的三条规矩

1. **永远有一篇文档开着，没有欢迎页**：启动就是一篇空白文档，光标已经在里面；关掉最后一个标签页，回到的也是一篇空白文档。只开着一篇没动过的空白文档时打开文件，文件直接顶替它。最近打开的文件在「文件」菜单里。
2. **存不存你说了算**：自动保存默认关闭（设置里可以开，只对已有的文件生效）；未命名文档从不会被悄悄建成文件，`⌘S` 时保存框会先按正文第一行替你想好名字。
3. **不在背后做事**：不建索引、不留版本历史、不常驻进程、不申请麦克风等任何设备权限。会联网的只有两件事——检查更新，和（可关闭的）粘贴网址时取一次网页标题。

## 和「iML 笔记」互通

用「iML 笔记」写的文档在这里打开不会被改坏：`[[双向链接]]`、`![[嵌入]]`、`#标签`、转写留下的 `<details>` 块，这里不解析、不跳转，显示成原文，保存时逐字节写回。这一条由往返保真测试守着，也用真实的键盘事件端到端验过：敲一个字、保存，文件的 diff 只有那一个字。

两个应用的标识各自独立（这边是 `com.imoling.editor`），设置、会话互不影响。

---

## 下载

| 平台 | 安装包 |
|---|---|
| macOS Apple Silicon（M 系列） | `iML-Editor-26.4.0-arm64.dmg` |
| macOS Intel | `iML-Editor-26.4.0-x64.dmg` |
| Windows（绝大多数电脑选这个） | `iML-Editor-Setup-26.4.0-x64.exe` |
| Windows on ARM（骁龙本等） | `iML-Editor-Setup-26.4.0-arm64.exe` |

到 [Releases](https://github.com/imoling/iml-markdown-editor/releases) 里找标题以「iML 编辑器」开头的版本（标签是 `lite-v…`；`v…` 开头的是主版本「iML 笔记」）。已经装了的，应用会在发现新版本时提醒一次，并直接给出这台电脑该下的安装包。

没有做 Apple 公证。macOS 首次打开若被拦下：系统设置 → 隐私与安全性 → 拉到底点「仍要打开」。Windows 需要 WebView2（Windows 11 自带；Windows 10 没有的话安装程序会帮你装）。

## 为什么这么小

外壳是 [Tauri 2](https://tauri.app)：界面跑在系统自带的 WebView 里（macOS 的 WebKit、Windows 的 WebView2），不再自己带一个 Chromium。macOS 的安装包不到 4 MB、装好 6 MB；换壳之前的 Electron 版是 80 ~ 90 MB。

体积是盯着的：同一份东西不带两遍（公式字体界面要用一份 woff2，导出时就读那一份，不再往 JS 里内联一份 base64）；图标不带只有在访达里放到最大才用得上的 1024 像素那一层；KaTeX 的 woff / ttf 老格式不进包。这几条都写成了测试（[packaging.test.ts](electron/packaging.test.ts)），谁不小心改回去，`npm run check` 会拦下来。

界面代码一行没为此重写：它只认 `window.api` 这一个接口。Electron 壳里由 [preload.ts](electron/preload.ts) 提供，Tauri 壳里由 [tauriApi.ts](src/platform/tauriApi.ts) 提供同样的形状，背后是 [src-tauri/src/lib.rs](src-tauri/src/lib.rs) 里二十来个 Rust 命令——只做读写文件、监听文件夹、本地图片协议、打印这类系统调用。文件名怎么起、网页标题怎么解析、哪个安装包是这台电脑的，仍然是那份带测试的 TypeScript，两个壳共用。

系统 WebView 和 Chromium 有两处不一样，都已经处理：

- **不能把画布编码成 WebP**（Safari 内核）：粘贴的图片发现编不出来时，交给 Rust 去压，效果一样（实测 2.2 MB → 464 KB）。
- **没有「直接存成 PDF」的接口**：macOS 上用一小段原生代码调系统的打印引擎（`NSPrintOperation`，不弹面板，直接存成分页的 A4 PDF，见 [lib.rs](src-tauri/src/lib.rs) 里的 `mac_pdf`）；Windows 上走 WebView2 的打印面板（自带预览）。公式要用的 KaTeX 字体必须在打印之前加载好——WebKit 打印时是挂起资源加载的，字体等不来，整份 PDF 会是空白页。
- **没有「截一个隐藏窗口」的接口**：长图不靠外壳截屏，在页面里自己画——把导出用的 HTML 包进 SVG 画到画布上（见 [exportImage.ts](src/utils/exportImage.ts) 开头的说明：图片为什么由这边直接画、每一段为什么要拿自己的第一个块当锚点）。Electron 壳用的也是这一份，两边出的图一样。

Electron 壳还留在仓库里当退路（`npm run dev`、`npm run build:mac`），两个壳打开同一份文档、敲同一个字，保存出来的文件逐字节相同。

## 本地运行

需要 Node 22 和 [Rust](https://rustup.rs)（macOS 还要 Xcode 命令行工具，Windows 要 MSVC 生成工具）。

```bash
npm install
npm run tauri:dev    # 开发模式：Vite + Tauri 壳
npm run check        # 类型检查 + ESLint + Vitest，提交前跑一遍
npm run tauri:build  # 出安装包（当前平台），在 src-tauri/target/release/bundle/
```

`src-tauri/target/` 是 Rust 的编译缓存，会长到几个 G，不进仓库；嫌占地方就 `cargo clean`。国内网络直连 crates.io 很慢，在 `~/.cargo/config.toml` 里换成镜像（如 rsproxy.cn）。

冒烟钩子（只在调试构建里生效）：`IML_SMOKE_OPEN=/path/to.md` 启动时打开一个文件；`IML_SMOKE_EXPORT_DIR=/some/dir` 导出时不弹保存对话框、直接存进这个目录；`IML_SMOKE_SCRIPT_FILE=/path/to.js` 页面起来 6 秒后在里面执行这段脚本——系统 WebView 没有 CDP，无人值守的检查靠它把结果写到文件里。Electron 壳的钩子（`IML_SMOKE_USERDATA`、`IML_SMOKE_OFFSCREEN=1`，可用 CDP 发真实的键盘事件、截图）照旧。

图标的源文件是 [assets/lite/icon.svg](assets/lite/icon.svg)；改完渲染成 1024 的 PNG，`npx tauri icon assets/lite/icon-1024.png -o src-tauri/icons` 生成全套（多出来的 `android/`、`ios/` 两个目录删掉），再跑一次 `node scripts/trim-icns.mjs` 去掉 icns 里 1024 像素那一层（一张就 260 KB，只有在访达里把图标放到最大才用得上），两个壳共用。

## 发版

打 `lite-v*` 标签（如 `lite-v26.4.0`）触发 GitHub Actions 构建 Tauri 安装包（macOS arm64 / x64、Windows x64 / arm64）并发布，发布说明放 `docs/release-notes-lite-<版本>.md`。和「iML 笔记」共用一个仓库，所以有两条规矩，都已经写在流水线里：标签必须带 `lite-` 前缀（应用里的检查更新靠它认出自己的版本）；发布时不设为「最新版本」（笔记那边查的是 `/releases/latest`）。

## 从 main 同步内核修复

这个分支只在挂载点上拔线（[App.tsx](src/App.tsx)、[appStore.ts](src/stores/appStore.ts)、侧边栏、菜单、[main.ts](electron/main.ts)、[preload.ts](electron/preload.ts)），外加一层 Tauri 壳（`src-tauri/`、`src/platform/`），没有重构编辑内核：[markdown.ts](src/utils/markdown.ts)、[sourceMap.ts](src/utils/sourceMap.ts)、[incrementalMarkdown.ts](src/utils/incrementalMarkdown.ts)、转义与净化，以及 `src/extensions/` 下保留的扩展，与 `main` 逐字相同。扩展里只有一处例外：[WikiEmbed.ts](src/extensions/WikiEmbed.ts) 去掉了要读别的笔记的节点视图；另外删了三个只服务于笔记库的扩展（`[[` 补全、`#标签` 高亮、时间戳链接）。`main` 上修了内核的问题，`git cherry-pick` 过来即可；碰到上面那几个挂载点文件的提交，手工摘取。

## 技术栈

React 19 + Vite 7 + TypeScript 5.9 · Tauri 2（Rust；Electron 33 作为退路保留）· Zustand 5 · Tiptap 2 / CodeMirror 6 · marked + turndown · Mermaid 11、KaTeX，预览与 SVG 经 DOMPurify 净化 · Vitest + ESLint

## 许可证

[CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/) — 非商业使用。
