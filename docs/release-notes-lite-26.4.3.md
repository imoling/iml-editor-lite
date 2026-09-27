## 26.4.3 — Windows 上能打开了，多了绿色版

26.4.2 在 Windows 上一打开就闪退（[#5](https://github.com/imoling/iml-editor-lite/issues/5)），这一版修好了，装了 26.4.2 的请更新。macOS 不受影响。另外 Windows 多了不用安装的绿色版（[#4](https://github.com/imoling/iml-editor-lite/issues/4)）。谢谢几位的反馈。

### Windows 上打开就闪退，修好了

问题出在 26.4.2 新加的「把文件拖进窗口就打开」上：它在 Windows 上的做法会让应用一启动就退出。这一版换了做法。

卸载 26.4.2 再装这一版，或者直接覆盖安装都可以，文档和设置不受影响。

以后每一版发布之前，都会先把应用实际启动一遍，起不来就不发。

### Windows 有绿色版了

下载 `iML-Editor-Lite-Portable-26.4.3-x64.zip`，解压出来双击 `iml-editor.exe` 就能用，不用安装。

- 设置存在用户目录里，和安装版共用；删掉解压出来的文件夹，设置还在。
- 不会关联 `.md` 文件。想双击文档就打开，在文档的「打开方式」里选它。
- 需要系统里有 WebView2：Windows 11 自带，Windows 10 大多也有。没有的话用安装包，安装程序会帮你装。
- 检查更新时，给的也是绿色版。

### 下载

| 平台 | 文件 |
|---|---|
| macOS Apple Silicon（M 系列） | `iML-Editor-Lite-26.4.3-arm64.dmg` |
| macOS Intel | `iML-Editor-Lite-26.4.3-x64.dmg` |
| Windows（绝大多数电脑选这个） | `iML-Editor-Lite-Setup-26.4.3-x64.exe` |
| Windows on ARM（骁龙本等） | `iML-Editor-Lite-Setup-26.4.3-arm64.exe` |
| Windows 绿色版 | `iML-Editor-Lite-Portable-26.4.3-x64.zip` |
| Windows on ARM 绿色版 | `iML-Editor-Lite-Portable-26.4.3-arm64.zip` |

没有做 Apple 公证。macOS 首次打开若被拦下：系统设置 → 隐私与安全性 → 拉到底点「仍要打开」。Windows 需要 WebView2（Windows 11 自带；Windows 10 没有的话安装程序会帮你装）。
