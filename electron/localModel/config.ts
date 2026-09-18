import path from 'path';
import type { DownloadSource } from './catalog';

export type AIServiceType = 'builtin' | 'local' | 'cloud';

const LOCAL_ENDPOINT_RE = /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/i;

/**
 * 当前用哪种服务：显式字段优先；老配置按地址推断；什么都没填过的全新安装默认本机模型；
 * 26.1 的 'relay'（企业中转站）并入 'cloud'。
 *
 * 渲染进程 src/utils/aiService.ts 有一份**必须等价**的实现（渲染进程引不了 Node 模块，只能各写一份）：
 * 状态栏按那份显示「AI 发往哪里」，而请求实际发往哪里由这份决定 —— 两边不一致，
 * 用户看到的就是假的。localModel.test.ts 里对同一张用例表逐例比对两份实现，改任何一份都会被测出来。
 */
export function inferServiceType(config: { serviceType?: string | null; endpoint?: string | null } | null | undefined): AIServiceType {
  const t = config?.serviceType;
  if (t === 'builtin' || t === 'local' || t === 'cloud') return t;
  if (t === 'relay') return 'cloud';
  const endpoint = (config?.endpoint || '').trim();
  if (!endpoint) return 'builtin';
  return LOCAL_ENDPOINT_RE.test(endpoint) ? 'local' : 'cloud';
}

export interface CustomModel { id: string; name: string; path: string; size: number }

/** 「本机模型」的持久化配置（存在 ai-config.json 的 local 字段里） */
export interface LocalModelConfig {
  modelId: string;
  port: number;
  autoStart: boolean;
  thinking: boolean;
  ctxSize: number;
  threads: number | null;
  gpuLayers: number | null;
  temperature: number | null;
  source: DownloadSource;
  customBase: string;
  proxyPrefix: string;
  runtimePath: string | null;
  extraArgs: string;
  customModels: CustomModel[];
}

export const DEFAULT_LOCAL_CONFIG: LocalModelConfig = {
  modelId: 'spark-x2.5-1.7b-q4km',
  port: 18080,
  autoStart: false,
  thinking: false,
  ctxSize: 32768,
  threads: null,
  gpuLayers: null,
  temperature: null,
  source: 'hf-mirror',
  customBase: '',
  proxyPrefix: '',
  runtimePath: null,
  extraArgs: '',
  customModels: [],
};

const num = (v: unknown, fallback: number | null): number | null => {
  if (v === '' || v === null || v === undefined) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

/** 把用户配置（可能缺字段、可能是老版本）补齐成完整的 LocalModelConfig */
export function normalizeLocalConfig(raw: any): LocalModelConfig {
  const r = raw && typeof raw === 'object' ? raw : {};
  const sources: DownloadSource[] = ['huggingface', 'hf-mirror', 'custom'];
  return {
    modelId: typeof r.modelId === 'string' && r.modelId ? r.modelId : DEFAULT_LOCAL_CONFIG.modelId,
    port: Math.min(65535, Math.max(1024, num(r.port, DEFAULT_LOCAL_CONFIG.port) ?? DEFAULT_LOCAL_CONFIG.port)),
    autoStart: !!r.autoStart,
    thinking: !!r.thinking,
    ctxSize: Math.max(512, num(r.ctxSize, DEFAULT_LOCAL_CONFIG.ctxSize) ?? DEFAULT_LOCAL_CONFIG.ctxSize),
    threads: num(r.threads, null),
    gpuLayers: num(r.gpuLayers, null),
    temperature: num(r.temperature, null),
    source: sources.includes(r.source) ? r.source : DEFAULT_LOCAL_CONFIG.source,
    customBase: typeof r.customBase === 'string' ? r.customBase : '',
    proxyPrefix: typeof r.proxyPrefix === 'string' ? r.proxyPrefix : '',
    runtimePath: typeof r.runtimePath === 'string' && r.runtimePath ? r.runtimePath : null,
    extraArgs: typeof r.extraArgs === 'string' ? r.extraArgs : '',
    customModels: Array.isArray(r.customModels)
      ? r.customModels.filter((m: any) => m && typeof m.path === 'string' && typeof m.id === 'string').map((m: any) => ({ id: m.id, name: String(m.name || path.basename(m.path)), path: m.path, size: Number(m.size) || 0 }))
      : [],
  };
}

