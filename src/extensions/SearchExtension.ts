import { Extension } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorState, Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

export interface SearchMatch {
  from: number;
  to: number;
}

export interface SearchPluginState {
  query: string;
  caseSensitive: boolean;
  matches: SearchMatch[];
  /** 当前匹配下标，-1 表示无 */
  current: number;
  /** 高亮装饰集，随 matches / current 一起在 apply 中构建，避免每次视图更新重建 */
  decorations: DecorationSet;
}

interface SearchMeta {
  query?: string;
  caseSensitive?: boolean;
  /** 命令里已经算好的匹配列表，apply 直接复用，省掉一次全文扫描 */
  matches?: SearchMatch[];
  current?: number;
}

export const searchPluginKey = new PluginKey<SearchPluginState>('imlSearch');

/**
 * 逐个文本块扫描匹配。行内叶子节点（图片等）按 1 个占位符计，
 * 这样字符串偏移量与 ProseMirror 文档位置一一对应，跨加粗/链接等标记边界的匹配也能命中。
 * 个别 Unicode 字符小写化后长度会变（如 İ），此时该块退回区分大小写匹配，保证偏移不漂移。
 */
export function findMatches(doc: PMNode, query: string, caseSensitive: boolean): SearchMatch[] {
  const matches: SearchMatch[] = [];
  if (!query) return matches;
  const lowered = query.toLowerCase();
  // 只有在需要忽略大小写、且小写化不改变长度时才折叠；否则按原文精确匹配
  const foldCase = !caseSensitive && lowered.length === query.length;
  const needle = foldCase ? lowered : query;
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    const raw = node.textBetween(0, node.content.size, undefined, '￼');
    let text = raw;
    if (foldCase) {
      const folded = raw.toLowerCase();
      text = folded.length === raw.length ? folded : raw;
    }
    let idx = text.indexOf(needle);
    while (idx !== -1) {
      matches.push({ from: pos + 1 + idx, to: pos + 1 + idx + needle.length });
      idx = text.indexOf(needle, idx + needle.length);
    }
    return false;
  });
  return matches;
}

function buildDecorations(doc: PMNode, matches: SearchMatch[], current: number): DecorationSet {
  if (matches.length === 0) return DecorationSet.empty;
  return DecorationSet.create(
    doc,
    matches.map((m, i) =>
      Decoration.inline(m.from, m.to, {
        class: i === current ? 'search-match search-match-current' : 'search-match',
      }),
    ),
  );
}

function selectMatch(tr: Transaction, match: SearchMatch) {
  tr.setSelection(TextSelection.create(tr.doc, match.from, match.to)).scrollIntoView();
}

/** 从光标位置起，向后找最近的匹配作为当前项 */
function nearestIndex(matches: SearchMatch[], from: number): number {
  if (matches.length === 0) return -1;
  const idx = matches.findIndex((m) => m.from >= from);
  return idx === -1 ? 0 : idx;
}

function step(
  state: EditorState,
  tr: Transaction,
  dispatch: ((tr: Transaction) => void) | undefined,
  dir: 1 | -1,
): boolean {
  const ps = searchPluginKey.getState(state);
  if (!ps || ps.matches.length === 0) return false;
  const len = ps.matches.length;
  const current = ps.current < 0
    ? nearestIndex(ps.matches, state.selection.from)
    : (ps.current + dir + len) % len;
  if (dispatch) {
    selectMatch(tr, ps.matches[current]);
    tr.setMeta(searchPluginKey, { matches: ps.matches, current } satisfies SearchMeta);
  }
  return true;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    imlSearch: {
      /** 设置查找词；空字符串即清除高亮 */
      setSearchTerm: (query: string, caseSensitive: boolean) => ReturnType;
      findNext: () => ReturnType;
      findPrev: () => ReturnType;
      /** 替换当前匹配并跳到下一个 */
      replaceCurrentMatch: (replacement: string) => ReturnType;
      replaceAllMatches: (replacement: string) => ReturnType;
    };
  }
}

export const SearchExtension = Extension.create({
  name: 'imlSearch',

  addCommands() {
    return {
      setSearchTerm:
        (query, caseSensitive) =>
        ({ state, tr, dispatch }) => {
          const matches = findMatches(state.doc, query, caseSensitive);
          const current = nearestIndex(matches, state.selection.from);
          if (dispatch) {
            if (current >= 0) selectMatch(tr, matches[current]);
            tr.setMeta(searchPluginKey, { query, caseSensitive, matches, current } satisfies SearchMeta);
          }
          return true;
        },
      findNext:
        () =>
        ({ state, tr, dispatch }) =>
          step(state, tr, dispatch, 1),
      findPrev:
        () =>
        ({ state, tr, dispatch }) =>
          step(state, tr, dispatch, -1),
      replaceCurrentMatch:
        (replacement) =>
        ({ state, tr, dispatch }) => {
          const ps = searchPluginKey.getState(state);
          if (!ps || ps.current < 0 || !ps.matches[ps.current]) return false;
          const target = ps.matches[ps.current];
          if (dispatch) {
            tr.insertText(replacement, target.from, target.to);
            // 替换后重新扫描，定位到替换位置之后的下一个匹配
            const matches = findMatches(tr.doc, ps.query, ps.caseSensitive);
            const current = nearestIndex(matches, target.from + replacement.length);
            if (current >= 0) selectMatch(tr, matches[current]);
            tr.setMeta(searchPluginKey, { matches, current } satisfies SearchMeta);
          }
          return true;
        },
      replaceAllMatches:
        (replacement) =>
        ({ state, tr, dispatch }) => {
          const ps = searchPluginKey.getState(state);
          if (!ps || ps.matches.length === 0) return false;
          if (dispatch) {
            // 从后往前替换，前面匹配的位置不受影响
            [...ps.matches].reverse().forEach((m) => tr.insertText(replacement, m.from, m.to));
            tr.setMeta(searchPluginKey, { matches: [], current: -1 } satisfies SearchMeta);
          }
          return true;
        },
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin<SearchPluginState>({
        key: searchPluginKey,
        state: {
          init: () => ({ query: '', caseSensitive: false, matches: [], current: -1, decorations: DecorationSet.empty }),
          apply(tr, prev, _oldState, newState) {
            const meta = tr.getMeta(searchPluginKey) as SearchMeta | undefined;
            if (!meta && !tr.docChanged) return prev;
            const query = meta?.query ?? prev.query;
            const caseSensitive = meta?.caseSensitive ?? prev.caseSensitive;
            // 优先用命令里算好的匹配；只有文档被外部改动（无 meta）时才重扫
            const matches = meta?.matches ?? findMatches(newState.doc, query, caseSensitive);
            let current = meta?.current ?? prev.current;
            if (current >= matches.length) current = matches.length - 1;
            if (matches.length === 0) current = -1;
            return { query, caseSensitive, matches, current, decorations: buildDecorations(newState.doc, matches, current) };
          },
        },
        props: {
          decorations(state) {
            return searchPluginKey.getState(state)?.decorations ?? DecorationSet.empty;
          },
        },
      }),
    ];
  },
});
