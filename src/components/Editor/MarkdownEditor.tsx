import React, { useEffect, useMemo, useRef, useState } from 'react';
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
import { markdownToHtml, htmlToMarkdown } from '../../utils/markdown';
import { sanitizeHtml } from '../../utils/sanitize';
import { resolveImagesInHtml, noteDirOf } from '../../utils/assetUrl';
import { storeImageFile } from '../../utils/pasteImage';
import { isSingleUrl, escapeLinkText, htmlWorthConverting } from '../../utils/pasteText';
import { extractHeadings } from '../../utils/outline';
import mermaid from 'mermaid';
import '../styles/editor.css';

export const MarkdownEditor: React.FC = () => {
  const { activeTabId, tabs, updateTabContent, navigationRequest, appearanceMode } = useAppStore();
  const searchState = useAppStore((s) => s.search);
  const searchCommand = useAppStore((s) => s.searchCommand);
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const editorRef = useRef<ReactCodeMirrorRef>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  // CodeMirror 的 view 是挂载后才创建的：放进 state，依赖它的 effect（滚动同步）才能在它就绪时重跑
  const [cmView, setCmView] = useState<EditorView | null>(null);

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
            const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
            storeImageFile(file, activeTabId).then((stored) => {
              if (stored && pos !== null) view.dispatch({ changes: { from: Math.min(pos, view.state.doc.length), insert: `\n![${file.name.replace(/\.[^.]+$/, '')}](${stored})\n` } });
            });
            return true;
          }
          return false;
        },
        paste(event, view) {
          const clipboard = event.clipboardData;
          if (!clipboard || !activeTabId) return false;
          const file = clipboard.files?.[0];
          if (file && file.type.startsWith('image/')) {
            event.preventDefault();
            storeImageFile(file, activeTabId).then((stored) => {
              if (!stored) return;
              const { from, to } = view.state.selection.main;
              view.dispatch({ changes: { from, to, insert: `![](${stored})` }, selection: { anchor: from + 2 } });
            });
            return true;
          }

          const text = clipboard.getData('text/plain');
          const { from, to } = view.state.selection.main;

          // 就一个网址：有选区 → [选中文字](url)；没有 → 先贴网址，取到网页标题后换成 [标题](url)
          if (isSingleUrl(text)) {
            const url = text.trim();
            event.preventDefault();
            if (from !== to) {
              const label = view.state.sliceDoc(from, to);
              view.dispatch({ changes: { from, to, insert: `[${escapeLinkText(label)}](${url})` } });
              return true;
            }
            view.dispatch({ changes: { from, to, insert: url }, selection: { anchor: from + url.length } });
            if (useAppStore.getState().fetchLinkTitle) {
              window.api.web.fetchTitle(url).then((title) => {
                // 只在那段文字还原封不动时才替换，用户已经接着改了就不打扰
                if (!title || view.state.sliceDoc(from, from + url.length) !== url) return;
                const before = view.state.sliceDoc(Math.max(0, from - 2), from);
                if (before === '](' || before.endsWith('<')) return;
                view.dispatch({ changes: { from, to: from + url.length, insert: `[${escapeLinkText(title)}](${url})` } });
              }).catch(() => {});
            }
            return true;
          }

          // 从网页 / 文档里复制的带格式内容 → 转成 Markdown；代码编辑器复制的内容仍按纯文本
          const html = clipboard.getData('text/html');
          if (html && htmlWorthConverting(html, Array.from(clipboard.types))) {
            const converted = htmlToMarkdown(sanitizeHtml(html)).trim();
            if (converted) {
              event.preventDefault();
              view.dispatch({ changes: { from, to, insert: converted }, selection: { anchor: from + converted.length } });
              return true;
            }
          }
          return false;
        },
      }),
    ],
    [activeTabId],
  );

  // 预览 HTML 只在内容变化时重算；文件里的原生 HTML / SVG 先净化再注入
  const previewHtml = useMemo(
    () => resolveImagesInHtml(sanitizeHtml(markdownToHtml(content, true)), noteDirOf(activeTabId, useAppStore.getState().getNewNoteDir())),
    [content, activeTabId],
  );

  // ── 左右滚动同步：以标题为锚点分段插值（段内按比例），比整篇按比例准得多 ──
  useEffect(() => {
    const view = cmView;
    const preview = previewRef.current;
    if (!view || !preview) return;
    const source = view.scrollDOM;
    let lock: 'source' | 'preview' | null = null;
    let unlockTimer: ReturnType<typeof setTimeout> | null = null;
    const hold = (who: 'source' | 'preview') => {
      lock = who;
      if (unlockTimer) clearTimeout(unlockTimer);
      unlockTimer = setTimeout(() => { lock = null; }, 140);
    };

    /** 两侧一一对应的锚点（像素位置，相对各自滚动内容的顶部） */
    const anchors = (): { src: number; dst: number }[] => {
      const points = [{ src: 0, dst: 0 }];
      const heads = extractHeadings(view.state.doc.toString());
      const els = Array.from(preview.querySelectorAll<HTMLElement>('h1, h2, h3, h4, h5, h6')).filter((el) => !el.closest('blockquote, .callout, .toc-block'));
      if (heads.length === els.length) {
        const previewTop = preview.getBoundingClientRect().top - preview.scrollTop;
        heads.forEach((h, i) => {
          const lineNo = Math.min(view.state.doc.lines, Number(h.id.replace('heading-', '')) + 1);
          points.push({ src: view.lineBlockAt(view.state.doc.line(lineNo).from).top, dst: els[i].getBoundingClientRect().top - previewTop });
        });
      }
      points.push({ src: Math.max(1, source.scrollHeight - source.clientHeight), dst: Math.max(1, preview.scrollHeight - preview.clientHeight) });
      return points.sort((a, b) => a.src - b.src);
    };

    const map = (value: number, from: 'src' | 'dst', to: 'src' | 'dst') => {
      const pts = anchors().sort((a, b) => a[from] - b[from]);
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        if (value >= a[from] && value <= b[from]) {
          const span = b[from] - a[from];
          return span <= 0 ? a[to] : a[to] + ((value - a[from]) / span) * (b[to] - a[to]);
        }
      }
      return pts[pts.length - 1][to];
    };

    const onSource = () => {
      if (lock === 'preview') return;
      hold('source');
      preview.scrollTop = map(source.scrollTop, 'src', 'dst');
    };
    const onPreview = () => {
      if (lock === 'source') return;
      hold('preview');
      source.scrollTop = map(preview.scrollTop, 'dst', 'src');
    };
    source.addEventListener('scroll', onSource, { passive: true });
    preview.addEventListener('scroll', onPreview, { passive: true });
    return () => {
      source.removeEventListener('scroll', onSource);
      preview.removeEventListener('scroll', onPreview);
      if (unlockTimer) clearTimeout(unlockTimer);
    };
  }, [activeTabId, cmView]);

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
            onCreateEditor={(view) => setCmView(view)}
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
        <div ref={previewRef} className="custom-scrollbar md-editor-preview-container md-pane__preview">
          <div
            className="tiptap-prosemirror markdown-body md-preview-body"
            dangerouslySetInnerHTML={{ __html: previewHtml }}
            onClick={(e) => {
              const target = e.target as HTMLElement;
              const link = target.closest('[data-wiki-link]');
              if (link) { useAppStore.getState().openWikiLink(link.getAttribute('data-wiki-link') || ''); return; }
              const tag = target.closest('.tag-chip[data-tag]');
              if (tag) { useAppStore.getState().openTag(tag.getAttribute('data-tag')); return; }
              // 目录项：在预览里滚到对应标题
              const tocItem = target.closest('[data-toc-index]');
              if (tocItem) {
                e.preventDefault();
                previewRef.current?.querySelector(`#toc-heading-${tocItem.getAttribute('data-toc-index')}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                return;
              }
              // 其它链接交给系统浏览器，别让预览面板自己跳走
              const anchor = target.closest('a[href]');
              if (anchor) {
                e.preventDefault();
                const href = anchor.getAttribute('href') || '';
                if (/^https?:|^mailto:/i.test(href)) window.api.shell.openExternal(href);
              }
            }}
          />
        </div>
      </div>
    </div>
  );

};
