## 26.4.5 — 空行留得住，表格出得去，图表看得清

这一版修的都来自 Issues 里的反馈（[#6](https://github.com/imoling/iml-editor-lite/issues/6)、[#7](https://github.com/imoling/iml-editor-lite/issues/7)、[#8](https://github.com/imoling/iml-editor-lite/issues/8)、[#9](https://github.com/imoling/iml-editor-lite/issues/9)、[#10](https://github.com/imoling/iml-editor-lite/issues/10)、[#11](https://github.com/imoling/iml-editor-lite/issues/11)，以及完整版仓库的 [#7](https://github.com/imoling/iml-markdown-editor/issues/7)），谢谢各位。

### 空行留得住

富文本里回车空出来的一行，保存后重新打开还在。文件里就是多一个空行，用别的编辑器打开看到的也是空行。

只对正文有效：列表、引用里的空行 Markdown 本身存不下，仍然留不住。文件里本来就连着空两行的地方，富文本里现在也会显示成一个空行。

### 表格：回车到下一行，最后一行回车出表格

- 回车到正下方那一格；最后一行回车跳出表格，接着往下写。格内换行用 `Shift + 回车`。
- 文末是表格、图片或代码块时，下面总有一行可以点进去写。
- 列宽按内容分配，内容多的列自然宽，不再几列等分。拖出来的宽度只在这次编辑里有效：Markdown 表格存不下列宽。

### 图表：按自己的大小显示，能放大缩小

Mermaid 图不再被拉到和页面一样宽，两个节点的小图就是小图。鼠标移到图上，右上角有放大、缩小、原始大小三个按钮。

缩放倍数和拖出来的高度会记在代码第一行的注释里（`%% iml: zoom=0.8 height=320`），重新打开还在；别的工具把它当注释，照常渲染。

### 图片：可以显示描述，可以从剪贴板插入

- 设置 → 粘贴与输入 → 「图下显示图片描述」：打开后，图片下面显示插入时填的描述（Markdown 里的替代文字）；没填描述的图不显示。默认关。
- 「插入图片」里多了「从剪贴板读取」。在正文里直接粘贴图片本来就可以，这是给走对话框的人准备的。

### 其它

- 每个标签页记住自己的滚动位置，切回来还在原处；源码模式也一样（#11）。
- 写进文档里的图片多了以后打字会卡（#10）：去掉了每敲一个字就重新解析整篇文档的动作，字数统计也不再数那些 base64。
- 「拼写检查」开关原来不生效，现在生效了。

### 下载

| 平台 | 文件 |
|---|---|
| macOS Apple Silicon（M 系列） | `iML-Editor-Lite-26.4.5-arm64.dmg` |
| macOS Intel | `iML-Editor-Lite-26.4.5-x64.dmg` |
| Windows（绝大多数电脑选这个） | `iML-Editor-Lite-Setup-26.4.5-x64.exe` |
| Windows on ARM（骁龙本等） | `iML-Editor-Lite-Setup-26.4.5-arm64.exe` |
| Windows 绿色版 | `iML-Editor-Lite-Portable-26.4.5-x64.zip` |
| Windows on ARM 绿色版 | `iML-Editor-Lite-Portable-26.4.5-arm64.zip` |

没有做 Apple 公证。macOS 首次打开若被拦下：系统设置 → 隐私与安全性 → 拉到底点「仍要打开」。Windows 需要 WebView2（Windows 11 自带；Windows 10 没有的话安装程序会帮你装）。
