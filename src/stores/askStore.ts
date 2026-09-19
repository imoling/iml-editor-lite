import { create } from 'zustand';
import type { AskSource } from '../types/window';
import { buildAskMessages, retrievalQuery, stripThinking, type AskExchange } from '../utils/askNotes';

export type AskStatus = 'retrieving' | 'answering' | 'done' | 'stopped' | 'error';

export interface AskTurn {
  id: string;
  question: string;
  /** 检索到的原文片段；答案里的 [1] 指的是 sources[0] */
  sources: AskSource[];
  answer: string;
  status: AskStatus;
  error?: string;
}

interface AskState {
  turns: AskTurn[];
  /** 递增一次，输入框就抢一次焦点（⌘J） */
  focusToken: number;
  ask: (question: string) => Promise<void>;
  stop: () => void;
  clear: () => void;
  requestFocus: () => void;
}

const cleanError = (err: any) => String(err?.message || err).replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '');

/**
 * 「问你的笔记」的对话状态。放在独立的 store 里：侧边栏切到别的页再切回来，对话还在；
 * 不落盘 —— 这是随手问的东西，重启就清空。
 */
export const useAskStore = create<AskState>((set, get) => {
  const patch = (id: string, change: Partial<AskTurn> | ((t: AskTurn) => Partial<AskTurn>)) =>
    set((s) => ({ turns: s.turns.map((t) => (t.id === id ? { ...t, ...(typeof change === 'function' ? change(t) : change) } : t)) }));

  return {
    turns: [],
    focusToken: 0,
    requestFocus: () => set((s) => ({ focusToken: s.focusToken + 1 })),

    clear: () => { get().stop(); set({ turns: [] }); },

    stop: () => {
      const running = get().turns.find((t) => t.status === 'retrieving' || t.status === 'answering');
      if (!running) return;
      window.api.ai.stop(running.id);
      patch(running.id, { status: 'stopped' });
    },

    ask: async (raw) => {
      const question = raw.trim();
      if (!question || get().turns.some((t) => t.status === 'retrieving' || t.status === 'answering')) return;
      const history: AskExchange[] = get().turns.filter((t) => t.status === 'done' || t.status === 'stopped').map((t) => ({ question: t.question, answer: t.answer }));
      const id = `ask-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      set((s) => ({ turns: [...s.turns, { id, question, sources: [], answer: '', status: 'retrieving' }] }));
      const alive = () => get().turns.find((t) => t.id === id)?.status;

      try {
        const sources = await window.api.semantic.retrieve(retrievalQuery(question, history), 8);
        if (alive() !== 'retrieving') return;   // 检索期间被停止或清空了
        // 一块相关的都没找到：不去问模型 —— 没有依据的问题，小模型只会编
        if (sources.length === 0) { patch(id, { status: 'done', sources: [] }); return; }
        patch(id, { sources, status: 'answering' });

        let full = '';
        await window.api.ai.chat(buildAskMessages(question, sources, history), (chunk) => {
          full += chunk;
          if (alive() === 'answering') patch(id, { answer: stripThinking(full) });
        }, id, 1024);
        if (alive() === 'answering') patch(id, { status: 'done', answer: stripThinking(full) });
      } catch (err: any) {
        const message = cleanError(err);
        if (message === 'REQUEST_ABORTED') { if (alive() !== 'stopped') patch(id, { status: 'stopped' }); return; }
        if (alive()) patch(id, { status: 'error', error: message });
      }
    },
  };
});
