/**
 * 转写一段已有的录音：把音频文件解码成识别模型要的 16 kHz 单声道。
 *
 * 解码交给 Chromium（decodeAudioData）：m4a / mp3 / wav / flac / ogg / webm 都认，不用带一个 ffmpeg。
 * 代价是它只能整段解：实测 60 分钟的单声道 m4a 解码 2 秒，但解码那一刻渲染进程的内存峰值约 1.2 GB
 * （先按原采样率全部解开，再重采样），立体声再翻一倍。所以给时长设个上限 —— 内存不够时渲染进程是直接崩掉，拦不住的。
 */

export const AUDIO_FILE_EXTS = ['m4a', 'mp3', 'wav', 'aac', 'flac', 'ogg', 'oga', 'opus', 'webm'];
/** 实测 60 分钟单声道：转写期间渲染进程约 1.2 GB，解码瞬间峰值 1.8 GB；立体声的源文件还要再高。先保守一点，更长的分段转 */
export const MAX_FILE_MINUTES = 90;
export const FILE_SAMPLE_RATE = 16000;

export const isAudioFile = (path: string) => new RegExp(`\\.(${AUDIO_FILE_EXTS.join('|')})$`, 'i').test(path);

/** 不含目录和扩展名的文件名 */
export function audioBaseName(path: string): string {
  return (path.split(/[\\/]/).pop() || path).replace(/\.[^.]+$/, '');
}

/** 只读文件头拿时长，不解码：用来在真正解码之前把太长的挡掉 */
export function probeDuration(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const audio = new Audio();
    audio.preload = 'metadata';
    const release = () => { audio.onloadedmetadata = null; audio.onerror = null; audio.src = ''; };
    audio.onloadedmetadata = () => {
      const duration = audio.duration;          // 先把时长读出来再松手：src 一清空，duration 就变成 NaN 了
      release();
      if (Number.isFinite(duration) && duration > 0) resolve(duration); else reject(new Error('读不出这段录音的时长'));
    };
    audio.onerror = () => { release(); reject(new Error('打不开这个文件：不是能识别的音频格式，或者文件坏了')); };
    audio.src = url;
  });
}

/** 多声道平均成单声道 */
export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const out = new Float32Array(channels[0].length);
  for (const ch of channels) for (let i = 0; i < out.length; i++) out[i] += ch[i];
  for (let i = 0; i < out.length; i++) out[i] /= channels.length;
  return out;
}

export async function decodeToMono16k(url: string): Promise<Float32Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('读不到这个文件');
  const bytes = await res.arrayBuffer();
  // OfflineAudioContext 的采样率就是解码结果的采样率：重采样也交给 Chromium
  const ctx = new OfflineAudioContext({ numberOfChannels: 1, length: 1, sampleRate: FILE_SAMPLE_RATE });
  let buffer: AudioBuffer;
  try { buffer = await ctx.decodeAudioData(bytes); } catch { throw new Error('这段录音解码失败：格式不支持，或者文件坏了'); }
  return mixToMono(Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i)));
}
