import type { Editor } from '@tiptap/core';
import { Selection, EditorState } from '@tiptap/pm/state';
import type { Node as PMNode } from '@tiptap/pm/model';
import { lexTopLevel, markdownToHtml } from './markdown';
import { splitFrontmatter } from '../../electron/shared/noteMeta';

/**
 * 原文对照表：保存时，没被编辑过的块直接写回它在文件里的原文。
 *
 * 再好的「Markdown → 富文本 → Markdown」转换也只能做到语义等价，做不到逐字相同 ——
 * 表格的对齐填充、`*` 还是 `-`、标题后面空不空行、Setext 标题、行尾换行……每个人、每个工具的写法都不一样。
 * ProseMirror 的节点不可变：没碰过的块在新文档里还是同一个对象。打开文件时记下「这个节点对象 ← 这段原文」，
 * 保存时认得出对象就用原文，认不出（被编辑过、新插入的）才走转换。
 */
export interface SourceBlock {
  type: string;
  raw: string;
  /** 这一块之后、下一块之前的原文：空行，以及不产生任何节点的内容（链接引用定义） */
  gap: string;
  /** gap 里的链接引用定义：编辑器里看不见也删不掉，保存时无论如何都要留住 */
  defs: string[];
  /** 这段原文在编辑器里对应几个顶层节点（普通项与任务项混排的列表会被拆成几个） */
  nodeCount: number;
}

export interface SourceMap {
  /** 第一块之前的原文（开头的空行；定义写在文件最前面时也在这里） */
  head: string;
  headDefs: string[];
  blocks: SourceBlock[];
  eol: '\n' | '\r\n';
  endsWithNewline: boolean;
  origin: WeakMap<PMNode, { block: number; part: number }>;
}

const sourceMaps = new WeakMap<Editor, SourceMap>();

export function getSourceMap(editor: Editor): SourceMap | null {
  return sourceMaps.get(editor) ?? null;
}

export function clearSourceMap(editor: Editor) {
  sourceMaps.delete(editor);
}

/** 原文块类型 → 它在编辑器里可能变成的节点类型；对不上说明块与节点没有一一对应，整篇放弃原文保留 */
const COMPATIBLE: Record<string, string[]> = {
  frontmatter: ['frontmatter'],
  heading: ['heading'],
  paragraph: ['paragraph', 'image', 'math', 'toc', 'wikiEmbed'],
  text: ['paragraph'],
  code: ['codeBlock', 'diagram', 'svgBlock'],
  list: ['bulletList', 'orderedList', 'taskList'],
  blockquote: ['blockquote', 'callout'],
  table: ['table'],
  hr: ['horizontalRule'],
  html: ['rawBlock', 'image'],
  footnoteDef: ['rawBlock'],
};

function splitBlocks(markdown: string): { head: string; headDefs: string[]; blocks: SourceBlock[] } | null {
  const fm = splitFrontmatter(markdown);
  const blocks: SourceBlock[] = [];
  let head = '';
  const headDefs: string[] = [];
  const pushDef = (text: string) => (blocks.length ? blocks[blocks.length - 1].defs : headDefs).push(text);
  const pushGap = (text: string) => {
    if (blocks.length) blocks[blocks.length - 1].gap += text;
    else head += text;
  };
  if (fm.block !== null) {
    blocks.push({ type: 'frontmatter', raw: fm.block, gap: markdown.slice(fm.block.length, markdown.length - fm.body.length), defs: [], nodeCount: 1 });
  }
  // marked 会把链接引用定义（[ref]: url）从词法结果里直接吞掉，不给 token。
  // 所以按位置对：每个 token 的 raw 必须能在游标之后找到，中间跳过的文字就是被吞掉的定义，连同空行一起算进 gap
  const body = fm.body;
  let cursor = 0;
  for (const token of lexTopLevel(body)) {
    const at = body.indexOf(token.raw, cursor);
    if (at < 0) return null; // 词法器改写了输入，对不上就不冒险
    const skipped = body.slice(cursor, at);
    if (skipped) {
      if (skipped.trim()) pushDef(skipped.trim());
      pushGap(skipped);
    }
    cursor = at + token.raw.length;
    if (token.type === 'space') { pushGap(token.raw); continue; }
    if (token.type === 'def') {
      pushDef(token.raw.replace(/\n+$/, ''));
      pushGap(token.raw);
      continue;
    }
    const raw = token.raw.replace(/\n+$/, '');
    blocks.push({ type: token.type, raw, gap: token.raw.slice(raw.length), defs: [], nodeCount: 1 });
  }
  const rest = body.slice(cursor);
  if (rest) {
    if (rest.trim()) pushDef(rest.trim());
    pushGap(rest);
  }
  return { head, headDefs, blocks };
}

