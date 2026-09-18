import { describe, expect, it } from 'vitest';
import { isSingleUrl, escapeLinkText, htmlWorthConverting } from './pasteText';
import { fitSize, formatBytes } from './pasteImage';

describe('isSingleUrl', () => {
  it('只认单独一个 http(s) 网址', () => {
    expect(isSingleUrl(' https://example.com/a?b=1#c ')).toBe(true);
    expect(isSingleUrl('看这个 https://example.com')).toBe(false);
    expect(isSingleUrl('https://a.com https://b.com')).toBe(false);
    expect(isSingleUrl('ftp://example.com')).toBe(false);
    expect(isSingleUrl('')).toBe(false);
  });
});

describe('escapeLinkText', () => {
  it('转义方括号与反斜杠', () => {
    expect(escapeLinkText('[置顶] 标题 \\ 副标题')).toBe('\\[置顶\\] 标题 \\\\ 副标题');
  });
});

describe('htmlWorthConverting', () => {
  it('带结构的 HTML 才转', () => {
    expect(htmlWorthConverting('<p>见 <a href="https://a.b">链接</a></p>')).toBe(true);
    expect(htmlWorthConverting('<h2>标题</h2><ul><li>项</li></ul>')).toBe(true);
    expect(htmlWorthConverting('<meta charset="utf-8"><span style="color:#000">纯文字</span>')).toBe(false);
  });

  it('代码编辑器复制的内容按纯文本处理', () => {
    expect(htmlWorthConverting('<div><span style="color:#569cd6">const</span> a = 1;</div>', ['text/plain', 'text/html', 'vscode-editor-data'])).toBe(false);
    expect(htmlWorthConverting('<pre><code>const a = 1;</code></pre>')).toBe(false);
  });

  it('Google Docs 的假加粗包装不算结构', () => {
    expect(htmlWorthConverting('<b style="font-weight:normal"><span>普通文字</span></b>')).toBe(false);
  });
});

describe('图片压缩的尺寸与提示', () => {
  it('等比缩到上限以内，不放大', () => {
    expect(fitSize(5120, 2880)).toEqual({ width: 2560, height: 1440 });
    expect(fitSize(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitSize(1000, 30000)).toEqual({ width: 400, height: 12000 });
  });

  it('formatBytes', () => {
    expect(formatBytes(3.2 * 1024 * 1024)).toBe('3.2 MB');
    expect(formatBytes(410 * 1024)).toBe('410 KB');
  });
});
