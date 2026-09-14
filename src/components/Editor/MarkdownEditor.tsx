import React, { useEffect, useMemo, useRef } from 'react';
import CodeMirror, { ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { EditorView } from '@codemirror/view';
import { autocompletion, CompletionContext, CompletionResult } from '@codemirror/autocomplete';
import {
  search,
  SearchQuery,
  setSearchQuery,
  findNext,
  findPrevious,
  replaceNext,
  replaceAll,
} from '@codemirror/search';
import { useAppStore } from '../../stores/appStore';
import { markdownToHtml } from '../../utils/markdown';
import { sanitizeHtml } from '../../utils/sanitize';
import mermaid from 'mermaid';
import '../styles/editor.css';

export const MarkdownEditor: React.FC = () => {
  const { activeTabId, tabs, updateTabContent, navigationRequest, appearanceMode } = useAppStore();
  const searchState = useAppStore((s) => s.search);
  const searchCommand = useAppStore((s) => s.searchCommand);
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const editorRef = useRef<ReactCodeMirrorRef>(null);

  const isDark =
    appearanceMode === 'dark' ||
    (appearanceMode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const content = activeTab?.content ?? '';

  const handleUpdate = (val: string) => {
    if (activeTabId) {
      updateTabContent(activeTabId, val);
    }
  };

  // 目录点击 → 跳到对应行
  useEffect(() => {
    if (editorRef.current?.view && navigationRequest) {
      const view = editorRef.current.view;
      const match = navigationRequest.heading.id.match(/^heading-(\d+)$/);
      if (match) {
        const lineIndex = parseInt(match[1]);
        const safeLineIndex = Math.min(lineIndex + 1, view.state.doc.lines);
        const line = view.state.doc.line(safeLineIndex);
        view.dispatch({
          selection: { head: line.from, anchor: line.from },
          effects: [EditorView.scrollIntoView(line.from, { y: 'center' })],
        });
        view.focus();
      }
    }
  }, [navigationRequest]);

  // 预览区 Mermaid 渲染
  useEffect(() => {
    const renderMermaid = async () => {
      try {
        mermaid.initialize({
          startOnLoad: false,
          theme: isDark ? 'dark' : 'neutral',
          securityLevel: 'antiscript',
          fontFamily: 'var(--font-body)',
          // @ts-ignore
          flowchart: { useMaxWidth: true, htmlLabels: true },
          // @ts-ignore
          sequence: { useMaxWidth: true },
          // @ts-ignore
          gantt: { useMaxWidth: true },
        });
        const diagrams = document.querySelectorAll('.md-editor-preview-container .mermaid-diagram');
        if (diagrams.length > 0) {
          await mermaid.run({ nodes: Array.from(diagrams) as HTMLElement[] });
        }
      } catch (err) {
        console.error('Mermaid rendering failed in MD preview:', err);
      }
    };
    const timer = setTimeout(renderMermaid, 50);
    return () => clearTimeout(timer);
  }, [content, isDark]);

  // ── 查找 / 替换：与 FindReplacePanel 通过 store 联动 ──
  // 匹配范围缓存：只在文档或查找条件变化时重扫，光标移动时只在缓存里定位
  const matchesRef = useRef<{ from: number; to: number }[]>([]);

  const recomputeMatches = (view: EditorView) => {
    const { query, caseSensitive } = useAppStore.getState().search;
    const ranges: { from: number; to: number }[] = [];
    if (query) {
      const cursor = new SearchQuery({ search: query, caseSensitive, literal: true }).getCursor(view.state.doc);
      for (let r = cursor.next(); !r.done; r = cursor.next()) ranges.push({ from: r.value.from, to: r.value.to });
    }
    matchesRef.current = ranges;
  };

  const reportCounts = (view: EditorView) => {
    const sel = view.state.selection.main;
    const idx = matchesRef.current.findIndex((m) => m.from === sel.from && m.to === sel.to);
    useAppStore.getState().setSearchCounts(matchesRef.current.length, idx + 1);
  };

  const pushQuery = (view: EditorView) => {
    const { query, caseSensitive, replacement } = useAppStore.getState().search;
    view.dispatch({
      effects: setSearchQuery.of(new SearchQuery({ search: query, caseSensitive, replace: replacement, literal: true })),
    });
  };

  // 查找条件变化、或切换标签（扩展会重新实例化）时重新下发查询
  useEffect(() => {
    const view = editorRef.current?.view;
    if (!view) return;
    pushQuery(view);
    recomputeMatches(view);
    if (searchState.query) findNext(view);
    reportCounts(view);
  }, [searchState.query, searchState.caseSensitive, activeTabId]);

  useEffect(() => {
    const view = editorRef.current?.view;
    if (!view || !searchCommand) return;
    if (useAppStore.getState().search.query) {
      pushQuery(view);
      switch (searchCommand.type) {
        case 'next': findNext(view); break;
        case 'prev': findPrevious(view); break;
        case 'replace': replaceNext(view); break;
        case 'replaceAll': replaceAll(view); break;
      }
      recomputeMatches(view);
      reportCounts(view);
    }
    // 处理完即清掉，切换编辑模式时新挂载的编辑器不会重放这条命令
    useAppStore.getState().consumeSearchCommand();
  }, [searchCommand]);

  // 源码模式里输入 [[ 时补全笔记名
  const wikiCompletion = async (context: CompletionContext): Promise<CompletionResult | null> => {
    const word = context.matchBefore(/\[\[[^\]\n]*/);
    if (!word) return null;
    let notes: { title: string; path: string }[] = [];
    try { notes = await window.api.search.listNotes(); } catch { notes = []; }
    const names = [...new Set(notes.map((n) => (n.path.split(/[/\\]/).pop() || n.title).replace(/\.(md|markdown|mdown|mkd|txt)$/i, '')))];
    return {
      from: word.from + 2,
      options: names.map((name) => ({ label: name, apply: `${name}]]`, type: 'text' })),
      validFor: /^[^\]\n]*$/,
    };
  };

  const extensions = useMemo(
    () => [
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      search(),
      autocompletion({ override: [wikiCompletion], activateOnTyping: true }),
      EditorView.updateListener.of((update) => {
        if (!useAppStore.getState().search.query) return;
        if (update.docChanged) recomputeMatches(update.view);
        if (update.docChanged || update.selectionSet) reportCounts(update.view);
      }),
      EditorView.domEventHandlers({
        drop(event, view) {
          const file = event.dataTransfer?.files?.[0];
          if (file && file.type.startsWith('image/') && activeTabId) {
            event.preventDefault();
            file.arrayBuffer().then((buffer) => {
              window.api.fs.saveImage(activeTabId, file.name, buffer).then((result) => {
                if (result.success && result.path) {
                  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
                  if (pos !== null) {
                    view.dispatch({ changes: { from: pos, insert: `\n![${file.name}](${result.path})\n` } });
                  }
                }
              });
            });
            return true;
          }
          return false;
        },
        paste(event, view) {
          const file = event.clipboardData?.files?.[0];
          if (file && file.type.startsWith('image/') && activeTabId) {
            event.preventDefault();
            file.arrayBuffer().then((buffer) => {
              window.api.fs.saveImage(activeTabId, file.name, buffer).then((result) => {
                if (result.success && result.path) {
                  const { from } = view.state.selection.main;
                  view.dispatch({ changes: { from, insert: `\n![${file.name}](${result.path})\n` } });
                }
              });
            });
            return true;
          }
          return false;
        },
      }),
    ],
    [activeTabId],
  );

  // 预览 HTML 只在内容变化时重算；文件里的原生 HTML / SVG 先净化再注入
  const previewHtml = useMemo(() => sanitizeHtml(markdownToHtml(content, true)), [content]);

  if (!activeTab) return null;

  return (
    <div className="md-split">
      <div className="md-pane md-pane--source">
        <div className="md-pane__header">SOURCE CODE</div>
        <div className="md-pane__body md-editor-source">
          <CodeMirror
            ref={editorRef}
            value={content}
            height="100%"
            theme={isDark ? 'dark' : 'light'}
            className="cm-theme-override"
            extensions={extensions}
            onChange={handleUpdate}
            basicSetup={{
              lineNumbers: true,
              highlightActiveLineGutter: true,
              highlightActiveLine: true,
              // 查找由应用统一的面板接管（⌘F），关闭 CodeMirror 自带的搜索快捷键
              searchKeymap: false,
              // 补全只保留 [[ 笔记名（上面单独配置）
              autocompletion: false,
            }}
          />
        </div>
      </div>

      <div className="md-pane md-pane--preview">
        <div className="md-pane__header">PREVIEW</div>
        <div className="custom-scrollbar md-editor-preview-container md-pane__preview">
          <div
            className="tiptap-prosemirror markdown-body md-preview-body"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
            onClick={(e) => {
              const link = (e.target as HTMLElement).closest('[data-wiki-link]');
              if (link) useAppStore.getState().openWikiLink(link.getAttribute('data-wiki-link') || '');
            }}
          />
        </div>
      </div>
    </div>
  );

};
