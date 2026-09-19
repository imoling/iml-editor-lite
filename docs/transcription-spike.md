# 实时转写：技术验证结论（2026-09-20）

26.3 计划做「实时收录转写形成笔记」（私有化会议、听课）。动手前花了一天验证「能不能做、走哪条路」。结论：**能做，走「运行时下载的原生模块 + 独立进程」这条路**。下面是依据，数字都是在 M4 / 24 GB / macOS 27 上实测的。

## 结论

| 问题 | 结论 |
|---|---|
| 用什么引擎 | [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) 1.13.8（Apache-2.0） |
| 用什么模型 | SenseVoice int8（228 MB）+ silero VAD（1.7 MB），只要这一套 |
| 怎么出「实时」的字 | **模拟流式**：VAD 检测到说话后，每 0.5 秒把「正在说的这句」整句重识别一遍出临时文字；VAD 判定说完后定稿 |
| 怎么装进 Electron | sherpa-onnx 的 N-API 原生模块，**运行时下载**到 userData（不打进安装包），在 `utilityProcess` 里加载 |
| 国内能不能下 | 能。原生包在 npmmirror（10 MB，直连 1.5 秒），模型在 hf-mirror（按单文件、支持断点续传、响应头带 SHA256），都不需要代理 |

实测表现（56 秒中文会议音频，Chromium 假麦克风 → AudioWorklet → IPC → utilityProcess 全链路）：

- 模型加载 0.55 秒；开口后 **1.5 秒**出第一段临时文字，之后约每 0.6 秒刷新一次，**临时文字就带标点**
- 一句话说完后约 0.5 秒定稿；单次识别最慢 179 ms（一句 10.8 秒的长句）
- CPU 约占一个核的 30%；识别进程内存 720~990 MB
- 循环喂 11.4 分钟音频、1167 次识别：**内存持平，没有泄漏**

## 为什么不是别的方案

**WhisperLiveKit 本体**：Python + PyTorch 的服务端，依赖几个 GB，塞不进安装包。但它暴露标准 WebSocket（`ws://localhost:8000/asr`），可以作为「本地已在运行的服务」一档接入，让愿意折腾的人换来说话人分离和同传翻译——和写作助手的「本机 / 本地 / 网络」三档同构。

**whisper.cpp**：发布包里没有 macOS 可执行文件（只有 Windows / Ubuntu / xcframework），llama.cpp 那套「下载官方二进制」行不通；Whisper 不是流式模型，中文也不如 SenseVoice。

**sherpa-onnx 自带的 WebSocket 服务端（子进程路线）**：最初的首选，因为能复用 llama-server 的整套托管。实测后放弃，两个原因：

1. **它监听 `*:端口`（所有网卡），没有参数能改成只听本机。** 隐私产品不该在局域网上开口子，macOS 防火墙还可能弹框。
2. 现成的服务端只有「真流式」和「整句离线」两种，做不了模拟流式（需要我们自己掌控 VAD + 反复识别的循环）。

**流式 Paraformer（真流式模型）**：延迟更低（0.65 秒出字），但没标点、数字不规整、错字明显更多（「子进程」→「子禁程」）。同一段音频 SenseVoice 全对。既然 SenseVoice 快到 RTF 0.019，模拟流式就够了，不需要「流式出草稿 + 离线定稿」两个模型（省一半下载和内存）。

**把原生模块打进安装包**：CI 在一台 arm64 机器上同时出 macOS 两个架构的包，而 npm 的平台可选依赖只装当前架构那一份——会出一个装了错架构模块的 x64 包。运行时按平台下载绕开了这个坑，安装包体积也不变。

## 实现时要记住的坑

