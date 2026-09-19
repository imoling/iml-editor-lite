import { create } from 'zustand';
import type { AsrState, AsrEvent } from '../types/window';
import { startMicCapture, MIC_SILENCE_LEVEL, type MicCapture } from '../utils/micCapture';
import { getPreferredMic, setPreferredMic, listMics, type MicList } from '../utils/micDevices';
import { SessionRecorder } from '../utils/sessionRecorder';
import { noteDirOf, toAssetUrl } from '../utils/assetUrl';
import { useAppStore } from './appStore';
import {
  type TranscriptSegment, transcriptText, buildTranscriptBlock, upsertBlock, insertMinutes, newMeetingNote, meetingNoteTitle,
  stripTranscriptBlocks, splitForSummary, recordingFileName, buildMinutesMessages, buildPartMessages, buildMergeMessages, cleanMinutes,
} from '../utils/transcript';
import { stripThinking } from '../utils/askNotes';

export type TranscribeStatus = 'idle' | 'starting' | 'recording' | 'stopping';

interface TranscribeState {
  asr: AsrState | null;
  status: TranscribeStatus;
  segments: TranscriptSegment[];
  /** 正在说的这一句（还会变） */
  partial: TranscriptSegment | null;
  /** 第一次按下开始的时刻；中途停了再继续，仍算同一场 */
  startedAt: number | null;
  /** 之前几段录音累计的时长（秒）：继续转写时，时间戳接着往下排 */
  offset: number;
  /** 本段录音开始的时刻（毫秒），用来算已经录了多久 */
  runStartedAt: number | null;
  level: number;
  /** 用户选的麦克风（空串 = 跟随系统）和当前能看到的设备 */
  micId: string;
  mics: MicList;
  /** 留不留录音（用于回听）。存在本机的偏好；一场转写开始时定下来，中途改不影响这一场 */
  keepRecording: boolean;
  /** 这一场的录音：停下来之后才有。url 给面板里的播放器用；blob 为空 = 上次没保存、这次启动找回来的（文件在应用数据目录里） */
  audio: { blob: Blob | null; url: string; duration: number } | null;
  /** 这一场是上次退出前没放进笔记、这次启动找回来的 */
  restored: boolean;
  /** 这次运行里真的从麦克风收到过声音：有这个事实在，就不管系统 API 怎么说授权状态 */
  heardSignal: boolean;
  /** 这次录音实际在用的麦克风 */
  deviceLabel: string;
  /** 连续几秒一点信号都没有（不是「没人说话」，是数字静音）：多半是麦克风被静音了，或者选错了设备 */
  silent: boolean;
  error: string | null;
  /** 转写已经写进了哪篇笔记（生成纪要时往那里放） */
  savedTo: string | null;
  /** 上次放进笔记时有多少句：之后又多出来的就是「还没保存的」 */
  savedCount: number;
  /** 这一场有没有在留录音 */
  recordingOn: boolean;
  minutes: { running: boolean; progress: string; error: string | null };

  refresh: () => Promise<void>;
  refreshMics: () => Promise<void>;
  setMic: (id: string) => void;
  setKeepRecording: (keep: boolean) => void;
  install: () => void;
  cancelInstall: () => void;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  clear: () => void;
  elapsed: () => number;
  insertIntoActiveNote: () => Promise<boolean>;
  saveAsNewNote: () => Promise<string | null>;
  generateMinutes: () => Promise<void>;
}

const cleanError = (err: any) => String(err?.message || err).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');

let capture: MicCapture | null = null;
let recorder: SessionRecorder | null = null;

const KEEP_KEY = 'iml.keepRecording';
/** 默认留录音：想回听是常态；不想留的在「实时转写…」里关掉 */
function readKeepRecording(): boolean { try { return localStorage.getItem(KEEP_KEY) !== '0'; } catch { return true; } }

