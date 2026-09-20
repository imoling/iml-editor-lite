/**
 * 模拟流式转写的核心循环：silero VAD 切句；一句话还在说的时候，隔一会儿把「目前为止的这一句」整句重识别一遍出临时文字；
 * VAD 判定说完后用完整的这一句定稿。SenseVoice 不是流式模型，但足够快（RTF 约 0.02），这样做临时文字就带标点，
 * 也不需要「流式出草稿 + 离线定稿」两个模型。依据见 docs/transcription-spike.md。
 *
 * 识别器和 VAD 从外面注入：正式运行时是 sherpa-onnx 的原生对象，测试里是假的。
 */

export const SAMPLE_RATE = 16000;
const VAD_WINDOW = 512;                       // silero VAD 要求按 512 个采样一窗喂
const PRE_ROLL = Math.round(0.35 * SAMPLE_RATE); // VAD 判定「开始说话」有滞后，往前多留一点，免得吃掉句首
const MIN_PARTIAL_SAMPLES = Math.round(0.4 * SAMPLE_RATE);

export interface Recognizer { decode(samples: Float32Array): string }

export interface VadSegment { start: number; samples: Float32Array }
export interface Vad {
  acceptWaveform(window: Float32Array): void;
  isDetected(): boolean;
  isEmpty(): boolean;
  front(): VadSegment;
  pop(): void;
  flush(): void;
}

export type PipelineEvent =
  | { type: 'partial'; text: string; start: number; decodeMs: number }
  | { type: 'final'; text: string; start: number; duration: number; decodeMs: number; /** 这句话的声纹（开了「区分说话人」才有） */ embedding?: number[] };

export interface PipelineOptions {
  /** 临时文字多久刷新一次（毫秒） */
  partialEveryMs?: number;
  now?: () => number;
  /** 算一句话的声纹。只在定稿时算一次（临时文字不算）；算不出来返回 null，不能影响转写 */
  embed?: (samples: Float32Array) => number[] | null;
}

export function createPipeline(recognizer: Recognizer, vad: Vad, onEvent: (e: PipelineEvent) => void, opts: PipelineOptions = {}) {
  const baseInterval = opts.partialEveryMs ?? 500;
  const now = opts.now ?? Date.now;

  let pending = new Float32Array(0);   // 还没凑够一个 VAD 窗口的零头
  let tail = new Float32Array(0);      // 最近一小段音频，作句首预留
  let speech: Float32Array[] = [];     // 当前这句已经收到的采样块
  let speechLen = 0;
  let speaking = false;
  let fed = 0;                         // 累计喂入的采样数，用来给临时文字估一个起始时间
  let lastPartialAt = 0;
  let interval = baseInterval;

  const concat = (chunks: Float32Array[], len: number) => { const out = new Float32Array(len); let at = 0; for (const c of chunks) { out.set(c, at); at += c.length; } return out; };
  const timed = (samples: Float32Array) => { const t = now(); const text = recognizer.decode(samples).trim(); return { text, ms: now() - t }; };

  const feed = (chunk: Float32Array) => {
    fed += chunk.length;
    const merged = new Float32Array(pending.length + chunk.length);
    merged.set(pending); merged.set(chunk, pending.length);
    let at = 0;
    for (; at + VAD_WINDOW <= merged.length; at += VAD_WINDOW) vad.acceptWaveform(merged.subarray(at, at + VAD_WINDOW));
    pending = merged.slice(at);

    if (vad.isDetected() && !speaking) { speaking = true; speech = [tail]; speechLen = tail.length; lastPartialAt = now(); }
    if (speaking && chunk.length) { speech.push(chunk); speechLen += chunk.length; }

    const joined = new Float32Array(tail.length + chunk.length);
    joined.set(tail); joined.set(chunk, tail.length);
    tail = joined.slice(Math.max(0, joined.length - PRE_ROLL));

    // 一句话说完：VAD 吐出完整片段 → 定稿
    while (!vad.isEmpty()) {
      const seg = vad.front();
      vad.pop();
      const r = timed(seg.samples);
      if (r.text) {
        let embedding: number[] | null = null;
        try { embedding = opts.embed?.(seg.samples) ?? null; } catch { /* 声纹是锦上添花，出错就当没有 */ }
        onEvent({ type: 'final', text: r.text, start: seg.start / SAMPLE_RATE, duration: seg.samples.length / SAMPLE_RATE, decodeMs: r.ms, ...(embedding ? { embedding } : {}) });
      }
      speaking = vad.isDetected();
      speech = speaking ? [tail] : [];
      speechLen = speaking ? tail.length : 0;
    }

    // 还在说：隔一会儿把这一句重识别一遍，出临时文字
    if (speaking && speechLen > MIN_PARTIAL_SAMPLES && now() - lastPartialAt >= interval) {
      const r = timed(concat(speech, speechLen));
      lastPartialAt = now();
      // 慢机器上一次识别可能比刷新间隔还长：把间隔拉开，别让临时文字挤占定稿的时间；快了再收回来
      interval = Math.max(baseInterval, Math.min(3000, r.ms * 2));
      if (r.text) onEvent({ type: 'partial', text: r.text, start: Math.max(0, fed - speechLen) / SAMPLE_RATE, decodeMs: r.ms });
    }
  };

  return {
    feed,
    /** 录音结束：把 VAD 里还没吐出来的最后一句逼出来 */
    finish() { vad.flush(); feed(new Float32Array(0)); },
  };
}
