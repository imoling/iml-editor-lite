import { describe, expect, it, beforeEach } from 'vitest';
import { sanitizeUserCss, applyUserCss, snippetsPathOf, SNIPPETS_TEMPLATE } from './userCss';

beforeEach(() => { document.getElementById('iml-user-snippets')?.remove(); });

describe('用户 CSS 片段', () => {
  it('普通样式原样通过；data: 地址和本地变量引用不受影响', () => {
    const css = '.tiptap-prosemirror h1 { color: var(--color-brand-indigo); background: url("data:image/png;base64,AAAA"); }';
    expect(sanitizeUserCss(css)).toBe(css);
  });

  it('会联网的写法去掉：@import、http / https / 协议相对地址；别的声明留着', () => {
    const out = sanitizeUserCss('@import url("https://evil.example/x.css");\n@import "//cdn/x.css";\nh1 { background: url(https://t.example/p.png?u=1); color: red; }\nh2 { background: url( \'//t.example/a.png\' ) }');
    expect(out).not.toMatch(/evil|t\.example|cdn/);
    expect(out).toContain('color: red');
    expect(out).toContain('h2 {');
  });

  it('不能靠 </style> 从样式表里跳出去；超大的文件整个不要', () => {
    expect(sanitizeUserCss('h1{color:red}</style><script>alert(1)</script>')).not.toContain('</style>');
    expect(sanitizeUserCss('a{}'.repeat(80000))).toBe('');
  });

  it('注入在 head 最后、重复调用只更新不重复加；传空就撤掉', () => {
    applyUserCss('h1 { color: red; }');
    applyUserCss('h1 { color: blue; }');
    const els = document.querySelectorAll('#iml-user-snippets');
    expect(els).toHaveLength(1);
    expect(els[0].textContent).toBe('h1 { color: blue; }');
    expect(document.head.lastElementChild).toBe(els[0]);
    applyUserCss('   ');
    expect(document.getElementById('iml-user-snippets')).toBeNull();
  });

  it('注释里提到 @import 不会把后面的注释弄坏（曾经一路吃到下一个分号，还提前关掉了外层注释）', () => {
    const css = '/* 说明：@import 会被忽略\n   下一行 */\n/* h1 { color: red; } */\nh2 { color: blue; }';
    const out = sanitizeUserCss(css);
    expect(out.replace(/\/\*[\s\S]*?\*\//g, '').trim()).toBe('h2 { color: blue; }');
  });

  it('示例模板全是注释：第一次建文件不会改变任何外观', () => {
    expect(sanitizeUserCss(SNIPPETS_TEMPLATE).replace(/\/\*[\s\S]*?\*\//g, '').trim()).toBe('');
  });

  it('片段文件的位置', () => {
    expect(snippetsPathOf('/Users/me/笔记/')).toBe('/Users/me/笔记/.iml/snippets.css');
    expect(snippetsPathOf('C:\\笔记')).toBe('C:\\笔记\\.iml\\snippets.css');
  });
});
