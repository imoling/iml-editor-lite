/** 模型服务的四种接入方式（与主进程 electron/localModel 的 AIServiceType 一致） */
export type AIServiceType = 'relay' | 'cloud' | 'local' | 'builtin';
export type Protocol = 'openai' | 'anthropic';

export interface ServiceTypeInfo {
  id: AIServiceType;
  title: string;
  desc: string;
}

export const SERVICE_TYPES: ServiceTypeInfo[] = [
  { id: 'relay', title: '企业模型中转站', desc: '公司内网 / 中转站的兼容接口' },
  { id: 'cloud', title: '网络模型服务', desc: 'OpenAI、DeepSeek、Anthropic 等' },
  { id: 'local', title: '本地模型', desc: 'Ollama / LM Studio / llama.cpp 已在运行' },
  { id: 'builtin', title: '本机模型', desc: '编辑器自己下载并托管运行，零配置' },
];

export interface Preset {
  label: string;
  type: Exclude<AIServiceType, 'builtin'>;
  protocol: Protocol;
  endpoint: string;
  model: string;
  placeholder: string;
}

export const PRESETS: Preset[] = [
  { label: 'Ollama',     type: 'local', protocol: 'openai', endpoint: 'http://localhost:11434/v1', model: '', placeholder: '本地服务无需 Key' },
  { label: 'LM Studio',  type: 'local', protocol: 'openai', endpoint: 'http://localhost:1234/v1',  model: '', placeholder: '本地服务无需 Key' },
  { label: 'llama.cpp',  type: 'local', protocol: 'openai', endpoint: 'http://localhost:8080/v1',  model: '', placeholder: '本地服务无需 Key' },
  { label: 'OpenAI',     type: 'cloud', protocol: 'openai',    endpoint: 'https://api.openai.com/v1',          model: 'gpt-4o',            placeholder: 'sk-...' },
  { label: 'Anthropic',  type: 'cloud', protocol: 'anthropic', endpoint: 'https://api.anthropic.com/v1',       model: 'claude-sonnet-4-5', placeholder: 'sk-ant-...' },
  { label: 'DeepSeek',   type: 'cloud', protocol: 'openai',    endpoint: 'https://api.deepseek.com/v1',        model: 'deepseek-chat',     placeholder: 'sk-...' },
  { label: 'Gemini',     type: 'cloud', protocol: 'openai',    endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.0-flash', placeholder: 'AIza...' },
  { label: '中转 / 自定义', type: 'relay', protocol: 'openai', endpoint: '', model: '', placeholder: 'sk-...' },
];

export const isLocalEndpoint = (endpoint: string) => /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:|\/|$)/i.test((endpoint || '').trim());

const normalize = (url: string) => (url || '').trim().replace(/\/+$/, '');

/** 按 Base URL 找到对应的预设（中转 / 自定义没有固定地址，匹配不到时兜底） */
export function findPreset(endpoint: string): Preset | undefined {
  const e = normalize(endpoint);
  return PRESETS.find((p) => p.endpoint && e.startsWith(normalize(p.endpoint)));
}

/** 老配置没有 serviceType 字段：按地址推断，本机地址算「本地模型」，已知云厂商算「网络模型服务」，其余算中转站 */
export function inferServiceType(config: { serviceType?: string | null; endpoint?: string | null } | null | undefined): AIServiceType {
  const t = config?.serviceType;
  if (t === 'relay' || t === 'cloud' || t === 'local' || t === 'builtin') return t;
  const endpoint = config?.endpoint || '';
  if (!endpoint) return 'cloud';
  if (isLocalEndpoint(endpoint)) return 'local';
  const preset = findPreset(endpoint);
  return preset?.type === 'cloud' ? 'cloud' : 'relay';
}

/** 「切回模型服务」时回到的类型：不能是本机模型 */
export function fallbackServiceType(config: { endpoint?: string | null } | null | undefined): Exclude<AIServiceType, 'builtin'> {
  const t = inferServiceType({ ...(config || {}), serviceType: null });
  return t === 'builtin' ? 'cloud' : t;
}

import type { LocalModelConfig } from '../types/window';

/** 与主进程 electron/localModel/config.ts 的默认值保持一致（渲染进程不能引用 Node 模块） */
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
