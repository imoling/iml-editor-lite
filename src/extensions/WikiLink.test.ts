import { describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import { editorExtensions } from '../components/Editor/editorExtensions';
import { markdownToHtml, htmlToMarkdown } from '../utils/markdown';
import { filterWikiCandidates } from './WikiLinkSuggestion';

describe('WikiLink 节点', () => {
  it('从 Markdown 载入后是原子节点，序列化回 [[ ]]', () => {
    const editor = new Editor({ extensions: editorExtensions, content: markdownToHtml('见 [[苹果]] 和 [[苹果|别名]]') });
    const nodes: string[] = [];
    editor.state.doc.descendants((n) => { if (n.type.name === 'wikiLink') nodes.push(`${n.attrs.target}|${n.attrs.label}`); });
    expect(nodes).toEqual(['苹果|苹果', '苹果|别名']);
    expect(htmlToMarkdown(editor.getHTML())).toBe('见 [[苹果]] 和 [[苹果|别名]]');
    editor.destroy();
  });

  it('候选过滤：包含匹配，无精确匹配时追加新建项', () => {
    const notes = [{ title: '苹果', path: '/a/苹果.md' }, { title: '香蕉', path: '/a/香蕉.md' }];
    expect(filterWikiCandidates(notes, '').map((c) => c.title)).toEqual(['苹果', '香蕉']);
    expect(filterWikiCandidates(notes, '苹').map((c) => [c.title, !!c.create])).toEqual([['苹果', false], ['苹', true]]);
    expect(filterWikiCandidates(notes, '苹果').map((c) => !!c.create)).toEqual([false]);
  });

  it('候选过滤：名字没中再看别名；别名精确命中就不再给「新建」', () => {
    const notes = [{ title: 'apple', path: '/a/apple.md', aliases: ['苹果', '红富士'] }, { title: '香蕉', path: '/a/香蕉.md' }];
    expect(filterWikiCandidates(notes, '红富').map((c) => [c.title, c.alias, !!c.create])).toEqual([['apple', '红富士', false], ['红富', undefined, true]]);
    expect(filterWikiCandidates(notes, '苹果').map((c) => [c.title, c.alias])).toEqual([['apple', '苹果']]);
    // 名字本身命中时不带别名，照常插入 [[apple]]
    expect(filterWikiCandidates(notes, 'app').map((c) => [c.title, c.alias, !!c.create])).toEqual([['apple', undefined, false], ['app', undefined, true]]);
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
