import React, { useEffect, useState, useRef, useCallback } from 'react';
import ReactDOM from 'react-dom';
import { EditorContent, useEditor } from '@tiptap/react';
import { TextSelection } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/core';
import { useAppStore } from '../../stores/appStore';
import { markdownToHtml } from '../../utils/markdown';
import { serializeDoc } from '../../utils/incrementalMarkdown';
import { searchPluginKey } from '../../extensions/SearchExtension';
import { editorExtensions } from './editorExtensions';
import { useEditorAI } from './useEditorAI';
import { EditorToolbar } from './EditorToolbar';
import { EditorBubbleMenu } from './EditorBubbleMenu';
import { PromptDialog, PromptDialogProps } from './dialogs/PromptDialog';
import { ImageInsertDialog } from './dialogs/ImageInsertDialog';
import { StyleSelector } from './dialogs/StyleSelector';
import { AIPalette } from '../AI/AIPalette';
import { SlashMenu } from './SlashMenu';
import { createSlashItems, filterSlashItems } from './slashItems';
import { slashMenuRegistry, SlashItem } from '../../extensions/SlashCommand';
import { wikiLinkRegistry, filterWikiCandidates, WikiLinkCandidate } from '../../extensions/WikiLinkSuggestion';
import { WikiLinkMenu } from './WikiLinkMenu';
import type { SuggestionProps } from '@tiptap/suggestion';
import '../styles/editor.css';

/** 把编辑器内的查找状态（匹配数 / 当前项）回写到 store */
function reportSearchState(editor: Editor) {
  const ps = searchPluginKey.getState(editor.state);
  const total = ps?.matches.length ?? 0;
  const current = ps && ps.current >= 0 ? ps.current + 1 : 0;
  useAppStore.getState().setSearchCounts(total, current);
}