/** 一段录音停下来：从录音机那里拿到目前为止的整份录音，换掉面板播放器用的那一份 */
async function collectRecording() {
  if (!recorder) return;
  const wasFailed = recorder.failed;
  const recording = await recorder.detach().catch(() => null);
  if (recorder.failed && !wasFailed) useAppStore.getState().notify('录音中途断了，后面的部分没有录上（转写不受影响）');
  if (!recording) return;
  const old = useTranscribeStore.getState().audio;
  if (old?.blob) URL.revokeObjectURL(old.url);
  useTranscribeStore.setState({ audio: { blob: recording.blob, url: URL.createObjectURL(recording.blob), duration: recording.durationSec } });
  // 落一份到应用数据目录：还没放进笔记就退出了，下次打开还能找回来
  try { await window.api.asr.saveDraftAudio(await recording.blob.arrayBuffer()); } catch (err) { console.warn('[transcribe] 录音草稿没存上：', err); }
}

/** 把录音存到笔记旁边，返回写进转写块里的相对地址；没有录音、或存不了，返回 null（转写照样放进笔记） */
async function saveRecording(noteDir: string | null, startedAt: Date): Promise<string | null> {
  const audio = useTranscribeStore.getState().audio;
  if (!audio) return null;
  if (!noteDir) { useAppStore.getState().notify('这篇笔记还没有保存位置，录音没能跟着放进去'); return null; }
  try {
    const res = audio.blob
      ? await window.api.fs.saveRecording(noteDir, recordingFileName(startedAt), await audio.blob.arrayBuffer())
      : await window.api.asr.copyDraftAudio(noteDir, recordingFileName(startedAt));
    if (res.success && res.path) return res.path;
    useAppStore.getState().notify(`录音没存上：${res.error || '未知错误'}`);
  } catch (err) {
    useAppStore.getState().notify(`录音没存上：${cleanError(err)}`);
  }
  return null;
}

const SILENCE_MS = 4000;
/** 整理纪要是「照着材料写」：温度压低，本机小模型才不会自由发挥 */
const MINUTES_TEMPERATURE = 0.2;

/**
 * 实时转写的状态。放在独立的 store 里而不是面板组件里：侧边栏切到别的页、甚至收起来，录音都不能断。
 */
