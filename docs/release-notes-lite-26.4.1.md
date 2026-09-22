## 26.4.1 — 导出的 PDF 和编辑器里看到的一样

修两个导出 PDF 的问题（[#2](https://github.com/imoling/iml-markdown-editor/issues/2)）。这也是轻量版搬到自己的仓库后发的第一个版本：以后在这里发，应用里的检查更新也改查这里。

### 修复

- **导出 PDF、长图：代码块的长行会换行了。** 之前导出沿用屏幕上的样式，长行靠横向滚动，纸上没有滚动条，超出的部分被直接裁掉。没有空格的长串（网址、哈希）也会断开。
- **导出 PDF、HTML、长图：表格照编辑器的样子。** 各列平分宽度，不再按内容分（两个字的表头不会被挤成竖排）；只画内部分隔线，表头底线粗一点，隔行浅底，四角圆角。居中、右对齐照旧保留。

### 下载

| 平台 | 安装包 |
|---|---|
| macOS Apple Silicon（M 系列） | `iML-Editor-Lite-26.4.1-arm64.dmg` |
| macOS Intel | `iML-Editor-Lite-26.4.1-x64.dmg` |
| Windows（绝大多数电脑选这个） | `iML-Editor-Lite-Setup-26.4.1-x64.exe` |
| Windows on ARM（骁龙本等） | `iML-Editor-Lite-Setup-26.4.1-arm64.exe` |

没有做 Apple 公证。macOS 首次打开若被拦下：系统设置 → 隐私与安全性 → 拉到底点「仍要打开」。Windows 需要 WebView2（Windows 11 自带；Windows 10 没有的话安装程序会帮你装）。

### 搬了仓库

轻量版从 iML Markdown Editor 的 `lite` 分支拆成了独立仓库 [imoling/iml-editor-lite](https://github.com/imoling/iml-editor-lite)，两者仍共用同一个编辑内核，内核的修复两边同步。**已经装了 26.4.0 的，检查更新查的还是原来的仓库，这一版不会自动提醒，请手动下载。**

### 已知问题

- Windows 上的构建仍没有经过真机验证，遇到问题请到 Issues 里说一声。
