import React from 'react';
import type { Editor } from '@tiptap/core';
import {
  Bold, Italic, Underline as UnderlineIcon, Code, Sigma, Table as TableIcon, Image as ImageIcon,
  Type, ListOrdered, List, SquareCheck, Quote, Link as LinkIcon, Activity, FileCode,
} from 'lucide-react';

interface Props {
  editor: Editor;
  onToggleHeading: (level: number) => void;
  onToggleOrderedList: () => void;
  onToggleCodeBlock: () => void;
  onInsertTable: () => void;
  onInsertImage: () => void;
  onInsertLink: () => void;
  onInsertMermaid: () => void;
  onInsertSVG: () => void;
}

const Divider = () => <div className="toolbar-divider" />;

/** 富文本模式顶部工具栏 */
export const EditorToolbar: React.FC<Props> = ({
  editor, onToggleHeading, onToggleOrderedList, onToggleCodeBlock,
  onInsertTable, onInsertImage, onInsertLink, onInsertMermaid, onInsertSVG,
}) => {
  const active = (name: string, attrs?: Record<string, unknown>) => (editor.isActive(name, attrs) ? 'active' : '');
  return (
    <div className="tiptap-toolbar">
      <div className="toolbar-group">
        <button type="button" className={`toolbar-icon-btn ${active('paragraph')}`} onClick={() => editor.chain().focus().setParagraph().run()} title="正文"><Type size={16} /></button>
        <button type="button" className={`toolbar-btn ${active('heading', { level: 1 })}`} onClick={() => onToggleHeading(1)} title="标题 1">H1</button>
        <button type="button" className={`toolbar-btn ${active('heading', { level: 2 })}`} onClick={() => onToggleHeading(2)} title="标题 2">H2</button>
        <button type="button" className={`toolbar-btn ${active('heading', { level: 3 })}`} onClick={() => onToggleHeading(3)} title="标题 3">H3</button>
      </div>
      <Divider />
      <div className="toolbar-group">
        <button type="button" className={`toolbar-icon-btn ${active('bold')}`} onClick={() => editor.chain().focus().toggleBold().run()} title="加粗 (⌘B)"><Bold size={16} /></button>
        <button type="button" className={`toolbar-icon-btn ${active('italic')}`} onClick={() => editor.chain().focus().toggleItalic().run()} title="倾斜 (⌘I)"><Italic size={16} /></button>
        <button type="button" className={`toolbar-icon-btn ${active('underline')}`} onClick={() => editor.chain().focus().toggleUnderline().run()} title="下划线 (⌘U)"><UnderlineIcon size={16} /></button>
      </div>
      <Divider />
      <div className="toolbar-group">
        <button type="button" className={`toolbar-icon-btn ${active('orderedList')}`} onClick={onToggleOrderedList} title="有序列表"><ListOrdered size={16} /></button>
        <button type="button" className={`toolbar-icon-btn ${active('bulletList')}`} onClick={() => editor.chain().focus().toggleBulletList().run()} title="无序列表"><List size={16} /></button>
        <button type="button" className={`toolbar-icon-btn ${active('taskList')}`} onClick={() => editor.chain().focus().toggleTaskList().run()} title="任务列表"><SquareCheck size={16} /></button>
      </div>
      <Divider />
      <div className="toolbar-group">
        <button type="button" className={`toolbar-icon-btn ${active('code')}`} onClick={() => editor.chain().focus().toggleCode().run()} title="行内代码 (⌘`)"><Code size={16} /></button>
        <button type="button" className={`toolbar-icon-btn ${active('codeBlock')}`} onClick={onToggleCodeBlock} title="代码块"><FileCode size={16} /></button>
        <button type="button" className={`toolbar-icon-btn ${active('blockquote')}`} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="引用"><Quote size={16} /></button>
        <button type="button" className="toolbar-icon-btn" onClick={() => editor.chain().focus().insertContent('$x = y^2$').run()} title="数学公式"><Sigma size={16} /></button>
        <button type="button" className={`toolbar-icon-btn ${active('table')}`} onClick={onInsertTable} title="插入表格"><TableIcon size={16} /></button>
        <button type="button" className="toolbar-icon-btn" onClick={onInsertImage} title="插入图片"><ImageIcon size={16} /></button>
        <button type="button" className={`toolbar-icon-btn ${active('link')}`} onClick={onInsertLink} title="插入链接 (⌘K)"><LinkIcon size={16} /></button>
        <Divider />
        <button type="button" className="toolbar-icon-btn" onClick={onInsertMermaid} title="插入 Mermaid 图表"><Activity size={16} color="var(--color-accent-indigo)" /></button>
        <button type="button" className="toolbar-icon-btn" onClick={onInsertSVG} title="插入 SVG 组件"><FileCode size={16} color="var(--color-accent-orange)" /></button>
      </div>
    </div>
  );
};
