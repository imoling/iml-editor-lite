import { Extension } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion';

export interface WikiLinkCandidate {
  title: string;
  path: string;
  /** 没有匹配笔记时的「新建」选项 */
  create?: boolean;
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
            .insertContentAt(range, [{ type: 'wikiLink', attrs: { target: props.title, label: props.title } }, { type: 'text', text: ' ' }])
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

/** 按查询过滤笔记名；没有精确匹配时追加「新建」项 */
export function filterWikiCandidates(notes: { title: string; path: string }[], query: string): WikiLinkCandidate[] {
  const q = query.trim().toLowerCase();
  const matched: WikiLinkCandidate[] = (q ? notes.filter((n) => n.title.toLowerCase().includes(q)) : notes).slice(0, 8);
  const exact = matched.some((n) => n.title.toLowerCase() === q);
  if (q && !exact) matched.push({ title: query.trim(), path: '', create: true });
  return matched;
}
