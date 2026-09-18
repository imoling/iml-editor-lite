import React from 'react';
import type { Editor } from '@tiptap/core';
import { BubbleMenu } from '@tiptap/react';
import {
  Bold, Italic, Underline as UnderlineIcon, Code, Plus, Trash2, Columns, Rows, LayoutGrid,
  Type, ListOrdered, List, SquareCheck, Quote, Sparkles, Wand2, FileText, FileCode,
  AlignLeft, AlignCenter, AlignRight,
} from 'lucide-react';

interface Props {
  editor: Editor;
  aiGenerating: boolean;
  /** AI 总开关关闭时不显示润色 / 总结 / 扩写 */
  aiEnabled?: boolean;
  onToggleCodeBlock: () => void;
  onAIAction: (action: 'polish' | 'summarize' | 'expand', style?: string) => void;
}

/** 选中文本后的浮动菜单：格式、AI 润色 / 总结 / 扩写，以及代码块语言与表格操作 */
export const EditorBubbleMenu: React.FC<Props> = ({ editor, aiGenerating, aiEnabled = true, onToggleCodeBlock, onAIAction }) => (
    <BubbleMenu 
      editor={editor} 
      tippyOptions={{ 
        interactive: true, 
        hideOnClick: false,
        duration: [150, 150]
      }}
      shouldShow={({ state, editor }) => {
        if (state.selection.empty) return false;
        // Don't show for custom block nodes
        const isCustomBlock = editor.isActive('diagram') || editor.isActive('svgBlock') || editor.isActive('frontmatter') || editor.isActive('rawBlock') || editor.isActive('toc') || editor.isActive('math');
        return !isCustomBlock;
      }}
    >
      <div className="bubble-menu">
        <div className="bubble-menu__row">
          <button onClick={() => editor.chain().focus().setParagraph().run()} className={`toolbar-icon-btn ${editor.isActive('paragraph') ? 'active' : ''}`} title="正文"><Type size={16} /></button>
          <div className="toolbar-divider"></div>
          <button onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} className={`toolbar-btn ${editor.isActive('heading', { level: 1 }) ? 'active' : ''}`} title="标题 1">H1</button>
          <button onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} className={`toolbar-btn ${editor.isActive('heading', { level: 2 }) ? 'active' : ''}`} title="标题 2">H2</button>
          <button onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} className={`toolbar-btn ${editor.isActive('heading', { level: 3 }) ? 'active' : ''}`} title="标题 3">H3</button>
          <div className="toolbar-divider"></div>
          <button onClick={() => editor.chain().focus().toggleBulletList().run()} className={`toolbar-icon-btn ${editor.isActive('bulletList') ? 'active' : ''}`} title="无序列表"><List size={16} /></button>
          <button onClick={() => editor.chain().focus().toggleOrderedList().run()} className={`toolbar-icon-btn ${editor.isActive('orderedList') ? 'active' : ''}`} title="有序列表"><ListOrdered size={16} /></button>
          <button onClick={() => editor.chain().focus().toggleTaskList().run()} className={`toolbar-icon-btn ${editor.isActive('taskList') ? 'active' : ''}`} title="任务列表"><SquareCheck size={16} /></button>
        </div>
        <div className="bubble-menu__row">
          <button onClick={() => editor.chain().focus().toggleBold().run()} className={`toolbar-icon-btn ${editor.isActive('bold') ? 'active' : ''}`} title="加粗"><Bold size={16} /></button>
          <button onClick={() => editor.chain().focus().toggleItalic().run()} className={`toolbar-icon-btn ${editor.isActive('italic') ? 'active' : ''}`} title="倾斜"><Italic size={16} /></button>
          <button onClick={() => editor.chain().focus().toggleUnderline().run()} className={`toolbar-icon-btn ${editor.isActive('underline') ? 'active' : ''}`} title="下划线"><UnderlineIcon size={16} /></button>
          <button onClick={() => editor.chain().focus().toggleCode().run()} className={`toolbar-icon-btn ${editor.isActive('code') ? 'active' : ''}`} title="行内代码"><Code size={16} /></button>
          <button onClick={() => onToggleCodeBlock()} className={`toolbar-icon-btn ${editor.isActive('codeBlock') ? 'active' : ''}`} title="代码块"><FileCode size={16} /></button>
          <button onClick={() => editor.chain().focus().toggleBlockquote().run()} className={`toolbar-icon-btn ${editor.isActive('blockquote') ? 'active' : ''}`} title="引用"><Quote size={16} /></button>
          {aiEnabled && (
            <>
              <div className="toolbar-divider"></div>
              <button onClick={() => onAIAction('polish')} className="toolbar-icon-btn" title="AI 润色" disabled={aiGenerating}><Wand2 size={16} color="var(--color-accent-indigo)" /></button>
              <button onClick={() => onAIAction('summarize')} className="toolbar-icon-btn" title="AI 总结" disabled={aiGenerating}><FileText size={16} color="var(--color-accent-green)" /></button>
              <button onClick={() => onAIAction('expand')} className="toolbar-icon-btn" title="AI 扩写" disabled={aiGenerating}><Sparkles size={16} color="var(--color-accent-orange)" /></button>
            </>
          )}
        </div>
        {editor.isActive('codeBlock') && (
          <>
            <div className="bubble-menu__divider" />
            <div className="bubble-menu__row bubble-menu__lang">
              <span className="bubble-menu__lang-label">语言：</span>
              <select 
                value={editor.getAttributes('codeBlock').language || ''}
                onMouseDown={e => e.stopPropagation()}
                onClick={e => e.stopPropagation()}
                onChange={e => {
                  e.stopPropagation();
                  editor.chain().focus().updateAttributes('codeBlock', { language: e.target.value }).run();
                }}
                className="bubble-menu__select"
              >
                <option value="">自动检测</option>
                <option value="javascript">JavaScript</option>
                <option value="typescript">TypeScript</option>
                <option value="python">Python</option>
                <option value="java">Java</option>
                <option value="html">HTML</option>
                <option value="css">CSS</option>
                <option value="json">JSON</option>
                <option value="markdown">Markdown</option>
                <option value="bash">Bash</option>
                <option value="sql">SQL</option>
                <option value="cpp">C++</option>
                <option value="rust">Rust</option>
              </select>
            </div>
          </>
        )}
        {editor.isActive('table') && (
          <>
            <div className="bubble-menu__divider" />
            <div className="bubble-menu__row">
              <button onClick={() => editor.chain().focus().addColumnAfter().run()} className="toolbar-icon-btn" title="在右侧增加列"><Columns size={16} /><Plus size={10} className="bubble-menu__badge" /></button>
              <button onClick={() => editor.chain().focus().addRowAfter().run()} className="toolbar-icon-btn" title="在下方增加行"><Rows size={16} /><Plus size={10} className="bubble-menu__badge" /></button>
              <div className="toolbar-divider"></div>
              <button onClick={() => editor.chain().focus().setTextAlign('left').run()} className={`toolbar-icon-btn ${editor.isActive({ textAlign: 'left' }) ? 'active' : ''}`} title="靠左对齐"><AlignLeft size={16} /></button>
              <button onClick={() => editor.chain().focus().setTextAlign('center').run()} className={`toolbar-icon-btn ${editor.isActive({ textAlign: 'center' }) ? 'active' : ''}`} title="居中对齐"><AlignCenter size={16} /></button>
              <button onClick={() => editor.chain().focus().setTextAlign('right').run()} className={`toolbar-icon-btn ${editor.isActive({ textAlign: 'right' }) ? 'active' : ''}`} title="靠右对齐"><AlignRight size={16} /></button>
              <div className="toolbar-divider"></div>
              <button onClick={() => editor.chain().focus().deleteColumn().run()} className="toolbar-icon-btn" title="删除当前列"><Columns size={16} className="bubble-menu__dim" /><Trash2 size={10} className="bubble-menu__trash" /></button>
              <button onClick={() => editor.chain().focus().deleteRow().run()} className="toolbar-icon-btn" title="删除当前行"><Rows size={16} className="bubble-menu__dim" /><Trash2 size={10} className="bubble-menu__trash" /></button>
              <button onClick={() => editor.chain().focus().deleteTable().run()} className="toolbar-icon-btn" title="删除整个表格"><LayoutGrid size={16} className="bubble-menu__dim bubble-menu__dim--more" /><Trash2 size={10} className="bubble-menu__trash" /></button>
            </div>
          </>
        )}
      </div>
    </BubbleMenu>
);
