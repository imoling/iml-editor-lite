import { finalizeWebm } from './webmDuration';

const MIME = 'audio/webm;codecs=opus';
/** 单声道语音，24 kbps 的 Opus 已经很清楚；一小时约 11 MB */
const BITRATE = 24_000;

export interface Recording { blob: Blob; durationSec: number }

/**
 * 整场转写共用一个录音机：每段录音把当段的麦克风接进来，停下来就暂停。
 * 暂停期间不写数据，所以录音的时间轴 = 各段首尾相接 = 转写时间戳用的那条时间轴，点一句话就能跳到录音里对应的位置。
 * 录音是转写的附属品：它出任何问题都不能影响转写，出错后只是这一场不再录。
 */
export class SessionRecorder {
  private ctx: AudioContext | null = null;
  private dest: MediaStreamAudioDestinationNode | null = null;
  private rec: MediaRecorder | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private chunks: Blob[] = [];
  private recordedMs = 0;
  private runStartedAt = 0;
  /** 录音机中途坏了：已经录下的部分还在，后面的不再录 */
  failed = false;

  static supported(): boolean {
    return typeof MediaRecorder !== 'undefined' && typeof AudioContext !== 'undefined' && MediaRecorder.isTypeSupported(MIME);
  }

  /** 新的一段开始 */
  attach(stream: MediaStream) {
    if (this.failed) return;
    try {
      if (!this.ctx || !this.dest) {
        this.ctx = new AudioContext();
        this.dest = this.ctx.createMediaStreamDestination();
        this.dest.channelCount = 1;
      }
      void this.ctx.resume();
      this.source = this.ctx.createMediaStreamSource(stream);
      this.source.connect(this.dest);
      if (!this.rec) {
        const rec = new MediaRecorder(this.dest.stream, { mimeType: MIME, audioBitsPerSecond: BITRATE });
        rec.ondataavailable = (e) => { if (e.data.size) this.chunks.push(e.data); };
        rec.onerror = () => { this.failed = true; };
        rec.start();
        this.rec = rec;
      } else if (this.rec.state === 'paused') {
        this.rec.resume();
      }
      if (this.rec.state !== 'recording') this.failed = true;
      this.runStartedAt = performance.now();
    } catch {
      this.failed = true;
    }
  }

  /** 这一段结束：暂停，把到目前为止录下的内容交出来（一个完整可播的文件） */
  async detach(): Promise<Recording | null> {
    const rec = this.rec;
    try { this.source?.disconnect(); } catch { /* 已经断开 */ }
    this.source = null;
    if (!rec) return null;
    if (rec.state === 'recording') {
      this.recordedMs += performance.now() - this.runStartedAt;
      rec.pause();
      // 让它把缓冲里的数据吐出来；ondataavailable 先登记，所以这里等到时 chunks 已经收好了
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 2000);
        rec.addEventListener('dataavailable', () => { clearTimeout(timer); resolve(); }, { once: true });
        try { rec.requestData(); } catch { clearTimeout(timer); resolve(); }
      });
    } else if (rec.state === 'inactive') {
      this.failed = true;   // 它自己停了：前面录下的还能用
    }
    void this.ctx?.suspend();
    if (this.chunks.length === 0 || this.recordedMs <= 0) return null;
    return { blob: await finalizeWebm(this.chunks, this.recordedMs, 'audio/webm'), durationSec: this.recordedMs / 1000 };
  }

  dispose() {
    try { if (this.rec && this.rec.state !== 'inactive') this.rec.stop(); } catch { /* 无所谓 */ }
    try { this.source?.disconnect(); } catch { /* 无所谓 */ }
    void this.ctx?.close().catch(() => {});
    this.rec = null; this.source = null; this.dest = null; this.ctx = null;
    this.chunks = [];
    this.recordedMs = 0;
  }
}
