# 本机模型（应用托管的本地推理）

「智能 → 写作助手」三类服务（本机模型 / 本地模型 / 网络模型服务）里的默认项。编辑器自己下载 llama.cpp 的 `llama-server`，下载并校验 GGUF 模型，在 `127.0.0.1` 上拉起进程，AI 气泡与选区润色等所有请求都走这个端点。用户不需要装 Ollama / LM Studio。

## 目录布局

数据都在 `app.getPath('userData')/local-model/` 下，卸载应用或删掉这个目录即可清理：

```
local-model/
├── runtime/
│   ├── current.json        # { tag, bin, installedAt }
│   ├── downloads/          # 发布包临时文件（解压后删除）
│   └── b10936/             # 解压后的 llama.cpp 发布包，llama-server 与 dylib 同目录
├── models/
│   ├── Spark-X2.5-1.7B-Q4_K_M.gguf
│   └── *.gguf.part         # 断点续传中的半成品
└── server.pid              # 运行中的 llama-server 进程号（异常退出后用来清理残留）
```

配置存在 `ai-config.json`：`serviceType: 'builtin' | 'local' | 'cloud'`，`local: { modelId, port, autoStart, thinking, ctxSize, threads, gpuLayers, temperature, source, customBase, proxyPrefix, runtimePath, extraArgs, customModels }`。老配置没有 `serviceType` 时按 Base URL 推断，什么都没填过则默认 `builtin`；26.1 的 `'relay'`（企业中转站）读入时并入 `'cloud'`（主进程 `electron/localModel/config.ts` 与渲染进程 `src/utils/aiService.ts` 各有一份同样的 `inferServiceType`）。

## 主进程模块（`electron/localModel/`）

| 文件 | 职责 |
|---|---|
| `catalog.ts` | 推荐模型清单（仓库、文件名、大小、SHA256、建议内存 / 核心数、最大上下文），下载源拼接（官方 / hf-mirror / 自定义） |
| `hardware.ts` | 芯片、内存、核心数、加速方式（macOS arm64 = Metal），`checkRequirement` 给出满足 / 偏紧 / 不足 |
| `download.ts` | 断点续传下载：`.part` 文件 + `Range` 头，跟随重定向，取消，大小校验，GGUF 魔数校验，SHA256 校验 |
| `runtime.ts` | 从 GitHub Releases 挑本平台的发布包（`macos-arm64.tar.gz` / `win-cpu-x64.zip` / `ubuntu-x64.tar.gz`），解压，找 `llama-server`，`--version` 解析；也识别 Homebrew 装的或用户手动指定的二进制 |
| `server.ts` | `LlamaServer`：拼参数、spawn、轮询 `/health`、日志环形缓冲（500 行）、停止；`pingChat` 用于测试连接 |
| `config.ts` | `LocalModelConfig` 默认值与规范化（纯逻辑，可测试） |
| `index.ts` | 状态聚合（设备 / 运行时 / 模型 / 下载 / 进程）、IPC 句柄、向所有窗口广播 `local:state` / `local:log`、随客户端启动、退出时结束子进程、`ensureBuiltinEndpoint()` 供 `ai:chat` 使用 |

`ai:chat` 在 `serviceType === 'builtin'` 时把端点改写成 `http://127.0.0.1:<port>/v1`、模型名改成运行中的别名；服务没起来会先拉起再发请求。

## llama-server 启动参数

```
llama-server -m <model.gguf> -a <alias> --host 127.0.0.1 --port <port> -c <ctx> --jinja --no-webui -ngl 99
             [-t <threads>] [--reasoning-budget 0]   # 思考模式关闭时
             [--temp <t>] [<额外参数>]
```

思考模式开启时不传 `--reasoning-budget`，模型的推理内容进 `reasoning_content` 字段，流式输出里只显示正文。

## 已知行为

- 新下载的二进制第一次执行时 macOS 会做一次安全扫描（实测 M4 上约 17 秒），所以安装流程最后会跑一次 `--version` 把这个等待放在安装阶段；界面上「启动中」会显示已等待秒数。
- 端口被占用时自动顺延（最多 20 个）。
- 用户导入的 GGUF 只记录路径，「移除」不删文件；推荐清单里的模型「删除」会删掉文件。
- Windows 只挑 CPU 版发布包（通用），需要 CUDA / Vulkan 的用户可用「手动指定」指向自己下载的 `llama-server.exe`。

## 添加一个推荐模型

在 `catalog.ts` 的 `MODEL_CATALOG` 里加一项。大小和 SHA256 可以从 Hugging Face API 取：

```
curl -s "https://huggingface.co/api/models/<repo>?blobs=true" \
  | python3 -c "import sys,json; [print(s['rfilename'], s['size'], s['lfs']['sha256']) for s in json.load(sys.stdin)['siblings'] if s['rfilename'].endswith('.gguf')]"
```

确认上游 llama.cpp 支持该架构（`src/llama-arch.cpp`），否则模型加载会失败。

## 调试

开发模式下这几个环境变量可以做冒烟截图，不碰真实数据：

```
IML_SMOKE_USERDATA=/tmp/iml-userdata IML_SMOKE_QUERY=ai-config IML_SMOKE_SHOT=/tmp/shot.png \
IML_SMOKE_SCRIPT='(async()=>{...})()' npm run dev
```

`IML_SMOKE_USERDATA` 指向的目录里可以预先放好 `local-model/runtime/current.json`、`ai-config.json`，脚本会在页面里点「启动」「测试连接」并在 6 秒后截图。

## 语义索引（26.2）

相关笔记与语义搜索用的是第二个 llama-server 进程，跑一个嵌入模型（`--embedding`），与对话用的本机模型互不影响，也不要求对话走本机模型。代码在 `electron/semantic/`。

- **模型**：`catalog.ts`。BGE-small-zh v1.5（26 MB，默认）、BGE-base-zh v1.5（110 MB）、Qwen3-Embedding 0.6B（639 MB），都是 Q8_0 的 GGUF，大小与 SHA256 来自 Hugging Face 元数据，三个都在 llama.cpp b10936 上实测过。下载复用本机模型的下载器（断点续传、校验、下载源设置），文件放在 `<userData>/local-model/embedding/`。
- **启动参数**：`-c <单条上限 × 4> -b 同 -ub 同 -np 4`，端口从 18180 起找空闲的。上下文在并发槽之间平分，所以单条输入的 token 上限 = `maxTokens`（BGE 为 512）。超长输入 llama-server 会直接 400（`exceed_context_size_error`）并让整批失败，`embedTexts` 会退回逐条处理、对半截断重试。
- **分块**：`chunk.ts`。按标题分节、节内按空行分段，小段合并、大段按句切开；每块前面带上「笔记标题 › 小节标题」。中文约 1 字 1 token，BGE 的分块上限取 360 字。
- **向量库**：`store.ts`。一个笔记库 × 一个模型一个 JSON 文件（`<userData>/semantic-index/`），向量是 Float32 的 base64，常驻内存线性扫描；相关笔记比整篇的平均向量（阈值 0.6），语义搜索取每篇最高分的块（下限 0.4，再按最高分做 0.12 的相对截断）。
- **增量更新**：全文索引建完、目录监听到改动后调用 `syncSemanticIndex()`，按 `mtime + 长度` 判断哪些笔记要重算。
- **进程清理**：pid 记在 `local-model/embed-server.pid`；应用启动时清掉上次残留的进程，`before-quit` 与 SIGTERM / SIGINT 都会带走子进程。
- **AI 总开关**：设置里关掉后不建库、不查询，嵌入服务随即停止。