export const useTranscribeStore = create<TranscribeState>((set, get) => ({
  asr: null,
  status: 'idle',
  segments: [],
  partial: null,
  startedAt: null,
  offset: 0,
  runStartedAt: null,
  level: 0,
  micId: getPreferredMic(),
  mics: { systemDefault: '', mics: [], labelsAvailable: false },
  keepRecording: readKeepRecording(),
  audio: null,
  restored: false,
  heardSignal: false,
  deviceLabel: '',
  silent: false,
  error: null,
  savedTo: null,
  savedCount: 0,
  recordingOn: false,
  minutes: { running: false, progress: '', error: null },

  refresh: async () => { try { set({ asr: await window.api.asr.getState() }); } catch { /* 主进程还没准备好 */ } },
  refreshMics: async () => set({ mics: await listMics() }),
  setMic: (id) => { setPreferredMic(id); set({ micId: id }); },
  setKeepRecording: (keep) => { try { localStorage.setItem(KEEP_KEY, keep ? '1' : '0'); } catch { /* 存不了就只管这一次 */ } set({ keepRecording: keep }); },
  install: () => { void window.api.asr.install(); },
  cancelInstall: () => { void window.api.asr.cancelInstall(); },

  elapsed: () => { const { offset, runStartedAt } = get(); return offset + (runStartedAt ? (Date.now() - runStartedAt) / 1000 : 0); },

  start: async () => {
    if (get().status !== 'idle') return;
    set({ status: 'starting', error: null });
    try {
      await window.api.asr.start();                       // 识别进程就绪（含 macOS 的麦克风授权）
      let lastSignalAt = Date.now();
      capture = await startMicCapture((samples, level) => {
        window.api.asr.sendPcm(samples);
        if (Math.abs(level - get().level) > 0.04) set({ level });
        // 再安静的房间也有底噪；电平贴着 0 超过几秒，说明根本没有声音进来
        if (level > MIC_SILENCE_LEVEL) { lastSignalAt = Date.now(); if (!get().heardSignal) set({ heardSignal: true }); }
        const silent = Date.now() - lastSignalAt > SILENCE_MS;
        if (silent !== get().silent) set({ silent });
      }, get().micId);
      // 留不留录音在一场开始时定：中途变卦的话录音和时间戳就对不上了
      if (get().segments.length === 0 && !recorder && get().keepRecording && SessionRecorder.supported()) recorder = new SessionRecorder();
      recorder?.attach(capture.stream);
      set({ recordingOn: !!recorder && !recorder.failed });
      if (capture.fellBack) useAppStore.getState().notify(`选定的麦克风没连上，这次改用${capture.label ? `「${capture.label}」` : '系统默认的麦克风'}`);
      void get().refreshMics();   // 授权之后才读得到设备名字
      if (get().segments.length === 0) void window.api.asr.clearDraft?.().catch(() => {});   // 新的一场：上一场留下的录音草稿不要了
      set((s) => ({ status: 'recording', deviceLabel: capture?.label ?? '', silent: false, runStartedAt: Date.now(), startedAt: s.startedAt ?? Date.now(), savedTo: s.segments.length ? s.savedTo : null }));
    } catch (err) {
      capture?.stop(); capture = null;
      await window.api.asr.stop().catch(() => {});
      set({ status: 'idle', runStartedAt: null, error: cleanError(err) });
    }
  },

  stop: async () => {
    if (get().status !== 'recording') return;
    set({ status: 'stopping' });
    const recording = collectRecording();   // 先让录音机暂停，再放开麦克风
    capture?.stop(); capture = null;
    const ran = get().runStartedAt ? (Date.now() - get().runStartedAt!) / 1000 : 0;
    try { await window.api.asr.stop(); } catch { /* 进程已经没了也算停了 */ }
    await recording;
    // 最后一句的定稿在 stop 返回之前已经送到；还挂着的临时文字说明那句没来得及定稿，保住它
    set((s) => ({
      status: 'idle', level: 0, silent: false, runStartedAt: null, offset: s.offset + ran,
      segments: s.partial?.text ? [...s.segments, s.partial] : s.segments, partial: null,
    }));
  },

  clear: () => {
    if (get().status !== 'idle') return;
    recorder?.dispose(); recorder = null;
    const old = get().audio;
    if (old?.blob) URL.revokeObjectURL(old.url);
    void window.api.asr.clearDraft?.().catch(() => {});
    set({ audio: null, restored: false, savedCount: 0, recordingOn: false, segments: [], partial: null, startedAt: null, offset: 0, error: null, savedTo: null, minutes: { running: false, progress: '', error: null } });
  },

  insertIntoActiveNote: async () => {
    const { segments, startedAt } = get();
    const app = useAppStore.getState();
    const tab = app.tabs.find((t) => t.id === app.activeTabId);
    if (!tab || segments.length === 0) return false;
    const at = new Date(startedAt ?? Date.now());
    // 录音跟着笔记走：存到笔记旁边的 assets/，转写块里带一个播放器
    const audioSrc = await saveRecording(noteDirOf(tab.id, app.getNewNoteDir() || ''), at);
    const block = buildTranscriptBlock(segments, at, get().elapsed(), audioSrc);
    // 用户多半正在这篇里记要点：editTabContent 会先把他没写回的字刷进来，再追加，光标也留在原地
    if (!app.editTabContent(tab.id, (current) => upsertBlock(current, block, at))) return false;
    set({ savedTo: tab.id, savedCount: segments.length, restored: false });
    app.notify(`转写已写进「${tab.title}」的末尾`);
    return true;
  },

  saveAsNewNote: async () => {
    const { segments, startedAt } = get();
    if (segments.length === 0) return null;
    const app = useAppStore.getState();
    const at = new Date(startedAt ?? Date.now());
    const title = meetingNoteTitle(at);
    const dir = app.getNewNoteDir();
    if (!dir) { set({ error: '还没有打开笔记库，不知道存到哪里' }); return null; }
    const sep = dir.includes('\\') ? '\\' : '/';
    let filePath = `${dir}${sep}${title}.md`;
    for (let i = 2; await window.api.fs.exists(filePath); i++) filePath = `${dir}${sep}${title} ${i}.md`;
    const audioSrc = await saveRecording(dir, at);
    const res = await window.api.fs.writeFile(filePath, newMeetingNote(title, at, buildTranscriptBlock(segments, at, get().elapsed(), audioSrc)));
    if (!res.success) { set({ error: res.error || '保存失败' }); return null; }
    await app.refreshWorkspace();
    await app.openFileByPath(filePath);
    set({ savedTo: filePath, savedCount: segments.length, restored: false });
    return filePath;
  },

  generateMinutes: async () => {
    const { segments, minutes } = get();
    if (minutes.running || segments.length === 0) return;
    const app = useAppStore.getState();
    // 纪要写进存了转写的那篇；还没存过就写进当前打开的这篇
    const target = app.tabs.find((t) => t.id === get().savedTo) ?? app.tabs.find((t) => t.id === app.activeTabId);
    if (!target) { set({ minutes: { running: false, progress: '', error: '先把转写存成笔记（或打开一篇笔记），纪要要有地方放' } }); return; }

    const ask = async (messages: { role: string; content: string }[], tag: string) =>
      stripThinking(await window.api.ai.chat(messages, () => {}, `minutes-${Date.now()}-${tag}`, 1500, MINUTES_TEMPERATURE));

    set({ minutes: { running: true, progress: '正在整理纪要…', error: null } });
    try {
      const userNotes = stripTranscriptBlocks(target.content);
      const parts = splitForSummary(transcriptText(segments));
      let result: string;
      if (parts.length <= 1) {
        result = await ask(buildMinutesMessages(userNotes, parts[0] ?? ''), 'all');
      } else {
        // 长会议：逐段提炼再合并，每一步都告诉用户进行到哪了
        const summaries: string[] = [];
        for (let i = 0; i < parts.length; i++) {
          set({ minutes: { running: true, progress: `正在提炼第 ${i + 1} / ${parts.length} 段…`, error: null } });
          summaries.push(await ask(buildPartMessages(parts[i], i, parts.length), `p${i}`));
        }
        set({ minutes: { running: true, progress: '正在合并成一份纪要…', error: null } });
        result = await ask(buildMergeMessages(userNotes, summaries), 'merge');
      }
      result = cleanMinutes(result);
      if (!result) throw new Error('模型没有返回内容');
      // 写作助手正往正文里流式写字时先等它写完，两边同时改同一篇会互相覆盖
      while (useAppStore.getState().aiStatus.generating) await new Promise((r) => setTimeout(r, 300));
      // 生成期间用户可能又改了笔记：基于最新内容插入，别把他刚写的覆盖掉
      if (!useAppStore.getState().editTabContent(target.id, (current) => insertMinutes(current, result))) throw new Error('那篇笔记已经关掉了，纪要没地方放');
      useAppStore.getState().notify(`纪要已写进「${target.title}」`);
      set({ minutes: { running: false, progress: '', error: null } });
    } catch (err) {
      const message = cleanError(err);
      set({ minutes: { running: false, progress: '', error: message === 'REQUEST_ABORTED' ? null : message } });
    }
  },
}));

