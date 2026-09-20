## 26.3.1 — 修复 macOS 上实时转写拿不到麦克风权限

**macOS 用户请升级。** 26.3.0 的安装版点「开始转写」后不会弹出麦克风授权框，「系统设置 → 隐私与安全性 → 麦克风」里也找不到 iML Markdown Editor，所以实时转写在 Mac 上用不了。Windows 不受影响。

### 下载

| 平台 | 安装包 |
|---|---|
| macOS Apple Silicon（M 系列） | `iML.Markdown.Editor-26.3.1-arm64.dmg` |
| macOS Intel | `iML.Markdown.Editor-26.3.1-x64.dmg` |
| Windows（绝大多数电脑选这个） | `iML.Markdown.Editor-Setup-26.3.1-x64.exe` |
| Windows on ARM（骁龙本等） | `iML.Markdown.Editor-Setup-26.3.1-arm64.exe` |

安装包未做 Apple 公证，首次打开若提示「无法验证开发者」，在访达里右键应用选「打开」即可。

### 修了什么

- 安装包开着 macOS 的「强化运行时」，但权限声明里漏了麦克风这一项。这种情况下系统不弹授权框、直接拒绝，应用也不会出现在麦克风的授权列表里
- 现在装上新版，第一次点「开始转写」会正常弹出授权框；点「允许」即可。之前点过的不用管，新版会重新问一次
- 这个问题只出在安装版：开发模式下没有这层限制，所以发版前没测出来。已加上打包配置的自动检查，并改用和双击图标等价的方式验证

### 26.3.0 的新内容

实时转写、点句子回听、整理纪要、问你的笔记（`⌘J`）、安装包瘦身等，见 [26.3.0 的发布说明](https://github.com/imoling/iml-markdown-editor/releases/tag/v26.3.0)。
