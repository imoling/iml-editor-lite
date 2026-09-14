import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { ListItem } from '@tiptap/extension-list-item';
import { Underline } from '@tiptap/extension-underline';
import { Link } from '@tiptap/extension-link';
import { TextAlign } from '@tiptap/extension-text-align';
import { all, createLowlight } from 'lowlight';
import { MathExtension } from '../../extensions/MathExtension';
import { DiagramExtension } from '../../extensions/DiagramExtension';
import { SVGExtension } from '../../extensions/SVGExtension';
import { SearchExtension } from '../../extensions/SearchExtension';
import { CustomHeadingEnter, ShortcutOverrides } from '../../extensions/EditorKeymaps';
import { SlashCommand } from '../../extensions/SlashCommand';
import { WikiLink } from '../../extensions/WikiLink';
import { WikiLinkSuggestion } from '../../extensions/WikiLinkSuggestion';

const lowlight = createLowlight(all);

/** 富文本编辑器的全部扩展；测试里也用同一份，保证序列化结果与真实编辑器一致 */
export const editorExtensions = [
  CustomHeadingEnter,
  ShortcutOverrides,
  SearchExtension,
  SlashCommand,
  WikiLink,
  WikiLinkSuggestion,
  StarterKit.configure({
    codeBlock: false, 
    listItem: false,
  }), 
  ListItem.extend({
    content: 'block+',
  }),
  Image.configure({ allowBase64: true }),
  Table.configure({
    resizable: true,
  }),
  TableRow,
  TableHeader,
  TableCell,
  CodeBlockLowlight.configure({
    lowlight,
  }),
  MathExtension,
  DiagramExtension,
  SVGExtension,
  TaskList,
  TaskItem.extend({
    content: 'block+',
  }).configure({
    nested: true,
  }),
  Underline,
  Link.configure({
    openOnClick: false,
  }),
  TextAlign.configure({
    types: ['heading', 'paragraph', 'tableCell', 'tableHeader'],
  }),
  Placeholder.configure({
    placeholder: '在此开始你的写作...',
  })
];