/** 有没有还没放进笔记的转写：放进去之后又录了新的，也算 */
export const hasUnsavedTranscript = (s: Pick<TranscribeState, 'segments' | 'savedCount'>) => s.segments.length > 0 && s.segments.length !== s.savedCount;

// ── 没放进笔记的转写先替用户留着 ─────────────────────────────────────────────
// 文字存 localStorage（每定稿一句就存，崩溃也丢不了几个字），录音每次停下来时由主进程落盘。
// 放进笔记之后草稿就删掉：下次启动不该再冒出一份已经保存过的转写
const DRAFT_KEY = 'iml.transcribe.draft';
interface Draft { segments: TranscriptSegment[]; startedAt: number | null; offset: number; savedTo: string | null; savedCount: number; audioDuration: number }

function persistDraft(s: TranscribeState) {
  try {
    if (!hasUnsavedTranscript(s)) { localStorage.removeItem(DRAFT_KEY); return; }
    // 正在录的这一段还没计入 offset：按已经过去的时间算上，找回来之后「继续」时间戳才接得上
    const draft: Draft = { segments: s.segments, startedAt: s.startedAt, offset: s.elapsed(), savedTo: s.savedTo, savedCount: s.savedCount, audioDuration: s.audio?.duration ?? 0 };
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch { /* 存不下（极长的会议撑满了配额）就算了，界面上的提醒还在 */ }
}

async function restoreDraft() {
  let draft: Draft | null = null;
  try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { /* 坏了就当没有 */ }
  if (!draft || !Array.isArray(draft.segments) || draft.segments.length === 0) {
    void window.api.asr.clearDraft?.().catch(() => {});   // 没有文字草稿，留着的录音也没用了
    return;
  }
  useTranscribeStore.setState({
    segments: draft.segments, startedAt: draft.startedAt, offset: Math.max(draft.offset || 0, draft.segments[draft.segments.length - 1].start + 1),
    savedTo: draft.savedTo ?? null, savedCount: draft.savedCount || 0, restored: true,
  });
  const file = await window.api.asr.getDraftAudio?.().catch(() => null);
  if (file && draft.audioDuration > 0 && useTranscribeStore.getState().restored) {
    useTranscribeStore.setState({ audio: { blob: null, url: toAssetUrl(file.path), duration: draft.audioDuration } });
  }
}

if (typeof window !== 'undefined' && window.api?.asr) {
  void restoreDraft().finally(() => {
    let last = '';
    useTranscribeStore.subscribe((s) => {
      const key = `${s.segments.length}|${s.savedCount}|${s.savedTo}|${s.offset}|${s.audio?.duration ?? 0}`;
      if (key !== last) { last = key; persistDraft(s); }
    });
  });
}

// 正在转写时退出 / 关窗口，主进程要拦一下：停下来的部分下次打开还在，正在录的这一段会丢
if (typeof window !== 'undefined' && window.api?.asr?.setUnsaved) {
  let reported = '';
  useTranscribeStore.subscribe((s) => {
    const state = s.status === 'recording' ? { recording: s.recordingOn } : null;
    const key = JSON.stringify(state);
    if (key !== reported) { reported = key; window.api.asr.setUnsaved(state); }
  });
}

// 插拔耳机 / 麦克风时更新设备列表
if (typeof navigator !== 'undefined' && navigator.mediaDevices?.addEventListener) {
  navigator.mediaDevices.addEventListener('devicechange', () => { void useTranscribeStore.getState().refreshMics(); });
}

// 主进程推来的状态与识别结果。模块加载时订阅一次：录音期间面板可能根本没挂载
if (typeof window !== 'undefined' && window.api?.asr) {
  window.api.asr.onState((asr) => useTranscribeStore.setState({ asr }));
  window.api.asr.onEvent((event: AsrEvent) => {
    const s = useTranscribeStore.getState();
    if (event.type === 'partial') useTranscribeStore.setState({ partial: { start: s.offset + event.start, text: event.text } });
    else if (event.type === 'final') useTranscribeStore.setState({ segments: [...s.segments, { start: s.offset + event.start, text: event.text }], partial: null });
    else if (event.type === 'error') {
      void collectRecording();
      capture?.stop(); capture = null;
      useTranscribeStore.setState({ status: 'idle', runStartedAt: null, level: 0, silent: false, error: event.message });
    }
  });
}
