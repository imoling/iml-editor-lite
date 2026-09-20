import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createMockApi } from '../test/setup';

const DRAFT_KEY = 'iml.transcribe.draft';
const flush = () => new Promise((r) => setTimeout(r, 0));

/** 转写的 store 在模块加载时就会去找草稿，所以每个用例都重新加载一遍模块 */
async function loadStore(api = createMockApi()) {
  (window as any).api = api;
  vi.resetModules();
  const mod = await import('./transcribeStore');
  await flush(); await flush();
  return { ...mod, api };
}

describe('没放进笔记的转写：退出后还能找回来', () => {
  beforeEach(() => localStorage.clear());

  it('启动时把上次的文字和录音找回来；录音走应用数据目录里的文件', async () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ segments: [{ start: 0, text: '大家好' }, { start: 41, text: '下周三之前给结论' }], startedAt: 1_789_000_000_000, offset: 57, savedTo: null, savedCount: 0, audioDuration: 57 }));
    const api = createMockApi();
    (api.asr as any).getDraftAudio = vi.fn(async () => ({ path: '/data/transcribe-draft/recording.webm', bytes: 1000 }));
    const { useTranscribeStore, hasUnsavedTranscript } = await loadStore(api);
    const s = useTranscribeStore.getState();
    expect(s.segments).toHaveLength(2);
    expect(s).toMatchObject({ restored: true, offset: 57, status: 'idle', startedAt: 1_789_000_000_000 });
    expect(s.audio).toMatchObject({ blob: null, duration: 57 });
    expect(s.audio!.url).toBe(`iml-asset://local/${encodeURIComponent('/data/transcribe-draft/recording.webm')}`);
    expect(hasUnsavedTranscript(s)).toBe(true);
  });

  it('退出时正在录、那一段没来得及计入时长：找回来之后时间戳仍然接在最后一句后面', async () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ segments: [{ start: 0, text: '第一句' }, { start: 95, text: '最后一句' }], startedAt: 1, offset: 30, savedTo: null, savedCount: 0, audioDuration: 0 }));
    const { useTranscribeStore } = await loadStore();
    expect(useTranscribeStore.getState().offset).toBeGreaterThan(95);
    expect(useTranscribeStore.getState().audio).toBeNull();
  });

  it('每定稿一句就存一次；放进笔记之后草稿删掉，下次启动不会再冒出来', async () => {
    const { useTranscribeStore } = await loadStore();
    useTranscribeStore.setState({ segments: [{ start: 0, text: '第一句' }], startedAt: 5 });
    expect(JSON.parse(localStorage.getItem(DRAFT_KEY)!)).toMatchObject({ segments: [{ start: 0, text: '第一句' }], savedCount: 0 });
    useTranscribeStore.setState({ segments: [{ start: 0, text: '第一句' }, { start: 3, text: '第二句' }] });
    expect(JSON.parse(localStorage.getItem(DRAFT_KEY)!).segments).toHaveLength(2);
    useTranscribeStore.setState({ savedTo: '/lib/a.md', savedCount: 2 });
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('没有文字草稿：留着的录音也没用了，清掉；坏掉的草稿当作没有', async () => {
    localStorage.setItem(DRAFT_KEY, '{不是 JSON');
    const { useTranscribeStore, api } = await loadStore();
    expect(useTranscribeStore.getState().segments).toEqual([]);
    expect(api.asr.clearDraft).toHaveBeenCalled();
  });

  it('清空：文字草稿和录音草稿一起删', async () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ segments: [{ start: 0, text: '大家好' }], startedAt: 1, offset: 5, savedTo: null, savedCount: 0, audioDuration: 0 }));
    const { useTranscribeStore, api } = await loadStore();
    (api.asr.clearDraft as any).mockClear();
    useTranscribeStore.getState().clear();
    expect(useTranscribeStore.getState()).toMatchObject({ segments: [], restored: false, audio: null });
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
    expect(api.asr.clearDraft).toHaveBeenCalled();
  });

  it('找回来的录音放进笔记：由主进程直接拷文件，不经过渲染进程的内存', async () => {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ segments: [{ start: 0, text: '大家好' }], startedAt: new Date(2026, 8, 20, 14, 5, 0).getTime(), offset: 5, savedTo: null, savedCount: 0, audioDuration: 5 }));
    const api = createMockApi({ '/lib/a.md': '# 周会' });
    (api.asr as any).getDraftAudio = vi.fn(async () => ({ path: '/data/transcribe-draft/recording.webm', bytes: 1000 }));
    const { useTranscribeStore } = await loadStore(api);
    const { useAppStore } = await import('./appStore');
    useAppStore.setState({ tabs: [{ id: '/lib/a.md', title: 'a.md', content: '# 周会', isDirty: false, mode: 'word' }], activeTabId: '/lib/a.md' });
    expect(await useTranscribeStore.getState().insertIntoActiveNote()).toBe(true);
    expect(api.asr.copyDraftAudio).toHaveBeenCalledWith('/lib', '录音-20260920-140500.webm');
    expect(api.fs.saveRecording).not.toHaveBeenCalled();
    expect(useAppStore.getState().tabs[0].content).toContain('<audio controls preload="metadata" src="assets/rec.webm"></audio>');
    expect(useTranscribeStore.getState()).toMatchObject({ savedCount: 1, restored: false });
    expect(localStorage.getItem(DRAFT_KEY)).toBeNull();
  });

  it('区分说话人：带声纹的定稿会标上是谁说的；改名 / 合并之后句子跟着走，笔记里那份算过时；草稿里带着说话人', async () => {
    const fixture = (await import('../utils/__fixtures__/speakerEmbeddings.json')).default as { who: string; dur: number; emb: number[] }[];
    const api = createMockApi({ '/lib/a.md': '# 周会' });
    let emit: (e: any) => void = () => {};
    (api.asr as any).onEvent = vi.fn((cb: (e: any) => void) => { emit = cb; return () => {}; });
    const { useTranscribeStore, hasUnsavedTranscript } = await loadStore(api);
    const long = (who: string) => fixture.filter((u) => u.who === who && u.dur > 3);
    const say = (u: { dur: number; emb: number[] }, text: string, start: number) => emit({ type: 'final', text, start, duration: u.dur, decodeMs: 1, embedding: u.emb });

    say(long('A')[0], '开始吧。', 0); say(long('B')[0], '我这边提测了。', 6); say(long('A')[1], '好，下周三给结论。', 12);
    emit({ type: 'final', text: '没开区分说话人时的句子', start: 20, duration: 3, decodeMs: 1 });
    let s = useTranscribeStore.getState();
    expect(s.segments.map((x) => x.speaker)).toEqual(['s1', 's2', 's1', undefined]);
    expect(s.speakers.map((p) => p.name)).toEqual(['说话人 1', '说话人 2']);

    const { useAppStore } = await import('./appStore');
    useAppStore.setState({ tabs: [{ id: '/lib/a.md', title: 'a.md', content: '# 周会', isDirty: false, mode: 'word' }], activeTabId: '/lib/a.md' });
    await s.insertIntoActiveNote();
    expect(useAppStore.getState().tabs[0].content).toContain('<p>[00:06] 说话人 2：我这边提测了。</p>');
    expect(hasUnsavedTranscript(useTranscribeStore.getState())).toBe(false);

    useTranscribeStore.getState().renameSpeaker('s2', '老王');
    expect(hasUnsavedTranscript(useTranscribeStore.getState())).toBe(true);        // 笔记里还写着「说话人 2」
    expect(JSON.parse(localStorage.getItem(DRAFT_KEY)!).speakers.map((p: any) => p.name)).toEqual(['说话人 1', '老王']);
    await useTranscribeStore.getState().insertIntoActiveNote();
    expect(useAppStore.getState().tabs[0].content).toContain('<p>[00:06] 老王：我这边提测了。</p>');
    expect(useAppStore.getState().tabs[0].content.match(/<details data-iml-transcript>/g)).toHaveLength(1);

    useTranscribeStore.getState().renameSpeaker('s1', '老王');                     // 其实是同一个人：合并
    s = useTranscribeStore.getState();
    expect(s.speakers.map((p) => p.id)).toEqual(['s2']);
    expect(s.segments.map((x) => x.speaker)).toEqual(['s2', 's2', 's2', undefined]);
  });
});

