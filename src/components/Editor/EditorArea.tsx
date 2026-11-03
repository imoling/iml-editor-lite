import React from 'react';
import { useAppStore } from '../../stores/appStore';
import { useShallow } from 'zustand/react/shallow';
import { TiptapEditor } from './TiptapEditor';
import { MarkdownEditor } from './MarkdownEditor';
import { FindReplacePanel } from './FindReplacePanel';
import { ExternalChangeBar } from './ExternalChangeBar';

const EditorAreaImpl: React.FC = () => {
  const { mode, activeTabId, autoSave, saveActiveFile } = useAppStore(useShallow((s) => ({ mode: s.mode, activeTabId: s.activeTabId, autoSave: s.autoSave, saveActiveFile: s.saveActiveFile })));

  const handleBlur = (e: React.FocusEvent) => {
    // 开了自动保存：焦点完全离开编辑器区域（比如点了侧边栏）时把已有的文件存盘；未命名文档不会被悄悄建成文件
    if (autoSave && !e.currentTarget.contains(e.relatedTarget as Node)) {
      saveActiveFile(false, true);
    }
  };

  return (
    <main className="editor-area editor-area--host" onBlur={handleBlur}>
      <FindReplacePanel />
      <ExternalChangeBar />
      <div className={`editor-content ${mode === 'word' ? 'editor-content--column' : 'editor-content--row'}`}>
        {/* 没有欢迎页。标签页为空只出现在启动的那一瞬间（设置、会话还没读完），这时什么都不画 */}
        {!activeTabId ? null : mode === 'word' ? <TiptapEditor /> : <MarkdownEditor />}
      </div>
    </main>
  );
};

/** 不接 props，只靠自己订阅的 store 片段更新：App 因为弹窗、标签页这类事重渲染时，这一整块不跟着重画 */
export const EditorArea = React.memo(EditorAreaImpl);