const topLevelCount = (html: string) => new DOMParser().parseFromString(html, 'text/html').body.children.length;

/** 打开 / 重载文档后调用：doc 必须是刚由这份 markdown 生成、尚未编辑的文档 */
export function registerSource(editor: Editor, markdown: string): SourceMap | null {
  sourceMaps.delete(editor);
  if (!markdown) return null;
  const eol: SourceMap['eol'] = /\r\n/.test(markdown) && !/[^\r]\n/.test(markdown) ? '\r\n' : '\n';
  const text = markdown.replace(/\r\n/g, '\n');
  const split = splitBlocks(text);
  if (!split) return null;
  const { head, headDefs, blocks } = split;
  const doc = editor.state.doc;

  // 大多数文档里块与节点一一对应；数目对不上时再逐块数（混排列表等一块对多个节点的情况）
  if (blocks.length !== doc.childCount) {
    for (const b of blocks) if (b.type !== 'frontmatter') b.nodeCount = Math.max(1, topLevelCount(markdownToHtml(b.raw)));
    if (blocks.reduce((sum, b) => sum + b.nodeCount, 0) !== doc.childCount) return null;
  }

  const origin = new WeakMap<PMNode, { block: number; part: number }>();
  let index = 0;
  for (let i = 0; i < blocks.length; i++) {
    const allowed = COMPATIBLE[blocks[i].type];
    for (let part = 0; part < blocks[i].nodeCount; part++) {
      const node = doc.child(index++);
      if (allowed && !allowed.includes(node.type.name)) return null;
      origin.set(node, { block: i, part });
    }
  }

  const map: SourceMap = { head, headDefs, blocks, eol, endsWithNewline: text.endsWith('\n'), origin };
  sourceMaps.set(editor, map);
  return map;
}

/**
 * 换成另一篇笔记的内容，并把撤销历史清空。
 *
 * 所有标签页共用一个编辑器实例。只 setContent 的话，「载入新文档」这一步也在撤销栈里：
 * 切到另一篇之后随手按一下 ⌘Z，上一篇的整篇内容就被「撤销」回来、写进了当前这篇——开着自动保存时，磁盘上的文件会被另一篇笔记覆盖。
 * ProseMirror 没有「清空历史」的接口，通行的做法是用同一份文档、同一批插件重建一次状态：文档节点对象不变，历史是新的。
 */
export function loadDocFresh(editor: Editor, html: string) {
  editor.commands.setContent(html, false);
  const { state, view } = editor;
  view.updateState(EditorState.create({ doc: state.doc, plugins: state.plugins }));
}

/**
 * 内容加载后把光标放进第一个文本块。
 * setContent 之后选区会落在文档末尾或开头的节点上；如果那正好是个原子块（开头的属性块、文末的脚注定义），
 * 一打开就是一个选中框，更糟的是此时打字会把整个块替换掉。
 */
export function placeCursorAfterFrontmatter(editor: Editor) {
  const { doc, tr } = editor.state;
  let target = -1;
  doc.descendants((node, pos) => {
    if (target >= 0) return false;
    if (node.isTextblock) { target = pos + 1; return false; }
    return true;
  });
  if (target < 0) return;
  editor.view.dispatch(tr.setSelection(Selection.near(doc.resolve(target))).setMeta('addToHistory', false));
}
