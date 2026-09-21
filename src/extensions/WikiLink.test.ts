import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { editorExtensions } from '../components/Editor/editorExtensions';
import { markdownToHtml, htmlToMarkdown } from '../utils/markdown';

describe('WikiLink 节点', () => {
  it('从 Markdown 载入后是原子节点，序列化回 [[ ]]', () => {
    const editor = new Editor({ extensions: editorExtensions, content: markdownToHtml('见 [[苹果]] 和 [[苹果|别名]]') });
    const nodes: string[] = [];
    editor.state.doc.descendants((n) => { if (n.type.name === 'wikiLink') nodes.push(`${n.attrs.target}|${n.attrs.label}`); });
    expect(nodes).toEqual(['苹果|苹果', '苹果|别名']);
    expect(htmlToMarkdown(editor.getHTML())).toBe('见 [[苹果]] 和 [[苹果|别名]]');
    editor.destroy();
  });

  it('[[笔记#小节]] 整串是目标，往返不变', () => {
    const md = '见 [[周会#本周#待办]]、[[#本篇小节]] 和 [[周会#^blk|那段话]]';
    const editor = new Editor({ extensions: editorExtensions, content: markdownToHtml(md) });
    const targets: string[] = [];
    editor.state.doc.descendants((n) => { if (n.type.name === 'wikiLink') targets.push(n.attrs.target); });
    expect(targets).toEqual(['周会#本周#待办', '#本篇小节', '周会#^blk']);
    expect(htmlToMarkdown(editor.getHTML())).toBe(md);
    editor.destroy();
  });
});
