import { describe, expect, it, afterEach } from 'vitest';
import { Editor } from '@tiptap/core';
import { editorExtensions } from '../components/Editor/editorExtensions';
import { markdownToHtml } from '../utils/markdown';
import { serializeDoc } from '../utils/incrementalMarkdown';
import { moveBlock } from './MoveBlock';

let editor: Editor | null = null;
afterEach(() => { editor?.destroy(); editor = null; });
const open = (md: string) => { editor = new Editor({ extensions: editorExtensions, content: markdownToHtml(md) }); return editor; };
/** 把光标放进第一个文字是 text 的文本块里，偏移 offset 个字符 */
const caretIn = (text: string, offset = 1) => {
  let at = -1;
  editor!.state.doc.descendants((n, p) => { if (at === -1 && n.isTextblock && n.textContent === text) at = p + 1 + offset; });
  expect(at).toBeGreaterThan(-1);
  editor!.commands.setTextSelection(at);
};
const move = (dir: -1 | 1) => moveBlock(editor!.state, dir, editor!.view.dispatch);
const md = () => serializeDoc(editor!).markdown;

describe('整块上移 / 下移', () => {
  it('列表项和同层的兄弟换位置，子项跟着走；光标留在原来那个字旁边', () => {
    open('- 甲\n- 乙\n  - 乙一\n  - 乙二\n- 丙');
    caretIn('乙');
    move(-1);
    expect(md()).toBe('- 乙\n  - 乙一\n  - 乙二\n- 甲\n- 丙');
    expect(editor!.state.selection.$from.parent.textContent).toBe('乙');
    move(1); move(1);
    expect(md()).toBe('- 甲\n- 丙\n- 乙\n  - 乙一\n  - 乙二');
  });

  it('子项只在自己那一层里挪，不会跑到父项外面；到头了就不动', () => {
    open('- 甲\n  - 甲一\n  - 甲二\n- 乙');
    caretIn('甲二');
    move(-1);
    expect(md()).toBe('- 甲\n  - 甲二\n  - 甲一\n- 乙');
    const before = md();
    expect(move(-1)).toBe(true);
    expect(md()).toBe(before);
  });

  it('任务列表照样能挪，勾选状态跟着走', () => {
    open('- [x] 做完的\n- [ ] 没做的');
    caretIn('没做的');
    move(-1);
    expect(md()).toBe('- [ ] 没做的\n- [x] 做完的');
  });

  it('不在列表里：挪的是最外层那一块（段落、标题、代码块）', () => {
    open('# 标题\n\n第一段\n\n```js\ncode\n```\n\n第二段');
    caretIn('第二段');
    move(-1);
    expect(md()).toBe('# 标题\n\n第一段\n\n第二段\n\n```js\ncode\n```');
    caretIn('标题');
    move(1);
    expect(md().startsWith('第一段\n\n# 标题')).toBe(true);
  });

  it('属性块钉在最前面：别的块挪不到它上面，它自己也挪不动', () => {
    open('---\ntags: [a]\n---\n\n第一段\n\n第二段');
    caretIn('第一段');
    const before = md();
    move(-1);
    expect(md()).toBe(before);
  });

  it('选中的是一个原子块（嵌入）：挪的就是它', () => {
    open('第一段\n\n![[周会]]\n\n第二段');
    let pos = -1;
    editor!.state.doc.descendants((n, p) => { if (n.type.name === 'wikiEmbed') pos = p; });
    editor!.commands.setNodeSelection(pos);
    move(1);
    expect(md()).toBe('第一段\n\n第二段\n\n![[周会]]');
  });
});
