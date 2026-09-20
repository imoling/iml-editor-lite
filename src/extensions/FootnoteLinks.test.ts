import { describe, expect, it, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { editorExtensions } from '../components/Editor/editorExtensions';
import { markdownToHtml } from '../utils/markdown';
import { serializeDoc } from '../utils/incrementalMarkdown';
import { registerSource } from '../utils/sourceMap';
import { findFootnoteRefs, findFootnoteDef, jumpToFootnote } from './FootnoteLinks';

const MD = '正文[^1] 和 `代码里的[^1]` 以及[^note]，还有[^没定义]。\n\n第二段。\n\n[^1]: 第一条脚注\n[^note]: 第二条\n    续行';
let editor: Editor | null = null;
afterEach(() => { editor?.destroy(); editor = null; });
const open = () => { const host = document.createElement('div'); document.body.appendChild(host); editor = new Editor({ element: host, extensions: editorExtensions, content: markdownToHtml(MD) }); registerSource(editor, MD); return host; };

describe('富文本里的脚注', () => {
  it('找出正文里的引用，行内代码里的不算', () => {
    open();
    expect(findFootnoteRefs(editor!.state.doc).map((r) => r.id)).toEqual(['1', 'note', '没定义']);
    const first = findFootnoteRefs(editor!.state.doc)[0];
    expect(editor!.state.doc.textBetween(first.from, first.to)).toBe('[^1]');
  });

  it('引用带着脚注内容当提示；没有定义的那条样子不同、提示说明原因', () => {
    const host = open();
    const refs = Array.from(host.querySelectorAll<HTMLElement>('[data-footnote-ref]'));
    expect(refs.map((r) => [r.dataset.footnoteRef, r.title])).toEqual([['1', '第一条脚注'], ['note', '第二条 续行'], ['没定义', '没有这条脚注的定义']]);
    expect(refs[2].classList.contains('footnote-ref-inline--missing')).toBe(true);
  });

  it('点引用：选中它的定义所在的块；没有定义的返回 false（让点击照常落光标）', () => {
    open();
    expect(jumpToFootnote(editor!.view, 'note')).toBe(true);
    const sel = editor!.state.selection as any;
    expect(sel.node?.type.name).toBe('rawBlock');
    expect(String(sel.node.attrs.raw)).toContain('[^note]: 第二条');
    expect(findFootnoteDef(editor!.state.doc, '没定义')).toBe(-1);
    expect(jumpToFootnote(editor!.view, '没定义')).toBe(false);
  });

  it('只是装饰：存盘内容和原文一字不差', () => {
    open();
    jumpToFootnote(editor!.view, '1');
    expect(serializeDoc(editor!).markdown).toBe(MD);
  });
});
