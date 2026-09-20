// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createPipeline, SAMPLE_RATE, type PipelineEvent, type Vad, type VadSegment } from './pipeline';
import { GLUE_PACKAGE, NATIVE_PACKAGES, MODEL_FILES, nativePackageFor, nativeDirName, npmTarballUrls, totalDownloadBytes, ASR_RUNTIME_VERSION } from './catalog';

describe('下载清单', () => {
  it('每一项都有大小和 SHA256', () => {
    for (const f of [GLUE_PACKAGE, ...Object.values(NATIVE_PACKAGES), ...MODEL_FILES]) {
      expect(f.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(f.size).toBeGreaterThan(1000);
    }
    // 模型、词表、VAD 的顺序被 index.ts 按下标引用，不能乱
    expect(MODEL_FILES.map((f) => f.file)).toEqual(['sensevoice.int8.onnx', 'sensevoice.tokens.txt', 'silero_vad.onnx']);
  });

  it('我们发布的三个平台都有原生模块；别的平台明确返回 null', () => {
    expect(nativePackageFor('darwin', 'arm64')?.pkg).toBe('sherpa-onnx-darwin-arm64');
    expect(nativePackageFor('darwin', 'x64')?.pkg).toBe('sherpa-onnx-darwin-x64');
    expect(nativePackageFor('win32', 'x64')?.pkg).toBe('sherpa-onnx-win-x64');
    expect(nativePackageFor('linux', 'riscv64')).toBeNull();
    expect(totalDownloadBytes('linux', 'riscv64')).toBeLessThan(totalDownloadBytes('darwin', 'arm64'));
  });

  it('原生模块的目录名要和胶水层找的一致：Windows 写作 win 而不是 win32', () => {
    expect(nativeDirName('win32', 'x64')).toBe('sherpa-onnx-win-x64');
    expect(nativeDirName('darwin', 'arm64')).toBe('sherpa-onnx-darwin-arm64');
    for (const [key, pkg] of Object.entries(NATIVE_PACKAGES)) {
      const [platform, arch] = key.split('-');
      expect(nativeDirName(platform, arch)).toBe(pkg.pkg);
    }
  });

  it('国内镜像与官方源互为备用，顺序跟着用户选的下载源走', () => {
    const [first, second] = npmTarballUrls('sherpa-onnx-node', false);
    expect(first).toContain('npmmirror.com');
    expect(second).toContain('registry.npmjs.org');
    expect(npmTarballUrls('sherpa-onnx-node', true)[0]).toContain('registry.npmjs.org');
    expect(first.endsWith(`sherpa-onnx-node-${ASR_RUNTIME_VERSION}.tgz`)).toBe(true);
  });
});

/** 假 VAD：振幅超过 0.1 算人声；连续 10 个静音窗口（约 0.32 秒）算一句说完 */
class FakeVad implements Vad {
  private speaking = false;
  private silent = 0;
  private current: number[] = [];
  private startAt = 0;
  private fed = 0;
  private queue: VadSegment[] = [];
  acceptWaveform(w: Float32Array) {
    const loud = w.some((x) => Math.abs(x) > 0.1);
    if (loud) { if (!this.speaking) { this.speaking = true; this.startAt = this.fed; this.current = []; } this.silent = 0; }
    if (this.speaking) {
      this.current.push(...w);
      if (!loud && ++this.silent >= 10) this.end();
    }
    this.fed += w.length;
  }
  private end() { this.queue.push({ start: this.startAt, samples: Float32Array.from(this.current) }); this.speaking = false; this.current = []; this.silent = 0; }
  isDetected() { return this.speaking; }
  isEmpty() { return this.queue.length === 0; }
  front() { return this.queue[0]; }
  pop() { this.queue.shift(); }
  flush() { if (this.speaking) this.end(); }
}

const chunk = (value: number) => new Float32Array(1600).fill(value);   // 100 ms

function harness(decodeMs = 0, partialEveryMs = 500) {
  let clock = 0;
  const events: PipelineEvent[] = [];
  let decodes = 0;
  const pipe = createPipeline(
    { decode: (s) => { decodes++; clock += decodeMs; return `${(s.length / SAMPLE_RATE).toFixed(1)}s`; } },
    new FakeVad(),
    (e) => events.push(e),
    { partialEveryMs, now: () => clock },
  );
  const say = (seconds: number) => { for (let i = 0; i < seconds * 10; i++) { pipe.feed(chunk(0.5)); clock += 100; } };
  const pause = (seconds: number) => { for (let i = 0; i < seconds * 10; i++) { pipe.feed(chunk(0)); clock += 100; } };
  return { pipe, events, say, pause, decodes: () => decodes };
}

describe('模拟流式的识别循环', () => {
  it('说话期间隔一会儿出一次临时文字，越来越长；说完出一条定稿', () => {
    const h = harness();
    h.say(2);
    const partials = h.events.filter((e) => e.type === 'partial');
    expect(partials.length).toBeGreaterThanOrEqual(3);
    expect(partials.every((p, i) => i === 0 || parseFloat(p.text) > parseFloat(partials[i - 1].text))).toBe(true);
    expect(h.events.some((e) => e.type === 'final')).toBe(false);

    h.pause(1);
    const finals = h.events.filter((e) => e.type === 'final');
    expect(finals).toHaveLength(1);
    expect(finals[0].start).toBeCloseTo(0, 1);
    expect((finals[0] as any).duration).toBeGreaterThan(2);
  });

  it('两句话各自定稿，起始时间按音频位置算（不受墙钟影响）', () => {
    const h = harness();
    h.say(1); h.pause(1); h.say(1.5); h.pause(1);
    const finals = h.events.filter((e) => e.type === 'final');
    expect(finals).toHaveLength(2);
    expect(finals[1].start).toBeCloseTo(2, 0);
  });

  it('没人说话时一次识别都不做', () => {
    const h = harness();
    h.pause(5);
    expect(h.decodes()).toBe(0);
    expect(h.events).toEqual([]);
  });

  it('停止录音时，还没说完的最后一句也要吐出来', () => {
    const h = harness();
    h.say(1.5);
    expect(h.events.some((e) => e.type === 'final')).toBe(false);
    h.pipe.finish();
    expect(h.events.filter((e) => e.type === 'final')).toHaveLength(1);
  });

  it('慢机器上自动拉开临时文字的间隔：一次识别要 800 ms 的话，不会还按 500 ms 去刷', () => {
    const fast = harness(10);
    fast.say(6);
    const slow = harness(800);
    slow.say(6);
    const count = (h: ReturnType<typeof harness>) => h.events.filter((e) => e.type === 'partial').length;
    expect(count(slow)).toBeLessThan(count(fast) / 2);
    expect(count(slow)).toBeGreaterThan(0);
  });

  it('识别出空文字（只有噪声）的片段不发事件', () => {
    const events: PipelineEvent[] = [];
    const pipe = createPipeline({ decode: () => '  ' }, new FakeVad(), (e) => events.push(e), { now: () => 0 });
    for (let i = 0; i < 10; i++) pipe.feed(chunk(0.5));
    for (let i = 0; i < 10; i++) pipe.feed(chunk(0));
    expect(events).toEqual([]);
  });

  it('区分说话人：声纹只在定稿时算一次（临时文字不算）；算声纹出错不能连累转写', () => {
    let clock = 0; let embeds = 0;
    const events: PipelineEvent[] = [];
    const make = (embed: (s: Float32Array) => number[] | null) => createPipeline({ decode: (s) => `${(s.length / SAMPLE_RATE).toFixed(1)}s` }, new FakeVad(), (e) => events.push(e), { now: () => clock, embed });
    const drive = (pipe: ReturnType<typeof createPipeline>) => { for (let i = 0; i < 20; i++) { pipe.feed(chunk(0.5)); clock += 100; } for (let i = 0; i < 10; i++) { pipe.feed(chunk(0)); clock += 100; } };

    drive(make((samples) => { embeds++; return [samples.length, 0.25]; }));
    const finals = events.filter((e) => e.type === 'final');
    expect(events.some((e) => e.type === 'partial')).toBe(true);
    expect(finals).toHaveLength(1);
    expect(embeds).toBe(1);
    expect(finals[0]).toMatchObject({ embedding: [expect.any(Number), 0.25] });

    events.length = 0;
    drive(make(() => { throw new Error('声纹模型炸了'); }));
    expect(events.filter((e) => e.type === 'final')).toHaveLength(1);
    expect(events.find((e) => e.type === 'final')).not.toHaveProperty('embedding');

    events.length = 0;
    drive(make(() => null));   // 太短、算不出来
    expect(events.find((e) => e.type === 'final')).not.toHaveProperty('embedding');
  });
});

