import { describe, it, expect } from 'vitest';
import { inferServiceType, fallbackServiceType, findPreset, PRESETS, SERVICE_TYPES } from './aiService';

describe('aiService', () => {
  it('显式 serviceType 优先；26.1 的 relay 并入网络模型服务', () => {
    expect(inferServiceType({ serviceType: 'builtin', endpoint: 'https://api.openai.com/v1' })).toBe('builtin');
    expect(inferServiceType({ serviceType: 'local', endpoint: 'https://api.openai.com/v1' })).toBe('local');
    expect(inferServiceType({ serviceType: 'relay', endpoint: 'https://relay.example.com/v1' })).toBe('cloud');
  });

  it('老配置按地址推断；全新安装默认本机模型', () => {
    expect(inferServiceType({ endpoint: 'http://localhost:11434/v1' })).toBe('local');
    expect(inferServiceType({ endpoint: 'http://127.0.0.1:8080/v1/' })).toBe('local');
    expect(inferServiceType({ endpoint: 'https://api.deepseek.com/v1' })).toBe('cloud');
    expect(inferServiceType({ endpoint: 'https://relay.example.com/v1' })).toBe('cloud');
    expect(inferServiceType({ endpoint: '' })).toBe('builtin');
    expect(inferServiceType(null)).toBe('builtin');
  });

  it('切回模型服务时永远不会回到本机模型', () => {
    expect(fallbackServiceType({ endpoint: 'http://localhost:1234/v1' })).toBe('local');
    expect(fallbackServiceType({ endpoint: 'https://api.openai.com/v1' })).toBe('cloud');
    expect(fallbackServiceType({ endpoint: 'https://x.example.com' })).toBe('cloud');
    expect(fallbackServiceType({ endpoint: '' })).toBe('cloud');
  });

  it('预设按地址前缀匹配，尾部斜杠不影响', () => {
    expect(findPreset('https://api.openai.com/v1/')?.label).toBe('OpenAI');
    expect(findPreset('http://localhost:11434/v1')?.label).toBe('Ollama');
    expect(findPreset('https://nowhere.example.com')).toBeUndefined();
  });

  it('本机模型排第一（默认）；其余每种类型都至少有一个预设，网络模型服务含自定义', () => {
    expect(SERVICE_TYPES[0].id).toBe('builtin');
    for (const t of SERVICE_TYPES) {
      if (t.id === 'builtin') continue;
      expect(PRESETS.some((p) => p.type === t.id)).toBe(true);
    }
    expect(PRESETS.find((p) => p.label === '自定义')?.type).toBe('cloud');
  });

  it('Agnes 国内站 / 国际站是网络模型服务里的前两个预设，地址各自独立、能按地址认回来', () => {
    const cloud = PRESETS.filter((p) => p.type === 'cloud');
    expect(cloud.slice(0, 2).map((p) => p.label)).toEqual(['Agnes 国内站', 'Agnes 国际站']);
    expect(findPreset('https://api.agnes-ai.cn/v1')?.label).toBe('Agnes 国内站');
    expect(findPreset('https://apihub.agnes-ai.com/v1/')?.label).toBe('Agnes 国际站');
    expect(inferServiceType({ endpoint: 'https://api.agnes-ai.cn/v1' })).toBe('cloud');
  });
});
