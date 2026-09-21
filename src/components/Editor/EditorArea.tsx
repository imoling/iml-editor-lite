import React from 'react';
import { useAppStore } from '../../stores/appStore';
import { TiptapEditor } from './TiptapEditor';
import { MarkdownEditor } from './MarkdownEditor';
import { FindReplacePanel } from './FindReplacePanel';

export const EditorArea: React.FC = () => {
  const { mode, activeTabId, autoSave, saveActiveFile } = useAppStore();

  const handleBlur = (e: React.FocusEvent) => {
    // 开了自动保存：焦点完全离开编辑器区域（比如点了侧边栏）时把已有的文件存盘；未命名文档不会被悄悄建成文件
    if (autoSave && !e.currentTarget.contains(e.relatedTarget as Node)) {
      saveActiveFile(false, true);
    }
  };

  return (
    <main className="editor-area editor-area--host" onBlur={handleBlur}>
      <FindReplacePanel />
      <div className={`editor-content ${mode === 'word' ? 'editor-content--column' : 'editor-content--row'}`}>
        {/* 没有欢迎页。标签页为空只出现在启动的那一瞬间（设置、会话还没读完），这时什么都不画 */}
        {!activeTabId ? null : mode === 'word' ? <TiptapEditor /> : <MarkdownEditor />}
      </div>
    </main>
  );
};
