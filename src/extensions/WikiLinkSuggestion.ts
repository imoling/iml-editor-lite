import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion';

export interface WikiLinkCandidate {
  title: string;
  path: string;
  /** 没有匹配笔记时的「新建」选项 */
  create?: boolean;
  /** 靠 frontmatter 的别名命中：插入 [[title|alias]] */
  alias?: string;
  /** `[[笔记#` 之后的小节候选：title 是完整目标「笔记#小节」，这里是小节名和层级 */
  heading?: { text: string; level: number };
}

export interface WikiLinkMenuHandlers {
  onStart: (props: SuggestionProps<WikiLinkCandidate, WikiLinkCandidate>) => void;
  onUpdate: (props: SuggestionProps<WikiLinkCandidate, WikiLinkCandidate>) => void;
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
  onExit: () => void;
}

/** 与 SlashCommand 同样的注册模式：候选列表与 UI 由 React 层提供 */
export const wikiLinkRegistry: {
  handlers: WikiLinkMenuHandlers | null;
  items: (query: string) => Promise<WikiLinkCandidate[]> | WikiLinkCandidate[];
} = { handlers: null, items: () => [] };

export const wikiLinkPluginKey = new PluginKey('wikiLinkSuggestion');

/** 输入 `[[` 弹出笔记名补全 */
export const WikiLinkSuggestion = Extension.create({
  name: 'wikiLinkSuggestion',

  addProseMirrorPlugins() {
    return [
      Suggestion<WikiLinkCandidate, WikiLinkCandidate>({
        editor: this.editor,
        pluginKey: wikiLinkPluginKey,
        char: '[[',
        allowSpaces: true,
        startOfLine: false,
        items: ({ query }) => wikiLinkRegistry.items(query),
        command: ({ editor, range, props }) => {
          editor
            .chain()
            .focus()
            .insertContentAt(range, [{ type: 'wikiLink', attrs: { target: props.title, label: props.alias || props.title } }, { type: 'text', text: ' ' }])
            .run();
        },
        render: () => ({
          onStart: (props) => wikiLinkRegistry.handlers?.onStart(props),
          onUpdate: (props) => wikiLinkRegistry.handlers?.onUpdate(props),
          onKeyDown: (props) => wikiLinkRegistry.handlers?.onKeyDown(props) ?? false,
          onExit: () => wikiLinkRegistry.handlers?.onExit(),
        }),
      }),
    ];
  },
});

/** 按查询过滤笔记名（名字没中再看别名）；没有精确匹配时追加「新建」项 */
export function filterWikiCandidates(notes: { title: string; path: string; aliases?: string[] }[], query: string): WikiLinkCandidate[] {
  const q = query.trim().toLowerCase();
  const matched: WikiLinkCandidate[] = [];
  for (const n of notes) {
    if (matched.length >= 8) break;
    if (!q || n.title.toLowerCase().includes(q)) { matched.push({ title: n.title, path: n.path }); continue; }
    const alias = (n.aliases || []).find((a) => a.toLowerCase().includes(q));
    if (alias) matched.push({ title: n.title, path: n.path, alias });
  }
  const exact = matched.some((n) => n.title.toLowerCase() === q || n.alias?.toLowerCase() === q);
  if (q && !exact) matched.push({ title: query.trim(), path: '', create: true });
  return matched;
}
