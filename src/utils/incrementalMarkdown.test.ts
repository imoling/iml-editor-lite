import { describe, expect, it, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { editorExtensions } from '../components/Editor/editorExtensions';
import { markdownToHtml, htmlToMarkdown } from './markdown';
import { serializeDoc } from './incrementalMarkdown';

const SAMPLE = [
  '# 标题',
  '',
  '第一段 **粗体** 和 [链接](https://a.b)',
  '',
  '- 甲',
  '- 乙',
  '',
  '1. 一',
  '2. 二',
  '',
  '> 引用',
  '',
  '```js',
  'const a = 1;',
  '```',
  '',
  '| 名称 | 数量 |',
  '| --- | --- |',
  '| 苹果 | 3 |',
  '',
  '- [x] 完成',
  '- [ ] 未完成',
  '',
  '![](data:image/png;base64,iVBORw0KGgo=)',
  '',
  '```mermaid',
  'graph TD',
  'A-->B',
  '```',
].join('\n');

let editor: Editor | null = null;
/** 整篇转换在列表项末尾会留下只含空格的行；增量版按块 trim 后更干净。比较时把这种差异归一化 */
const norm = (s: string) => s.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n');
afterEach(() => { editor?.destroy(); editor = null; });

describe('serializeDoc（增量序列化）', () => {
  it('结果与整篇转换完全一致', () => {
    editor = new Editor({ extensions: editorExtensions, content: markdownToHtml(SAMPLE) });
    const whole = htmlToMarkdown(editor.getHTML());
    const incremental = serializeDoc(editor);
    expect(norm(incremental.markdown)).toBe(norm(whole));
    expect(incremental.hasDataImage).toBe(true);
  });

  it('编辑一个块后其它块复用缓存，结果仍与整篇转换一致', () => {
    editor = new Editor({ extensions: editorExtensions, content: markdownToHtml(SAMPLE) });
    serializeDoc(editor);
    editor.commands.insertContentAt(1, '新');
    editor.commands.insertContentAt(editor.state.doc.content.size, '<p>末尾新段落</p>');
    const whole = htmlToMarkdown(editor.getHTML());
    expect(norm(serializeDoc(editor).markdown)).toBe(norm(whole));
    expect(whole.startsWith('# 新标题')).toBe(true);
    expect(whole.endsWith('末尾新段落')).toBe(true);
  });

  it('空文档返回空串且没有 data 图片', () => {
    editor = new Editor({ extensions: editorExtensions, content: '' });
    expect(serializeDoc(editor)).toEqual({ markdown: '', hasDataImage: false });
  });
});
