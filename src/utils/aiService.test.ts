import { describe, it, expect } from 'vitest';
import { inferServiceType, fallbackServiceType, findPreset, PRESETS, SERVICE_TYPES } from './aiService';

describe('aiService', () => {
  it('显式 serviceType 优先', () => {
    expect(inferServiceType({ serviceType: 'builtin', endpoint: 'https://api.openai.com/v1' })).toBe('builtin');
    expect(inferServiceType({ serviceType: 'relay', endpoint: 'http://localhost:11434/v1' })).toBe('relay');
  });

  it('老配置按地址推断', () => {
    expect(inferServiceType({ endpoint: 'http://localhost:11434/v1' })).toBe('local');
    expect(inferServiceType({ endpoint: 'http://127.0.0.1:8080/v1/' })).toBe('local');
    expect(inferServiceType({ endpoint: 'https://api.deepseek.com/v1' })).toBe('cloud');
    expect(inferServiceType({ endpoint: 'https://api.anthropic.com/v1' })).toBe('cloud');
    expect(inferServiceType({ endpoint: 'https://relay.example.com/v1' })).toBe('relay');
    expect(inferServiceType({ endpoint: '' })).toBe('cloud');
    expect(inferServiceType(null)).toBe('cloud');
  });

  it('切回模型服务时永远不会回到本机模型', () => {
    expect(fallbackServiceType({ endpoint: 'http://localhost:1234/v1' })).toBe('local');
    expect(fallbackServiceType({ endpoint: 'https://api.openai.com/v1' })).toBe('cloud');
    expect(fallbackServiceType({ endpoint: 'https://x.example.com' })).toBe('relay');
  });

  it('预设按地址前缀匹配，尾部斜杠不影响', () => {
    expect(findPreset('https://api.openai.com/v1/')?.label).toBe('OpenAI');
    expect(findPreset('http://localhost:11434/v1')?.label).toBe('Ollama');
    expect(findPreset('https://nowhere.example.com')).toBeUndefined();
  });

  it('每种服务类型（本机模型除外）都至少有一个预设', () => {
    for (const t of SERVICE_TYPES) {
      if (t.id === 'builtin') continue;
      expect(PRESETS.some((p) => p.type === t.id)).toBe(true);
    }
  });
});
