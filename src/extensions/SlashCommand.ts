import { Extension } from '@tiptap/core';
import type { Editor, Range } from '@tiptap/core';
import { PluginKey } from '@tiptap/pm/state';
import Suggestion, { SuggestionProps, SuggestionKeyDownProps } from '@tiptap/suggestion';

export interface SlashItem {
  id: string;
  title: string;
  description: string;
  /** 额外的匹配词（英文、拼音首字母等） */
  keywords: string[];
  group: string;
  /** 图标名（由菜单组件映射到 lucide 图标） */
  icon: string;
  run: (editor: Editor, range: Range) => void;
}

export interface SlashMenuHandlers {
  onStart: (props: SuggestionProps<SlashItem, SlashItem>) => void;
  onUpdate: (props: SuggestionProps<SlashItem, SlashItem>) => void;
  onKeyDown: (props: SuggestionKeyDownProps) => boolean;
  onExit: () => void;
}

/**
 * 菜单 UI 与命令列表由 React 层注册进来，扩展本身保持无状态；
 * 这样 editorExtensions 可以是一份静态列表，测试里也能直接用。
 */
export const slashMenuRegistry: {
  handlers: SlashMenuHandlers | null;
  items: (query: string) => SlashItem[];
} = { handlers: null, items: () => [] };

export const slashCommandPluginKey = new PluginKey('slashCommand');

/** 行首输入 `/` 打开插入菜单（Notion 式斜杠命令） */
export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem, SlashItem>({
        editor: this.editor,
        pluginKey: slashCommandPluginKey,
        char: '/',
        startOfLine: true,
        allowSpaces: false,
        items: ({ query }) => slashMenuRegistry.items(query),
        command: ({ editor, range, props }) => props.run(editor, range),
        render: () => ({
          onStart: (props) => slashMenuRegistry.handlers?.onStart(props),
          onUpdate: (props) => slashMenuRegistry.handlers?.onUpdate(props),
          onKeyDown: (props) => slashMenuRegistry.handlers?.onKeyDown(props) ?? false,
          onExit: () => slashMenuRegistry.handlers?.onExit(),
        }),
      }),
    ];
  },
});
