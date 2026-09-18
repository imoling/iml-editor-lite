import { Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey, NodeSelection, Selection } from '@tiptap/pm/state';
import { encodeRaw, decodeRaw } from '../utils/markdown';
import { parseFrontmatter, buildFrontmatterBlock, frontmatterYaml } from '../../electron/shared/noteMeta';
import { createSourceNodeView } from './sourceNodeView';

const COLLAPSE_KEY = 'iml_frontmatter_collapsed';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    frontmatter: {
      /** 文档开头没有属性块时插入一个 */
      insertFrontmatter: (yaml?: string) => ReturnType;
    };
  }
}

/**
 * 文档开头的 YAML frontmatter。原文（连同两条 ---）整块存在属性里，保存时原样写回：
 * 注释、缩进、引号、字段顺序都不动。展示成可折叠的属性卡片，双击或点「编辑」改 YAML 原文。
 */
export const Frontmatter = Node.create({
  name: 'frontmatter',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,
  isolating: true,

  addAttributes() {
    return {
      raw: {
        default: '---\n---',
        parseHTML: (el: HTMLElement) => decodeRaw(el.getAttribute('data-raw')) || '---\n---',
        renderHTML: (attrs: Record<string, any>) => ({ 'data-raw': encodeRaw(attrs.raw) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-frontmatter]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    // 带上文本：空 div 会被 turndown 当成空白节点丢掉
    return ['div', mergeAttributes(HTMLAttributes, { 'data-frontmatter': '' }), node.attrs.raw];
  },

  addCommands() {
    return {
      insertFrontmatter: (yaml = 'tags: []') => ({ state, tr, dispatch }) => {
        if (state.doc.firstChild?.type === this.type) return false;
        if (dispatch) tr.insert(0, this.type.create({ raw: buildFrontmatterBlock(yaml) }));
        return true;
      },
    };
  },

  /**
   * 属性块是文档的第一个节点，编辑器的初始选区正好落在它上面。
   * 这时直接打字，ProseMirror 的默认行为是「用输入的文字替换被选中的节点」—— 整个 frontmatter 就没了。
   * 改成把文字插到属性块后面；要删属性块，选中后按 Delete / Backspace 仍然可以。
   */
  addProseMirrorPlugins() {
    const type = this.type;
    return [
      new Plugin({
        key: new PluginKey('frontmatterGuard'),
        props: {
          handleTextInput(view, _from, _to, text) {
            const { selection } = view.state;
            if (!(selection instanceof NodeSelection) || selection.node.type !== type) return false;
            const after = selection.from + selection.node.nodeSize;
            let tr = view.state.tr;
            // 后面没有可以落光标的文本块就补一个段落
            if (after >= view.state.doc.content.size) tr = tr.insert(after, view.state.schema.nodes.paragraph.create());
            tr = tr.setSelection(Selection.near(tr.doc.resolve(after + 1)));
            view.dispatch(tr.insertText(text));
            return true;
          },
          handlePaste(view) {
            const { selection } = view.state;
            if (!(selection instanceof NodeSelection) || selection.node.type !== type) return false;
            // 粘贴同理：先把选区挪到属性块后面，再交给默认的粘贴流程
            const after = selection.from + selection.node.nodeSize;
            let tr = view.state.tr;
            if (after >= view.state.doc.content.size) tr = tr.insert(after, view.state.schema.nodes.paragraph.create());
            view.dispatch(tr.setSelection(Selection.near(tr.doc.resolve(after + 1))));
            return false;
          },
        },
      }),
    ];
  },

  addNodeView() {
    return ({ node, editor, getPos }) => createSourceNodeView({
      node, editor, getPos,
      className: 'frontmatter-card frontmatter-card--editable',
      title: '双击编辑 YAML 原文',
      multiline: true,
      getSource: (n) => frontmatterYaml(n.attrs.raw),
      toAttrs: (source) => (source.trim() ? { raw: buildFrontmatterBlock(source) } : null),
      render: (display, n, api) => {
        const fields = parseFrontmatter(frontmatterYaml(n.attrs.raw));
        const collapsed = localStorage.getItem(COLLAPSE_KEY) === '1';

        const head = document.createElement('div');
        head.className = 'frontmatter-card__head';
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'frontmatter-card__toggle';
        toggle.textContent = `${collapsed ? '▸' : '▾'} 属性 · ${fields.length} 项`;
        const editBtn = document.createElement('button');
        editBtn.type = 'button';
        editBtn.className = 'frontmatter-card__edit';
        editBtn.textContent = '编辑';
        head.append(toggle, editBtn);
        display.appendChild(head);

        const body = document.createElement('div');
        body.className = 'frontmatter-card__body';
        body.style.display = collapsed ? 'none' : '';
        for (const f of fields) {
          const row = document.createElement('div');
          row.className = 'frontmatter-card__row';
          const key = document.createElement('span');
          key.className = 'frontmatter-card__key';
          key.textContent = f.key;
          const value = document.createElement('span');
          value.className = 'frontmatter-card__value';
          if (Array.isArray(f.value)) {
            for (const v of f.value) {
              const chip = document.createElement('span');
              chip.className = 'frontmatter-card__chip';
              chip.textContent = v;
              value.appendChild(chip);
            }
          } else {
            value.textContent = f.value;
          }
          row.append(key, value);
          body.appendChild(row);
        }
        if (fields.length === 0) {
          const empty = document.createElement('div');
          empty.className = 'frontmatter-card__row frontmatter-card__row--empty';
          empty.textContent = '（空）双击添加属性，如 tags: [读书, 想法]';
          body.appendChild(empty);
        }
        display.appendChild(body);

        toggle.addEventListener('mousedown', (e) => e.preventDefault());
        toggle.addEventListener('click', (e) => {
          e.stopPropagation();
          const next = body.style.display !== 'none';
          body.style.display = next ? 'none' : '';
          localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
          toggle.textContent = `${next ? '▸' : '▾'} 属性 · ${fields.length} 项`;
        });
        toggle.addEventListener('dblclick', (e) => e.stopPropagation());
        editBtn.addEventListener('mousedown', (e) => e.preventDefault());
        editBtn.addEventListener('click', (e) => { e.stopPropagation(); api.edit(); });
      },
    });
  },
});
