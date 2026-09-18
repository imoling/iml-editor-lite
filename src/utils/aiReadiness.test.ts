import { describe, it, expect } from 'vitest';
import { describeAiReadiness, pickBestLocalModel } from './aiReadiness';

const localState = (runtimeInstalled: boolean, models: any[]) => ({ runtime: { installed: runtimeInstalled } as any, models: models as any });
const model = (id: string, downloaded: boolean, extra: any = {}) => ({ id, downloaded, recommended: false, ...extra });

describe('describeAiReadiness', () => {
  it('总开关关掉时一切免谈', () => {
    const r = describeAiReadiness(false, { serviceType: 'cloud', endpoint: 'https://api.openai.com/v1' }, null);
    expect(r).toMatchObject({ ready: false, blocker: 'disabled' });
  });

  it('本机模型：缺运行时 → runtime，缺模型 → model，齐了 → ready', () => {
    const cfg = { serviceType: 'builtin', local: { modelId: 'a' } };
    expect(describeAiReadiness(true, cfg, localState(false, [model('a', true)])).blocker).toBe('runtime');
    expect(describeAiReadiness(true, cfg, localState(true, [model('a', false)])).blocker).toBe('model');
    expect(describeAiReadiness(true, cfg, localState(true, [model('a', true)])).ready).toBe(true);
  });

  it('本机模型：配置里指的模型不在列表里时，看推荐的那个下没下', () => {
    const cfg = { serviceType: 'builtin', local: { modelId: '不存在' } };
    expect(describeAiReadiness(true, cfg, localState(true, [model('a', true, { recommended: true })])).ready).toBe(true);
    expect(describeAiReadiness(true, cfg, localState(true, [model('a', false, { recommended: true })])).blocker).toBe('model');
  });

  it('本机模型：状态还没读回来时先别拦（免得一打开就闪一下「没配好」）', () => {
    expect(describeAiReadiness(true, { serviceType: 'builtin' }, null).ready).toBe(true);
  });

  it('网络 / 本地服务：没地址 → endpoint', () => {
    expect(describeAiReadiness(true, { serviceType: 'cloud', endpoint: '' }, null).blocker).toBe('endpoint');
    expect(describeAiReadiness(true, { serviceType: 'cloud', endpoint: '   ' }, null).blocker).toBe('endpoint');
  });

  it('Anthropic 协议必须有 Key；OpenAI 兼容的本地服务可以没有', () => {
    expect(describeAiReadiness(true, { serviceType: 'cloud', endpoint: 'https://api.anthropic.com/v1', protocol: 'anthropic', apiKey: '' }, null).blocker).toBe('key');
    expect(describeAiReadiness(true, { serviceType: 'cloud', endpoint: 'https://api.anthropic.com/v1', protocol: 'anthropic', apiKey: 'sk-ant-x' }, null).ready).toBe(true);
    expect(describeAiReadiness(true, { serviceType: 'local', endpoint: 'http://localhost:11434/v1', protocol: 'openai', apiKey: '' }, null).ready).toBe(true);
  });

  it('全新安装（空配置）走本机模型那条线，而不是说「没填地址」', () => {
    expect(describeAiReadiness(true, {}, localState(false, [])).blocker).toBe('runtime');
  });
});

describe('pickBestLocalModel', () => {
  const m = (name: string, size: number, level: string, custom = false) => ({ name, size, requirement: { level }, custom });

  it('能跑得动的里面挑最大的', () => {
    const best = pickBestLocalModel([m('小', 1e9, 'ok'), m('中', 2e9, 'ok'), m('大', 4e9, 'fail')]);
    expect(best?.name).toBe('中');
  });

  it('一个都跑不动时挑最小的，而不是返回空', () => {
    expect(pickBestLocalModel([m('中', 2e9, 'fail'), m('小', 1e9, 'warn')])?.name).toBe('小');
  });

  it('warn（配置偏紧）不算能跑得动，但仍好过挡住用户', () => {
    expect(pickBestLocalModel([m('大', 4e9, 'warn'), m('小', 1e9, 'warn')])?.name).toBe('小');
    expect(pickBestLocalModel([m('大', 4e9, 'warn'), m('小', 1e9, 'ok')])?.name).toBe('小');
  });

  it('已导入的自定义模型不参与', () => {
    expect(pickBestLocalModel([m('自己的', 9e9, 'ok', true), m('推荐的', 1e9, 'ok')])?.name).toBe('推荐的');
    expect(pickBestLocalModel([m('自己的', 9e9, 'ok', true)])).toBeNull();
  });

  it('空列表返回 null', () => {
    expect(pickBestLocalModel([])).toBeNull();
  });
});