export const TiptapEditor: React.FC = () => {
  const { 
    activeTabId, tabs, updateTabContent, navigationRequest, zoom,
    outline, toolbarVisible,
  } = useAppStore();
  const search = useAppStore((s) => s.search);
  const searchCommand = useAppStore((s) => s.searchCommand);
  const registerEditorFlush = useAppStore((s) => s.registerEditorFlush);
  const activeTab = tabs.find(t => t.id === activeTabId);
  const [prompt, setPrompt] = useState<PromptDialogProps | null>(null);
  const [showImageDialog, setShowImageDialog] = useState(false);
  const editorRef = useRef<any>(null);
  const activeTabIdRef = useRef<string | null>(null);
  // Tracks the previous editor instance to detect fresh mounts (e.g. after mode switch)
  const prevEditorRef = useRef<ReturnType<typeof useEditor> | null>(null);
  // Tracks previous activeTabId for the content-sync effect, to detect tab switches
  const prevSyncTabIdRef = useRef<string | null>(null);

  // ── 编辑器 → store 同步（防抖）──
  // 每次按键都做整篇 HTML→Markdown 转换会拖慢大文档；这里防抖 150ms，失焦 / 切换标签 / 卸载时立即刷写
  const syncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 最近一次由本编辑器写回 store 的 Markdown：用于识别「外部内容同步」效应收到的是不是自己的回声
  const lastSyncedMdRef = useRef<string | null>(null);

  const pushToStore = useCallback((tabId: string, markdown: string) => {
    lastSyncedMdRef.current = markdown;
    updateTabContent(tabId, markdown);
  }, [updateTabContent]);

  const syncToStore = useCallback(() => {
    const ed = editorRef.current as Editor | null;
    const currentTabId = activeTabIdRef.current;
    if (!ed || !currentTabId) return;
    const { markdown, hasDataImage } = serializeDoc(ed);
    if (hasDataImage && !markdown.includes('data:image/')) {
      console.warn('[Tiptap] htmlToMarkdown dropped data URL image, skipping sync');
      return;
    }
    if (!markdown && ed.state.doc.textContent.trim()) {
      console.warn('[Tiptap] htmlToMarkdown returned empty, skipping store sync to prevent data loss.');
      return;
    }
    pushToStore(currentTabId, markdown);
  }, [pushToStore]);

  const flushSync = useCallback(() => {
    if (!syncTimerRef.current) return;
    clearTimeout(syncTimerRef.current);
    syncTimerRef.current = null;
    syncToStore();
  }, [syncToStore]);

  const scheduleSync = useCallback(() => {
    if (syncTimerRef.current) clearTimeout(syncTimerRef.current);
    syncTimerRef.current = setTimeout(() => {
      syncTimerRef.current = null;
      syncToStore();
    }, 150);
  }, [syncToStore]);

  const scheduleSyncRef = useRef(scheduleSync);
  const flushSyncRef = useRef(flushSync);
  scheduleSyncRef.current = scheduleSync;
  flushSyncRef.current = flushSync;

  useEffect(() => {
    // 切换标签前先把上一标签的待同步内容刷写回 store，避免串写到新标签
    if (activeTabIdRef.current !== activeTabId) flushSyncRef.current();
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  // 向 store 注册「立即刷写」钩子：保存 / 导出 / 关窗前由 store 调用，保证写出的是屏幕上的最新内容
  useEffect(() => {
    registerEditorFlush(() => flushSyncRef.current());
    return () => registerEditorFlush(null);
  }, [registerEditorFlush]);

  const editor = useEditor({
    extensions: editorExtensions,
    content: activeTab ? markdownToHtml(activeTab.content) : '',
    editorProps: {
      attributes: {
        class: 'tiptap-prosemirror',
      },
      handleClick: (_view, _pos, event) => {
        // 点击双向链接芯片 → 打开（或新建）目标笔记
        const link = (event.target as HTMLElement).closest('[data-wiki-link]');
        if (link) {
          useAppStore.getState().openWikiLink(link.getAttribute('data-wiki-link') || '');
          return true;
        }
        return false;
      },
      handleDoubleClick: (view, pos, event) => {
        const coords = { left: event.clientX, top: event.clientY };
        const result = view.posAtCoords(coords);
        if (!result) return false;

        const { state } = view;
        let nodePos = result.inside;
        // 如果 inside 为 -1，说明点在了顶级（直接的 doc 子节点之间），我们尝试探测 pos
        if (nodePos === -1) {
          const $pos = state.doc.resolve(pos);
          nodePos = $pos.before();
        }

        if (nodePos < 0) return false;

        const targetEl = event.target as HTMLElement;
        const inTable = targetEl.closest('td') || targetEl.closest('th');

        // 绝对免疫：避免劫持正常的代码高亮选词和独立按键的双击
        if (targetEl.closest('.cm-editor') || targetEl.closest('button') || targetEl.closest('input')) {
          return false;
        }

        // 如果在表格里，只有直接点击在非常靠近边缘的 td/th 留白处时，才作为触发（保护里面的普通文本段落双击）
        if (inTable) {
          if (targetEl.tagName.toLowerCase() === 'p' || targetEl.tagName.toLowerCase() === 'span') {
            return false; // 点到文字本身，不要劫持
          }
          const tableEl = targetEl.closest('table');
          if (tableEl) {
             const rect = tableEl.getBoundingClientRect();
             // 只有点击在整个表格绝对上下边缘的 30px 内，才认为是意图“插在表格外”。否则放行。
             const isTopEdge = event.clientY < rect.top + 30;
             const isBottomEdge = event.clientY > rect.bottom - 30;
             if (!isTopEdge && !isBottomEdge) {
                return false;
             }
          }
        }
        
        const node = state.doc.nodeAt(nodePos);
        if (!node) return false;

        // 我们关心的富容器：diagram (mermaid), svgBlock (svg拓展), image, table
        const blockTypes = ['diagram', 'svgBlock', 'image', 'table'];
        
        // 向上层层追溯，看看点击究竟属于哪个块级容器
        let targetNode = node;
        let targetPos = nodePos;
        
        if (!blockTypes.includes(node.type.name)) {
          const $resolved = state.doc.resolve(pos);
          for (let depth = $resolved.depth; depth > 0; depth--) {
            const ancestor = $resolved.node(depth);
            if (blockTypes.includes(ancestor.type.name)) {
              targetNode = ancestor;
              targetPos = $resolved.before(depth);
              break;
            }
          }
        }

        if (blockTypes.includes(targetNode.type.name)) {
          const dom = view.nodeDOM(targetPos);
          if (dom instanceof HTMLElement) {
            const rect = dom.getBoundingClientRect();
            // 点击位置位于元素上半区还是下半区
            const isTopHalf = event.clientY < rect.top + rect.height / 2;
            
            // 确保不超过文档最大范围
            let insertPos = isTopHalf ? targetPos : targetPos + targetNode.nodeSize;
            insertPos = Math.min(insertPos, state.doc.content.size);
            
            // 创建段落并插入
            let tr = state.tr.insert(insertPos, state.schema.nodes.paragraph.create());
            
            // 计算新光标位置：段落开始标签之后，并强制使用 TextSelection 规避 GapCursor 横线
            const focusPos = insertPos + 1;
            const newSelection = TextSelection.create(tr.doc, focusPos);
            tr = tr.setSelection(newSelection);
            
            view.dispatch(tr);
            view.focus();
            
            return true;
          }
        }
        return false;
      },
      handleDrop: (view, event, slice, moved) => {
        if (!moved && event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0]) {
          const file = event.dataTransfer.files[0];
          if (file.type.startsWith('image/')) {
             event.preventDefault();
             file.arrayBuffer().then(buffer => {
                window.api.fs.saveImage(activeTabId!, file.name, buffer).then(result => {
                    if (result.success && result.path) {
                        const { schema } = view.state;
                        const coordinates = view.posAtCoords({ left: event.clientX, top: event.clientY });
                        const node = schema.nodes.image.create({ src: result.path });
                        const transaction = view.state.tr.insert(coordinates?.pos || view.state.selection.to, node);
                        view.dispatch(transaction);
                    }
                });
             });
             return true;
          }
        }
        return false;
      },
      handlePaste: (view, event, slice) => {
        if (event.clipboardData && event.clipboardData.files && event.clipboardData.files[0]) {
          const file = event.clipboardData.files[0];
          if (file.type.startsWith('image/')) {
             event.preventDefault();
             file.arrayBuffer().then(buffer => {
                window.api.fs.saveImage(activeTabId!, file.name, buffer).then(result => {
                    if (result.success && result.path) {
                        const { schema } = view.state;
                        const node = schema.nodes.image.create({ src: result.path });
                        const transaction = view.state.tr.replaceSelectionWith(node);
                        view.dispatch(transaction);
                    }
                });
             });
             return true;
          }
        }
        return false;
      }
    },
    onUpdate: () => scheduleSyncRef.current(),
    onBlur: () => flushSyncRef.current(),
  });

  const {
    aiGenerating, showAIPalette, setShowAIPalette, palettePos, setPalettePos,
    showStyleSelector, setShowStyleSelector, handleAIAction, handleAIPaletteStop,
    handleAIPaletteAction, triggerAIPalette, closePalette,
  } = useEditorAI({ editor, outline, activeTabIdRef, pushToStore });

  const insertMermaid = () => {
    if (!editor) return;
    editor.chain().focus().insertContent({
      type: 'diagram',
      attrs: {
        code: 'graph TD\n  A[开始] --> B{选择}\n  B -->|选项1| C[结果1]\n  B -->|选项2| D[结果2]'
      }
    }).run();
    closePalette();
  };

  const insertSVG = () => {
    if (!editor) return;
    editor.chain().focus().insertContent({
      type: 'svgBlock',
      attrs: {
        code: '<svg width="100" height="100" viewBox="0 0 100 100">\n  <circle cx="50" cy="50" r="40" stroke="var(--color-brand-indigo)" stroke-width="3" fill="var(--bg-elevated)" />\n  <text x="50" y="55" font-size="12" text-anchor="middle" fill="var(--text-main)">SVG</text>\n</svg>'
      }
    }).run();
    closePalette();
  };

  const handleToggleHeading = useCallback((level: number) => {
    if (!editor) return;
    const isActive = editor.isActive('heading', { level });
    // Tiptap 的 toggleHeading() 命令有时会调用 clearNodes()，从而意外拔除包裹在外层的 list 节点。
    // 因此我们使用 setNode 手工强制转换，将该操作安全地束缚在当前的 Block 层级中！
    if (isActive) {
      editor.chain().focus().setParagraph().run();
    } else {
      editor.chain().focus().setNode('heading', { level }).run();
    }
  }, [editor]);

  const handleToggleOrderedList = useCallback(() => {
    if (!editor) return;
    // 强制保留内部节点的 wrap
    editor.chain().focus().toggleOrderedList().run();
  }, [editor]);

  const toggleSmartCodeBlock = useCallback(() => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    const isCodeBlock = editor.isActive('codeBlock');
    
    if (isCodeBlock) {
      editor.chain().focus().toggleCodeBlock().run();
      return;
    }

    // Not a code block yet. Let's try to join if multi-line is selected.
    // Use textBetween to get the actual text including internal newlines between blocks
    const text = editor.state.doc.textBetween(from, to, '\n');
    
    if (text.includes('\n')) {
      // If multi-line, replace the entire selection with one single code block
      editor.chain()
        .focus()
        .deleteSelection()
        .insertContent({
          type: 'codeBlock',
          content: [{ type: 'text', text }]
        })
        .run();
    } else {
      // Simple toggle for single line or word
      editor.chain().focus().toggleCodeBlock().run();
    }
  }, [editor]);

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // 组件卸载（切换模式）时把尚未写回的内容刷到 store；没有待同步内容就不动，避免把未编辑的文件标脏
  useEffect(() => {
    return () => { flushSyncRef.current(); };
  }, []);

  // ── 查找 / 替换：把面板状态映射为编辑器内的高亮、定位与替换 ──
  useEffect(() => {
    if (!editor) return;
    editor.commands.setSearchTerm(search.query, search.caseSensitive);
    reportSearchState(editor);
  }, [editor, search.query, search.caseSensitive]);

  useEffect(() => {
    if (!editor || !searchCommand) return;
    switch (searchCommand.type) {
      case 'next': editor.commands.findNext(); break;
      case 'prev': editor.commands.findPrev(); break;
      case 'replace': editor.commands.replaceCurrentMatch(search.replacement); break;
      case 'replaceAll': editor.commands.replaceAllMatches(search.replacement); break;
    }
    // 处理完即清掉，切换编辑模式时新挂载的编辑器不会重放这条命令
    useAppStore.getState().consumeSearchCommand();
    reportSearchState(editor);
  }, [searchCommand]);

  useEffect(() => {
    if (!editor) return;
    const handler = () => reportSearchState(editor);
    editor.on('transaction', handler);
    return () => { editor.off('transaction', handler); };
  }, [editor]);

  // 同步外部内容变更到编辑器（如切换标签或外部 AI 写入）
  useEffect(() => {
    if (!editor || !activeTab) return;

    const isTabSwitch = prevSyncTabIdRef.current !== activeTabId;
    prevSyncTabIdRef.current = activeTabId;

    const newHtml = markdownToHtml(activeTab.content);

    // 检测是否是全新的 editor 实例（切换 word/markdown 模式后 TipTap 会完全卸载重载）
    const isNewEditor = prevEditorRef.current !== editor;
    prevEditorRef.current = editor;

    if (isNewEditor) {
      // 新实例时强制用 store 中的真实内容初始化，确保 data URL 图片不丢失
      lastSyncedMdRef.current = null;
      editor.commands.setContent(newHtml, false);
      return;
    }

    // tab 切换时必须强制更新内容，不受焦点或 AI 生成状态影响
    if (!isTabSwitch) {
      // store 的这次变化如果就是本编辑器刚写回的内容，直接跳过：
      // 否则 md→html 往返的细微差异（代码块 / 表格 / 任务列表）会让下面的 setContent 把文档整个重置
      if (lastSyncedMdRef.current === activeTab.content) return;
      // 编辑器有焦点（且窗口在前台）或 AI 正在生成时跳过，避免回流冲突；窗口在后台时允许外部改动同步进来
      if ((editor.isFocused && document.hasFocus()) || aiGenerating) return;

      const currentHtml = editor.getHTML();
      // 如果当前编辑器有 data URL 图片但 newHtml 没有，说明 markdown→html 转换丢失了图片，跳过
      if (currentHtml.includes('data:image/') && !newHtml.includes('data:image/')) {
        console.warn('[Tiptap:useEffect] newHtml dropped data URL images, skipping setContent');
        return;
      }
      // 只有在 HTML 发生实质性变化时才更新
      const currentHtml2 = currentHtml;
      if (currentHtml2 !== newHtml) {
        if (currentHtml2.replace(/\s/g, '') === newHtml.replace(/\s/g, '')) return;
        editor.commands.setContent(newHtml, false);
      }
      return;
    }

    // tab 切换：直接更新内容
    lastSyncedMdRef.current = null;
    editor.commands.setContent(newHtml, false);
  }, [activeTabId, editor, activeTab?.content]);

  useEffect(() => {
    if (editor && navigationRequest) {
      const { heading } = navigationRequest;
      let foundPos = -1;
      
      editor.state.doc.descendants((node, pos) => {
        if (foundPos !== -1) return false;
        if (node.type.name === 'heading' && node.attrs.level === heading.level && node.textContent === heading.text) {
          foundPos = pos;
          return false;
        }
        return true;
      });

      if (foundPos !== -1) {
        editor.commands.focus(foundPos);
        const element = editor.view.nodeDOM(foundPos) as HTMLElement;
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    }
  }, [editor, navigationRequest]);

  const openLinkDialog = useCallback(() => {
    if (!editor) return;
    setPrompt({
      title: '插入链接',
      fields: [{ name: 'url', label: '链接地址 (URL)', defaultValue: editor.getAttributes('link').href || '' }],
      onConfirm: (values) => {
        const url = values.url;
        if (url) {
          if (editor.state.selection.empty) {
            editor.chain().focus().insertContent(`<a href="${url}">${url}</a>`).run();
          } else {
            editor.chain().focus().setLink({ href: url }).run();
          }
        } else {
          editor.chain().focus().unsetLink().run();
        }
        setPrompt(null);
      },
      onCancel: () => setPrompt(null)
    });
  }, [editor]);

  // ── 斜杠命令菜单：Suggestion 插件负责监听 `/` 与查询文本，这里只管 UI 与键盘 ──
  const [slash, setSlash] = useState<{ props: SuggestionProps<SlashItem, SlashItem>; index: number } | null>(null);
  const slashRef = useRef(slash);
  slashRef.current = slash;
  const slashActionsRef = useRef({
    openTable: () => {},
    openImage: () => setShowImageDialog(true),
    openLink: () => {},
    openAI: () => {},
  });

  useEffect(() => {
    slashMenuRegistry.items = (query) => filterSlashItems(createSlashItems({
      openTable: () => slashActionsRef.current.openTable(),
      openImage: () => slashActionsRef.current.openImage(),
      openLink: () => slashActionsRef.current.openLink(),
      openAI: () => slashActionsRef.current.openAI(),
      openDailyNote: () => useAppStore.getState().openDailyNote(),
    }), query);
    slashMenuRegistry.handlers = {
      onStart: (props) => setSlash({ props, index: 0 }),
      onUpdate: (props) => setSlash((prev) => ({ props, index: prev && prev.props.items.length === props.items.length ? prev.index : 0 })),
      onExit: () => setSlash(null),
      onKeyDown: ({ event }) => {
        const current = slashRef.current;
        if (!current) return false;
        const count = current.props.items.length;
        if (event.key === 'ArrowDown') { setSlash({ ...current, index: count ? (current.index + 1) % count : 0 }); return true; }
        if (event.key === 'ArrowUp') { setSlash({ ...current, index: count ? (current.index - 1 + count) % count : 0 }); return true; }
        if (event.key === 'Enter' || event.key === 'Tab') {
          const item = current.props.items[current.index];
          if (item) current.props.command(item);
          return true;
        }
        if (event.key === 'Escape') { setSlash(null); return true; }
        return false;
      },
    };
    return () => {
      slashMenuRegistry.handlers = null;
      slashMenuRegistry.items = () => [];
    };
  }, []);

  // ── [[ 笔记名补全 ──
  const [wiki, setWiki] = useState<{ props: SuggestionProps<WikiLinkCandidate, WikiLinkCandidate>; index: number } | null>(null);
  const wikiRef = useRef(wiki);
  wikiRef.current = wiki;
  useEffect(() => {
    wikiLinkRegistry.items = async (query) => {
      let notes: { title: string; path: string }[] = [];
      try { notes = await window.api.search.listNotes(); } catch { notes = []; }
      // 用文件名做候选（[[ ]] 里习惯写文件名），标题不同再补一条
      const byName = notes.map((n) => ({ ...n, title: (n.path.split(/[/\\]/).pop() || n.title).replace(/\.(md|markdown|mdown|mkd|txt)$/i, '') }));
      return filterWikiCandidates(byName, query);
    };
    wikiLinkRegistry.handlers = {
      onStart: (props) => setWiki({ props, index: 0 }),
      onUpdate: (props) => setWiki((prev) => ({ props, index: prev && prev.props.items.length === props.items.length ? prev.index : 0 })),
      onExit: () => setWiki(null),
      onKeyDown: ({ event }) => {
        const current = wikiRef.current;
        if (!current) return false;
        const count = current.props.items.length;
        if (event.key === 'ArrowDown') { setWiki({ ...current, index: count ? (current.index + 1) % count : 0 }); return true; }
        if (event.key === 'ArrowUp') { setWiki({ ...current, index: count ? (current.index - 1 + count) % count : 0 }); return true; }
        if (event.key === 'Enter' || event.key === 'Tab') {
          const item = current.props.items[current.index];
          if (item) current.props.command(item);
          return true;
        }
        if (event.key === 'Escape') { setWiki(null); return true; }
        return false;
      },
    };
    return () => {
      wikiLinkRegistry.handlers = null;
      wikiLinkRegistry.items = () => [];
    };
  }, []);

  const openTableDialog = useCallback(() => {
    if (!editor) return;
    setPrompt({
      title: '插入表格',
      fields: [
        { name: 'rows', label: '行数', defaultValue: '3', type: 'number' },
        { name: 'cols', label: '列数', defaultValue: '3', type: 'number' }
      ],
      onConfirm: (values) => {
        const rows = parseInt(values.rows);
        const cols = parseInt(values.cols);
        if (rows > 0 && cols > 0) {
          editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run();
        }
        setPrompt(null);
      },
      onCancel: () => setPrompt(null)
    });
  }, [editor]);

  // 对话框 / 气泡的打开函数在下面才定义，通过 ref 提供给斜杠菜单
  slashActionsRef.current.openTable = openTableDialog;
  slashActionsRef.current.openLink = openLinkDialog;
  slashActionsRef.current.openAI = () => {
    // 让 Suggestion 先退出、光标回到编辑器，再唤起气泡
    requestAnimationFrame(() => triggerAIPalette());
  };

  if (!editor) return null;

  return (
    <div className="tiptap-editor-root">
      {toolbarVisible && (
        <EditorToolbar
          editor={editor}
          onToggleHeading={handleToggleHeading}
          onToggleOrderedList={handleToggleOrderedList}
          onToggleCodeBlock={toggleSmartCodeBlock}
          onInsertTable={openTableDialog}
          onInsertImage={() => setShowImageDialog(true)}
          onInsertLink={openLinkDialog}
          onInsertMermaid={insertMermaid}
          onInsertSVG={insertSVG}
        />
      )}

      <div className="tiptap-container">
        {prompt && <PromptDialog {...prompt} />}
        {wiki && (
          <WikiLinkMenu
            items={wiki.props.items}
            selectedIndex={wiki.index}
            anchor={wiki.props.clientRect?.() ?? null}
            onSelect={(item) => wiki.props.command(item)}
            onHover={(index) => setWiki((prev) => (prev ? { ...prev, index } : prev))}
          />
        )}
        {slash && (
          <SlashMenu
            items={slash.props.items}
            selectedIndex={slash.index}
            anchor={slash.props.clientRect?.() ?? null}
            onSelect={(item) => slash.props.command(item)}
            onHover={(index) => setSlash((prev) => (prev ? { ...prev, index } : prev))}
          />
        )}
        {showImageDialog && (
          <ImageInsertDialog
            onConfirm={(src, alt) => {
              setShowImageDialog(false);
              requestAnimationFrame(() => {
                if (!editor) return;
                editor.commands.focus();
                requestAnimationFrame(() => {
                  const imageNode = editor.schema.nodes.image?.create({ src, alt: alt || null });
                  if (imageNode) {
                    editor.view.dispatch(
                      editor.state.tr.replaceSelectionWith(imageNode)
                    );
                    // 插入后主动同步，避免 data URL 在 onUpdate 时序中丢失
                    requestAnimationFrame(() => {
                      const tabId = activeTabIdRef.current;
                      if (tabId) {
                        const md = serializeDoc(editor).markdown;
                        if (md) pushToStore(tabId, md);
                      }
                    });
                  }
                });
              });
            }}
            onCancel={() => setShowImageDialog(false)}
          />
        )}
        {showStyleSelector && (
          <StyleSelector 
            onSelect={(style) => handleAIAction('polish', style)} 
            onCancel={() => setShowStyleSelector(false)} 
          />
        )}
        {showAIPalette && palettePos && ReactDOM.createPortal(
          <div 
            id="ai-palette-portal"
            style={{ 
              position: 'fixed', 
              top: palettePos.top, 
              left: palettePos.left,
              zIndex: 9999 
            }}
          >
            <AIPalette 
              onClose={() => { 
                setShowAIPalette(false); 
                setPalettePos(null); 
                editor?.chain().focus().run(); 
              }} 
              onAction={(p, useCtx, mode) => handleAIPaletteAction(p, useCtx, mode)}
              onStop={handleAIPaletteStop}
              loading={aiGenerating}
            />
          </div>,
          document.body
        )}

        <div className="tiptap-page" onClick={() => editor.chain().focus().run()} style={{
          transform: `scale(${zoom / 100})`
        }}>
          <EditorBubbleMenu
            editor={editor}
            aiGenerating={aiGenerating}
            onToggleCodeBlock={toggleSmartCodeBlock}
            onAIAction={handleAIAction}
          />

        <EditorContent 
            editor={editor} 
            onKeyDown={(e) => {
                // ⌘K：插入 / 编辑链接（有选区时给选区加链接）
                if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.code === 'KeyK') {
                    e.preventDefault();
                    openLinkDialog();
                    return;
                }
                const { selection } = editor.state;
                if (!selection.empty || aiGenerating) return;

                // 触发判定
                const { $from } = selection;
                const isAtStart = $from.parentOffset === 0;
                const isEmptyLine = $from.parent.textContent.trim() === '';

                // 1. 空格触发 (仅限行首且该行原本为空)
                if (e.key === ' ' && isAtStart && isEmptyLine && !showAIPalette) {
                    e.preventDefault();
                    triggerAIPalette();
                    return;
                }

                // 2. 行首 `/` 由 SlashCommand（Suggestion 插件）接管，打开插入菜单

                // 3. Esc 关闭
                if (e.key === 'Escape' && showAIPalette) {
                    setShowAIPalette(false);
                    setPalettePos(null);
                }
            }}
          />
        </div>
      </div>
    </div>
  );
};
