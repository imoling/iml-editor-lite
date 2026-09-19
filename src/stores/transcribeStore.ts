import { create } from 'zustand';
import type { AsrState, AsrEvent } from '../types/window';
import { startMicCapture, type MicCapture } from '../utils/micCapture';
import { useAppStore } from './appStore';
import {
  type TranscriptSegment, transcriptText, buildTranscriptBlock, appendBlock, insertMinutes, newMeetingNote, meetingNoteTitle,
  stripTranscriptBlocks, splitForSummary, buildMinutesMessages, buildPartMessages, buildMergeMessages, cleanMinutes,
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
  error: string | null;
  /** 转写已经写进了哪篇笔记（生成纪要时往那里放） */
  savedTo: string | null;
  minutes: { running: boolean; progress: string; error: string | null };

  refresh: () => Promise<void>;
  install: () => void;
  cancelInstall: () => void;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  clear: () => void;
  elapsed: () => number;
  insertIntoActiveNote: () => boolean;
  saveAsNewNote: () => Promise<string | null>;
  generateMinutes: () => Promise<void>;
}

const cleanError = (err: any) => String(err?.message || err).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');

let capture: MicCapture | null = null;

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
  error: null,
  savedTo: null,
  minutes: { running: false, progress: '', error: null },

  refresh: async () => { try { set({ asr: await window.api.asr.getState() }); } catch { /* 主进程还没准备好 */ } },
  install: () => { void window.api.asr.install(); },
  cancelInstall: () => { void window.api.asr.cancelInstall(); },

  elapsed: () => { const { offset, runStartedAt } = get(); return offset + (runStartedAt ? (Date.now() - runStartedAt) / 1000 : 0); },

  start: async () => {
    if (get().status !== 'idle') return;
    set({ status: 'starting', error: null });
    try {
      await window.api.asr.start();                       // 识别进程就绪（含 macOS 的麦克风授权）
      capture = await startMicCapture((samples, level) => {
        window.api.asr.sendPcm(samples);
        if (Math.abs(level - get().level) > 0.04) set({ level });
      });
      set((s) => ({ status: 'recording', runStartedAt: Date.now(), startedAt: s.startedAt ?? Date.now(), savedTo: s.segments.length ? s.savedTo : null }));
    } catch (err) {
      capture?.stop(); capture = null;
      await window.api.asr.stop().catch(() => {});
      set({ status: 'idle', runStartedAt: null, error: cleanError(err) });
    }
  },

  stop: async () => {
    if (get().status !== 'recording') return;
    set({ status: 'stopping' });
    capture?.stop(); capture = null;
    const ran = get().runStartedAt ? (Date.now() - get().runStartedAt!) / 1000 : 0;
    try { await window.api.asr.stop(); } catch { /* 进程已经没了也算停了 */ }
    // 最后一句的定稿在 stop 返回之前已经送到；还挂着的临时文字说明那句没来得及定稿，保住它
    set((s) => ({
      status: 'idle', level: 0, runStartedAt: null, offset: s.offset + ran,
      segments: s.partial?.text ? [...s.segments, s.partial] : s.segments, partial: null,
    }));
  },

  clear: () => { if (get().status === 'idle') set({ segments: [], partial: null, startedAt: null, offset: 0, error: null, savedTo: null, minutes: { running: false, progress: '', error: null } }); },

  insertIntoActiveNote: () => {
    const { segments, startedAt } = get();
    const app = useAppStore.getState();
    const tab = app.tabs.find((t) => t.id === app.activeTabId);
    if (!tab || segments.length === 0) return false;
    const block = buildTranscriptBlock(segments, new Date(startedAt ?? Date.now()), get().elapsed());
    // 用户多半正在这篇里记要点：editTabContent 会先把他没写回的字刷进来，再追加，光标也留在原地
    if (!app.editTabContent(tab.id, (current) => appendBlock(current, block))) return false;
    set({ savedTo: tab.id });
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
    const res = await window.api.fs.writeFile(filePath, newMeetingNote(title, at, buildTranscriptBlock(segments, at, get().elapsed())));
    if (!res.success) { set({ error: res.error || '保存失败' }); return null; }
    await app.refreshWorkspace();
    await app.openFileByPath(filePath);
    set({ savedTo: filePath });
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
      stripThinking(await window.api.ai.chat(messages, () => {}, `minutes-${Date.now()}-${tag}`, 1500));

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

// 主进程推来的状态与识别结果。模块加载时订阅一次：录音期间面板可能根本没挂载
if (typeof window !== 'undefined' && window.api?.asr) {
  window.api.asr.onState((asr) => useTranscribeStore.setState({ asr }));
  window.api.asr.onEvent((event: AsrEvent) => {
    const s = useTranscribeStore.getState();
    if (event.type === 'partial') useTranscribeStore.setState({ partial: { start: s.offset + event.start, text: event.text } });
    else if (event.type === 'final') useTranscribeStore.setState({ segments: [...s.segments, { start: s.offset + event.start, text: event.text }], partial: null });
    else if (event.type === 'error') {
      capture?.stop(); capture = null;
      useTranscribeStore.setState({ status: 'idle', runStartedAt: null, level: 0, error: event.message });
    }
  });
}
