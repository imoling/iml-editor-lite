/**
 * 「本机模型」推荐清单：编辑器自己下载、校验并托管运行的 GGUF 模型。
 * 大小与 SHA256 来自 Hugging Face 仓库元数据（2026-09-13 核对）。
 */
export interface LocalModelSpec {
  id: string;
  /** 展示名，如「星火 X2.5-1.7B」 */
  name: string;
  vendor: string;
  quant: string;
  repo: string;
  file: string;
  /** 字节数，用于进度条与完整性校验 */
  size: number;
  sha256: string;
  /** 建议的最低内存（GB）与 CPU 核心数 */
  minRamGB: number;
  minCores: number;
  /** 模型原生支持的最大上下文（token） */
  maxContext: number;
  /** 是否支持「思考模式」（可用 --reasoning-budget 0 关闭） */
  supportsThinking: boolean;
  recommended?: boolean;
  description: string;
}

export const MODEL_CATALOG: LocalModelSpec[] = [
  {
    id: 'spark-x2.5-1.7b-q4km',
    name: '星火 X2.5-1.7B',
    vendor: '科大讯飞',
    quant: 'Q4_K_M',
    repo: 'XHToken/Spark-X2.5-1.7B-GGUF',
    file: 'Spark-X2.5-1.7B-Q4_K_M.gguf',
    size: 1107457856,
    sha256: '902bde2522394954ac17821b3e5fd0df02defbc6944f122253f2580acf0503f4',
    minRamGB: 8,
    minCores: 4,
    maxContext: 1048576,
    supportsThinking: true,
    description: '最轻量，续写、润色、总结都够用；老机器首选',
  },
  {
    id: 'spark-x2.5-4b-q4km',
    name: '星火 X2.5-4B',
    vendor: '科大讯飞',
    quant: 'Q4_K_M',
    repo: 'XHToken/Spark-X2.5-4B-GGUF',
    file: 'Spark-X2.5-4B-Q4_K_M.gguf',
    size: 2600224352,
    sha256: 'adfcfa19a4ed6a5985da8bf565fe15f8e1a7e131d79bae2d19d48d1c40109428',
    minRamGB: 16,
    minCores: 8,
    maxContext: 1048576,
    supportsThinking: true,
    description: '质量与速度的平衡点，中文写作明显更好',
  },
  {
    id: 'spark-x2.5-4b-q8',
    name: '星火 X2.5-4B',
    vendor: '科大讯飞',
    quant: 'Q8_0',
    repo: 'XHToken/Spark-X2.5-4B-GGUF',
    file: 'Spark-X2.5-4B-Q8_0.gguf',
    size: 4375021152,
    sha256: '5c2c3c190e4337e1016b8593ca8e26e8b18c972200b107385d4ec61a25d9dea2',
    minRamGB: 24,
    minCores: 8,
    maxContext: 1048576,
    supportsThinking: true,
    recommended: true,
    description: '几乎无损的 8 位量化，Apple Silicon 24GB 以上机器推荐',
  },
  {
    id: 'minicpm5-2b-q4km',
    name: 'MiniCPM5-2B',
    vendor: '面壁智能',
    quant: 'Q4_K_M',
    repo: 'openbmb/MiniCPM5-2B-GGUF',
    file: 'MiniCPM5-2B-Q4_K_M.gguf',
    size: 1561318368,
    sha256: 'ec2d5801640099e97d8d7e8003ad4d81f336e757811f03a26173dddf386602fd',
    minRamGB: 8,
    minCores: 4,
    maxContext: 131072,
    supportsThinking: true,
    description: '面壁「小钢炮」，端侧速度快',
  },
  {
    id: 'minicpm5-1b-q4km',
    name: 'MiniCPM5-1B',
    vendor: '面壁智能',
    quant: 'Q4_K_M',
    repo: 'openbmb/MiniCPM5-1B-GGUF',
    file: 'MiniCPM5-1B-Q4_K_M.gguf',
    size: 688065920,
    sha256: '81b64d05a23b17b34c475f42b3e72fbde62d4b92cc34541f7a8031d0752deafa',
    minRamGB: 4,
    minCores: 2,
    maxContext: 131072,
    supportsThinking: true,
    description: '不到 700MB，任何机器都能跑，适合快速试用',
  },
  {
    id: 'qwen3-4b-q4km',
    name: 'Qwen3-4B',
    vendor: '阿里通义',
    quant: 'Q4_K_M',
    repo: 'Qwen/Qwen3-4B-GGUF',
    file: 'Qwen3-4B-Q4_K_M.gguf',
    size: 2497280256,
    sha256: '7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5',
    minRamGB: 16,
    minCores: 8,
    maxContext: 40960,
    supportsThinking: true,
    description: '生态最成熟的开源小模型，兼容性最好',
  },
];

export type DownloadSource = 'huggingface' | 'hf-mirror' | 'custom';

export const DOWNLOAD_SOURCES: { id: DownloadSource; label: string; base: string }[] = [
  { id: 'hf-mirror', label: '国内镜像（hf-mirror.com）', base: 'https://hf-mirror.com' },
  { id: 'huggingface', label: 'Hugging Face 官方', base: 'https://huggingface.co' },
  { id: 'custom', label: '自定义地址前缀', base: '' },
];

/** 拼出 GGUF 下载地址：{base}/{repo}/resolve/main/{file} */
export function resolveModelUrl(spec: Pick<LocalModelSpec, 'repo' | 'file'>, source: DownloadSource, customBase = ''): string {
  const preset = DOWNLOAD_SOURCES.find((s) => s.id === source);
  let base = source === 'custom' ? customBase.trim() : preset?.base ?? DOWNLOAD_SOURCES[0].base;
  if (!base) base = DOWNLOAD_SOURCES[0].base;
  base = base.replace(/\/+$/, '');
  return `${base}/${spec.repo}/resolve/main/${spec.file}`;
}

export function findModelSpec(id: string): LocalModelSpec | undefined {
  return MODEL_CATALOG.find((m) => m.id === id);
}

/** 1.1 GB / 688 MB 这样的人类可读大小 */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

/** 上下文长度选项；按模型上限过滤 */
export const CONTEXT_OPTIONS = [4096, 8192, 16384, 32768, 65536, 131072];

export function formatContext(tokens: number): string {
  if (tokens >= 1048576) return `${Math.round(tokens / 1048576)}M`;
  return tokens >= 1024 ? `${Math.round(tokens / 1024)}k` : String(tokens);
}
