import type { Editor, Range } from '@tiptap/core';
import type { SlashItem } from '../../extensions/SlashCommand';

/** 需要 React 层配合（打开对话框）的动作 */
export interface SlashActions {
  openTable: () => void;
  openImage: () => void;
  openLink: () => void;
}

import { formatDate, formatTime } from '../../utils/date';

/** 先删掉触发菜单的 `/query`，再执行命令 */
const after = (fn: (e: Editor) => void) => (e: Editor, r: Range) => {
  e.chain().focus().deleteRange(r).run();
  fn(e);
};

export function createSlashItems(actions: SlashActions): SlashItem[] {
  const items: SlashItem[] = [
    { id: 'h1', group: '基本', title: '标题 1', description: '大标题', keywords: ['h1', 'heading', 'bt', 'biaoti'], icon: 'Heading1', run: after((e) => e.chain().focus().setNode('heading', { level: 1 }).run()) },
    { id: 'h2', group: '基本', title: '标题 2', description: '章节标题', keywords: ['h2', 'heading', 'bt', 'biaoti'], icon: 'Heading2', run: after((e) => e.chain().focus().setNode('heading', { level: 2 }).run()) },
    { id: 'h3', group: '基本', title: '标题 3', description: '小节标题', keywords: ['h3', 'heading', 'bt', 'biaoti'], icon: 'Heading3', run: after((e) => e.chain().focus().setNode('heading', { level: 3 }).run()) },
    { id: 'text', group: '基本', title: '正文', description: '普通段落', keywords: ['text', 'paragraph', 'zw', 'zhengwen'], icon: 'Type', run: after((e) => e.chain().focus().setParagraph().run()) },
    { id: 'bullet', group: '列表', title: '无序列表', description: '圆点列表', keywords: ['ul', 'bullet', 'list', 'lb', 'liebiao'], icon: 'List', run: after((e) => e.chain().focus().toggleBulletList().run()) },
    { id: 'ordered', group: '列表', title: '有序列表', description: '编号列表', keywords: ['ol', 'ordered', 'number', 'lb', 'liebiao'], icon: 'ListOrdered', run: after((e) => e.chain().focus().toggleOrderedList().run()) },
    { id: 'task', group: '列表', title: '任务列表', description: '带勾选框', keywords: ['todo', 'task', 'checkbox', 'rw', 'renwu', 'daiban'], icon: 'SquareCheck', run: after((e) => e.chain().focus().toggleTaskList().run()) },
    { id: 'quote', group: '块', title: '引用', description: '引用段落', keywords: ['quote', 'blockquote', 'yy', 'yinyong'], icon: 'Quote', run: after((e) => e.chain().focus().toggleBlockquote().run()) },
    { id: 'code', group: '块', title: '代码块', description: '带语法高亮', keywords: ['code', 'pre', 'dm', 'daima'], icon: 'FileCode', run: after((e) => e.chain().focus().toggleCodeBlock().run()) },
    { id: 'callout', group: '块', title: '提示块', description: '> [!NOTE] 彩色提示卡片', keywords: ['callout', 'note', 'tip', 'admonition', 'ts', 'tishi'], icon: 'Info', run: after((e) => e.chain().focus().toggleCallout('NOTE').run()) },
    { id: 'callout-warning', group: '块', title: '警告块', description: '> [!WARNING] 需要留意的内容', keywords: ['warning', 'caution', 'jg', 'jinggao'], icon: 'TriangleAlert', run: after((e) => e.chain().focus().toggleCallout('WARNING').run()) },
    { id: 'divider', group: '块', title: '分割线', description: '水平分隔', keywords: ['hr', 'divider', 'line', 'fgx', 'fengexian'], icon: 'Minus', run: after((e) => e.chain().focus().setHorizontalRule().run()) },
    { id: 'table', group: '插入', title: '表格', description: '指定行列数', keywords: ['table', 'bg', 'biaoge'], icon: 'Table', run: after(() => actions.openTable()) },
    { id: 'image', group: '插入', title: '图片', description: '本地图片 / 网络链接', keywords: ['image', 'img', 'picture', 'tp', 'tupian'], icon: 'Image', run: after(() => actions.openImage()) },
    { id: 'link', group: '插入', title: '链接', description: '插入超链接', keywords: ['link', 'url', 'lj', 'lianjie'], icon: 'Link', run: after(() => actions.openLink()) },
    { id: 'math', group: '插入', title: '公式', description: 'LaTeX 数学公式', keywords: ['math', 'latex', 'formula', 'gs', 'gongshi'], icon: 'Sigma', run: after((e) => e.chain().focus().insertContent({ type: 'math', attrs: { latex: 'e = mc^2' } }).run()) },
    { id: 'mermaid', group: '插入', title: 'Mermaid 图表', description: '流程图 / 时序图 / 甘特图', keywords: ['mermaid', 'chart', 'flow', 'tb', 'tubiao', 'lct'], icon: 'Activity', run: after((e) => e.chain().focus().insertContent({ type: 'diagram', attrs: { code: 'graph TD\n  A[开始] --> B{选择}\n  B -->|选项1| C[结果1]\n  B -->|选项2| D[结果2]' } }).run()) },
    { id: 'svg', group: '插入', title: 'SVG 插图', description: '内联矢量图', keywords: ['svg', 'vector', 'ct', 'chatu'], icon: 'PenTool', run: after((e) => e.chain().focus().insertContent({ type: 'svgBlock', attrs: { code: '<svg width="100" height="100" viewBox="0 0 100 100">\n  <circle cx="50" cy="50" r="40" stroke="#6366F1" stroke-width="3" fill="#EEF2FF" />\n  <text x="50" y="55" font-size="12" text-anchor="middle" fill="#1D1D1F">SVG</text>\n</svg>' } }).run()) },
    { id: 'toc', group: '插入', title: '目录', description: '[TOC] 随标题自动更新', keywords: ['toc', 'contents', 'ml', 'mulu'], icon: 'ListTree', run: after((e) => e.chain().focus().insertToc().run()) },
    { id: 'frontmatter', group: '插入', title: '属性（Frontmatter）', description: '文档开头的 YAML：标签、日期、别名', keywords: ['frontmatter', 'yaml', 'properties', 'tags', 'sx', 'shuxing'], icon: 'Tags', run: after((e) => e.chain().focus().insertFrontmatter(`tags: []\ndate: ${formatDate(new Date())}`).run()) },
    { id: 'date', group: '插入', title: '今天日期', description: formatDate(new Date()), keywords: ['date', 'today', 'rq', 'riqi', 'jintian'], icon: 'Calendar', run: after((e) => e.chain().focus().insertContent(formatDate(new Date())).run()) },
    { id: 'datetime', group: '插入', title: '当前时间', description: `${formatDate(new Date())} ${formatTime(new Date())}`, keywords: ['time', 'now', 'sj', 'shijian'], icon: 'Clock', run: after((e) => e.chain().focus().insertContent(`${formatDate(new Date())} ${formatTime(new Date())}`).run()) },
  ];
  return items;
}

/** 按标题 / 关键词过滤；空查询返回全部 */
export function filterSlashItems(items: SlashItem[], query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter((it) => it.title.toLowerCase().includes(q) || it.keywords.some((k) => k.toLowerCase().startsWith(q)));
}