1. **`vad.front(false)`**：Electron 开了 V8 内存沙箱，原生模块不能返回外部缓冲区，默认参数会直接抛 `External buffers are not allowed`。凡是胶水层带 `enableExternalBuffer` 参数的调用都要传 `false`。
2. **识别用的 stream 句柄靠 GC 终结器释放，而 N-API 的终结器要等事件循环空转才执行。** 胶水层没有显式释放接口。真实场景里音频一块块到，没问题；但任何「一口气同步处理一大段」的代码（比如导入音频文件转写）必须定期 `await` 让出事件循环，否则内存每分钟涨 17 MB。
3. `.node` 用 `@loader_path` 找动态库，三个 `.dylib` 和它放同一目录即可，不需要 `DYLD_LIBRARY_PATH`。
4. 胶水层（`sherpa-onnx-node`，12 KB 纯 JS）按相对路径 `../sherpa-onnx-<平台>-<架构>/sherpa-onnx.node` 找原生模块：两个包解压到同一个父目录下就能用。
5. 采集：`new AudioContext({ sampleRate: 16000 })` 让 Chromium 替我们重采样；AudioWorklet 每攒 1600 个采样（100 ms）发一块。
6. 识别进程**随录音启停**：开始录音才 fork，停止就杀掉——近 1 GB 内存不常驻，也顺带免疫任何长期运行的泄漏。
7. 测试手段：`--use-fake-device-for-media-stream --use-file-for-fake-audio-capture=<wav>%noloop --use-fake-ui-for-media-stream` 能把 WAV 当麦克风喂进去，无人值守可测。测试壳需要 `--no-sandbox`（沙箱不让假设备读文件），真麦克风不需要。测试音频用 `say -v Tingting` 合成，原文已知，能算准确率。

## 还没验证的

- **真人、真会议室的效果。** 测试音频是 TTS 合成的干净人声。笔记本麦克风远场、多人交叠才是真正的敌人，这一关只能真机试。
- **英文术语**：「Electron」「llama server」识别不准（TTS 的中文嗓音念英文本身就含糊，真人应该好些）。SenseVoice 不支持热词；如果真机上仍是问题，可以考虑事后用本机大模型结合笔记库里的术语做一遍校正。
- **Windows 与 Intel Mac**：原生包确认存在（npmmirror 上 `sherpa-onnx-win-x64` 8.5 MB、`sherpa-onnx-darwin-x64` 10.7 MB），但没有实机跑过。慢机器上临时文字的刷新间隔需要自适应（识别耗时超过间隔就跳过这一轮）。
- **系统声音采集**（网课、戴耳机开线上会议）：二期再验证，macOS 上要走 ScreenCaptureKit 并申请屏幕录制权限。
- 模型许可：SenseVoice 与 silero VAD 由用户从 Hugging Face 下载、我们不分发；发版前核对一下两者的许可条款。

## 下载清单（给运行时 / 模型目录用）

| 文件 | 来源 | 大小 | SHA256 前缀 |
|---|---|---|---|
| `sherpa-onnx-darwin-arm64-1.13.8.tgz` | registry.npmmirror.com | 10.0 MB | — |
| `sherpa-onnx-darwin-x64-1.13.8.tgz` | 同上 | 10.7 MB | — |
| `sherpa-onnx-win-x64-1.13.8.tgz` | 同上 | 8.5 MB | — |
| `sherpa-onnx-node-1.13.8.tgz`（JS 胶水） | 同上 | 12 KB | — |
| `model.int8.onnx` | hf-mirror.com `csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17` | 228.2 MB | `c71f0ce00bec` |
| `tokens.txt` | 同上 | 0.3 MB | — |
| `silero_vad.onnx` | hf-mirror.com `csukuangfj/vad` | 1.7 MB | `a35ebf52fd3c` |

hf-mirror 的响应头 `x-linked-etag` 就是文件的 SHA256，和下载后本地计算的一致，可以直接当校验值来源。

验证用的脚本、模型和二进制留在 `~/Library/Caches/iml-markdown-editor-dev/asr-spike/`（不在仓库里）：`simulated-streaming.js` 是核心循环的原型，`electron-spike/` 是全链路测试壳，`leak-test.js` 是内存测试。
