import path from 'path';
import type { DownloadSource } from './catalog';

export type AIServiceType = 'relay' | 'cloud' | 'local' | 'builtin';

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

