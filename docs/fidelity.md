# 保真机制：为什么保存不会把文件改花

富文本模式走的是 `Markdown → HTML → ProseMirror 文档 → HTML → Markdown`。这条链路只能做到**语义等价**，做不到逐字相同 —— 所以 26.2 在它外面加了三道保险。动这部分代码前先读完这一页，并跑 `src/utils/fidelity.test.ts` 与 `src/utils/sourceMap.test.ts`。

## 1. 未编辑的块写回原文（`src/utils/sourceMap.ts` + `incrementalMarkdown.ts`）

- 打开文档时，用 marked 的词法器把原文切成顶层块，记下每块的原文 `raw` 和它与下一块之间的原文 `gap`（空行、被 marked 吞掉的链接引用定义）。
- ProseMirror 节点不可变：没碰过的块在新文档里还是同一个对象。`WeakMap<节点, 原文块>` 记下对应关系。
- 保存时逐个顶层节点看：认得出就输出原文，认不出（编辑过 / 新插入）才走转换。两块都是原文且本来相邻，连 `gap` 也原样搬回。
- 块与节点对不上（数目不符或类型不兼容）就整篇放弃，退回转换，不会错配。
- 链接引用定义在编辑器里不可见，没能随 `gap` 带回来的会补在文末。
- CRLF、文件末尾的换行按原文件保持。
- 每次 `setContent` 之后都要 `registerSource(editor, markdown)`；AI 回滚用文档节点快照（不是 HTML），对照关系才不会断。

## 2. 表达不了的内容原样保留（`src/extensions/RawHtml.ts`、`Frontmatter.ts` 等）

编辑器的文档模型没有对应节点的内容，不交给转换器，而是把原文整段存在节点属性里（base64，见 `encodeRaw`）：

| 内容 | 节点 |
|---|---|
| frontmatter | `frontmatter`（整块含 `---`） |
| HTML 块、注释、带宽高的 `<img>`、脚注定义 | `rawBlock` |
| 成对的未知行内 HTML、行内注释、与文字同段的图片、带链接的图片 | `rawInline` |
| `$…$`、单行 `$$…$$` | `inlineMath` |
| `[TOC]` | `toc` |

注意 turndown 会把**没有文本内容**的元素当空白丢掉，所以这些节点的 `renderHTML` 都带着文本。

## 3. 转换本身尽量不多事（`src/utils/markdown.ts`、`markdownEscape.ts`）

- 转义只在字符真的会被解析成语法时才加（词内下划线、不构成链接的方括号、后面不是标点的反斜杠都不动）。行首规则只对块首的文本节点生效：段落中间的节点由 `MID_LINE_MARK` 标出来。
- 列表用 `- `、紧凑排版、续行按标记宽度缩进；任务项与普通项共用一套规则。
- 源文件里的单个换行（`breaks` 模式）标成 `data-soft`，写回单个换行；编辑器里新敲的 Shift+Enter 用标准的「两个空格 + 换行」。
- 链接 / 图片地址保持原文（不 `encodeURI`）；自动链接按原写法（裸链接 / `<url>`）写回。

## 已知的、有意的规范化（只发生在被编辑过的块上）

- 找不到配对的尖括号标签（`List<String>`）当作文字保留，保存为 `List\<String>`
- Setext 标题 → ATX；`~~~` 围栏 → ` ``` `；`***` → `---`；`*` / `+` 列表 → `-`
- 引用式链接展开成行内链接（定义本身保留）
- HTML 实体解码（`&copy;` → `©`）

## 怎么验证

```bash
npx vitest run src/utils/fidelity.test.ts src/utils/sourceMap.test.ts
```

端到端：把一个笔记库放进 Git，用富文本模式打开一篇、改一个字、保存，`git diff` 应该只有那一行。
