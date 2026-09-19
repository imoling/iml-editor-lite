/**
 * 转写识别进程（Electron utilityProcess）：在这里加载 sherpa-onnx 的原生模块并跑识别循环。
 * 单独一个进程有三个好处：近 1 GB 的内存只在录音期间占用、原生模块崩了不连累主进程、停止录音直接杀掉最干净。
 */
import path from 'path';
import { createPipeline, SAMPLE_RATE, type Recognizer, type Vad } from './pipeline';

interface InitMessage { type: 'init'; glueDir: string; model: string; tokens: string; vad: string; threads: number }
type Incoming = InitMessage | { type: 'pcm'; samples: Float32Array | ArrayBuffer } | { type: 'finish' };

const port = (process as any).parentPort as { on: (ev: 'message', cb: (e: { data: Incoming }) => void) => void; postMessage: (m: unknown) => void };
let pipeline: ReturnType<typeof createPipeline> | null = null;

function init(msg: InitMessage) {
  const t0 = Date.now();
  // 胶水层在 userData 里，路径运行时才知道
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sherpa = require(path.join(msg.glueDir, 'sherpa-onnx.js'));
  const offline = new sherpa.OfflineRecognizer({
    featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
    modelConfig: {
      senseVoice: { model: msg.model, language: 'auto', useInverseTextNormalization: 1 },
      tokens: msg.tokens, numThreads: msg.threads, provider: 'cpu', debug: 0,
    },
  });
  const nativeVad = new sherpa.Vad({
    sileroVad: { model: msg.vad, threshold: 0.5, minSpeechDuration: 0.25, minSilenceDuration: 0.6, maxSpeechDuration: 20, windowSize: 512 },
    sampleRate: SAMPLE_RATE, numThreads: 1, provider: 'cpu', debug: 0,
  }, 60);

  const recognizer: Recognizer = {
    decode(samples) {
      const stream = offline.createStream();
      stream.acceptWaveform({ samples, sampleRate: SAMPLE_RATE });
      offline.decode(stream);
      return offline.getResult(stream).text || '';
    },
  };
  const vad: Vad = {
    acceptWaveform: (w) => nativeVad.acceptWaveform(w),
    isDetected: () => nativeVad.isDetected(),
    isEmpty: () => nativeVad.isEmpty(),
    // Electron 开了 V8 内存沙箱，原生模块不能返回外部缓冲区：必须传 false 让它拷贝一份，否则直接抛错
    front: () => nativeVad.front(false),
    pop: () => nativeVad.pop(),
    flush: () => nativeVad.flush(),
  };
  pipeline = createPipeline(recognizer, vad, (e) => port.postMessage(e));
  port.postMessage({ type: 'ready', loadMs: Date.now() - t0 });
}

port.on('message', ({ data }) => {
  try {
    if (data.type === 'init') init(data);
    else if (data.type === 'pcm') pipeline?.feed(data.samples instanceof Float32Array ? data.samples : new Float32Array(data.samples));
    else if (data.type === 'finish') { pipeline?.finish(); port.postMessage({ type: 'done' }); }
  } catch (err: any) {
    port.postMessage({ type: 'error', message: String(err?.message || err) });
  }
});
