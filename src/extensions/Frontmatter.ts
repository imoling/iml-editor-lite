import { Node, mergeAttributes } from '@tiptap/core';
import { Plugin, PluginKey, NodeSelection, Selection } from '@tiptap/pm/state';
import { encodeRaw, decodeRaw } from '../utils/markdown';
import { buildFrontmatterBlock, frontmatterYaml } from '../../electron/shared/noteMeta';
import { readProps, setProp, removeProp, renameProp, isValidPropKey, PropField, PropKind } from '../../electron/shared/frontmatterEdit';
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
 * 注释、缩进、引号、字段顺序都不动。展示成可折叠的属性卡片：每个字段一个控件（文本 / 日期 / 勾选 / 列表），
 * 改哪个字段就只改写那个字段占的几行；双击卡片空白处或点「原文」直接改 YAML。
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
      multiline: true,
      getSource: (n) => frontmatterYaml(n.attrs.raw),
      toAttrs: (source) => (source.trim() ? { raw: buildFrontmatterBlock(source) } : null),
      render: (display, n, api) => renderPropertyCard(display, frontmatterYaml(n.attrs.raw), api),
    });
  },
});

// ── 属性卡片：逐字段编辑 ─────────────────────────────────────────────────────
// 每个控件改的都是 YAML 原文里那一个字段占的几行（frontmatterEdit.ts），别的字符不动；
// 看不懂的写法（嵌套对象、多行字符串）只读，点「原文」去改。

const KIND_LABEL: Record<Exclude<PropKind, 'complex' | 'number'>, string> = { text: '文本', list: '列表', date: '日期', checkbox: '勾选' };

/** 提交之后卡片会整个重画：想让焦点回到哪（连着加几个标签时不用每次再点一下） */
let pendingFocus: string | null = null;

/**
 * 卡片里的按键不能漏到 window 上去。侧边栏有个全局按键处理：选中了文件时回车 = 重命名、退格 = 删除（不带确认），
 * 它靠「焦点在不在输入框里」来回避——可我们这里回车 / 退格一提交，卡片重画、输入框被销毁，
 * 事件冒泡到 window 时焦点已经回到 body，就会被当成是在文件树上按的。带 ⌘ / Ctrl 的组合键（保存等）照常放行。
 */
const keepKeysInside = (row: HTMLElement) => row.addEventListener('keydown', (e) => { if (!e.metaKey && !e.ctrlKey) e.stopPropagation(); });

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** 输入框：回车 / 失焦提交，Esc 放弃；输入法组字时的回车不算 */
function bindInput(input: HTMLInputElement, initial: string, onCommit: (value: string) => void) {
  let done = false;
  const finish = (commit: boolean) => {
    if (done) return;
    done = true;
    if (commit && input.value !== initial) onCommit(input.value);
    else input.value = initial;
    done = false;
  };
  input.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') { e.preventDefault(); finish(true); input.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); input.value = initial; input.blur(); }
  });
  input.addEventListener('blur', () => finish(true));
}

function renderPropertyCard(display: HTMLElement, yaml: string, api: { edit: () => void; commit: (source: string) => void }) {
  const fields = readProps(yaml);
  const collapsed = localStorage.getItem(COLLAPSE_KEY) === '1';

  const head = el('div', 'frontmatter-card__head');
  const toggle = el('button', 'frontmatter-card__toggle', `${collapsed ? '▸' : '▾'} 属性 · ${fields.length} 项`);
  toggle.type = 'button';
  toggle.setAttribute('data-interactive', '');
  const editBtn = el('button', 'frontmatter-card__edit', '原文');
  editBtn.type = 'button';
  editBtn.title = '直接改 YAML 原文';
  editBtn.setAttribute('data-interactive', '');
  head.append(toggle, editBtn);
  display.appendChild(head);

  const body = el('div', 'frontmatter-card__body');
  body.style.display = collapsed ? 'none' : '';
  display.appendChild(body);

  for (const f of fields) body.appendChild(renderRow(f, yaml, api));
  body.appendChild(renderAddRow(yaml, api));

  toggle.addEventListener('click', () => {
    const hide = body.style.display !== 'none';
    body.style.display = hide ? 'none' : '';
    localStorage.setItem(COLLAPSE_KEY, hide ? '1' : '0');
    toggle.textContent = `${hide ? '▸' : '▾'} 属性 · ${fields.length} 项`;
  });
  editBtn.addEventListener('click', () => api.edit());

  if (pendingFocus) {
    const target = body.querySelector<HTMLInputElement>(`[data-focus-id="${CSS.escape(pendingFocus)}"]`);
    pendingFocus = null;
    if (target) requestAnimationFrame(() => target.focus());
  }
}

function renderRow(f: PropField, yaml: string, api: { commit: (source: string) => void }): HTMLElement {
  const row = el('div', 'frontmatter-card__row');
  row.setAttribute('data-interactive', '');
  keepKeysInside(row);

  // 属性名：双击改名
  const key = el('span', 'frontmatter-card__key', f.key);
  key.title = '双击改名';
  key.addEventListener('dblclick', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const input = el('input', 'frontmatter-card__input frontmatter-card__input--key');
    input.value = f.key;
    key.replaceWith(input);
    input.focus();
    input.select();
    bindInput(input, f.key, (value) => {
      const next = renameProp(yaml, f.key, value);
      if (next === null) { input.classList.add('frontmatter-card__input--error'); input.title = '名字不能为空、不能带冒号，也不能和别的属性重名'; return; }
      api.commit(next);
    });
    input.addEventListener('blur', () => { if (input.isConnected && !input.classList.contains('frontmatter-card__input--error')) input.replaceWith(key); });
  });
  row.appendChild(key);

  const value = el('div', 'frontmatter-card__value');
  row.appendChild(value);

  if (f.kind === 'complex') {
    value.classList.add('frontmatter-card__value--complex');
    value.textContent = String(f.value).split('\n').slice(1).join('\n') || String(f.value);
    value.title = '这种写法（嵌套 / 多行）在这里只读，点右上角「原文」去改';
  } else if (f.kind === 'checkbox') {
    const box = el('input', 'frontmatter-card__check');
    box.type = 'checkbox';
    box.checked = f.value === true;
    box.addEventListener('change', () => api.commit(setProp(yaml, f.key, box.checked)));
    value.appendChild(box);
  } else if (f.kind === 'list') {
    const items = f.value as string[];
    for (const item of items) {
      const chip = el('span', 'frontmatter-card__chip', item);
      const remove = el('button', 'frontmatter-card__chip-x', '×');
      remove.type = 'button';
      remove.title = `去掉「${item}」`;
      remove.addEventListener('click', () => api.commit(setProp(yaml, f.key, items.filter((x) => x !== item))));
      chip.appendChild(remove);
      value.appendChild(chip);
    }
    const add = el('input', 'frontmatter-card__input frontmatter-card__input--add');
    add.placeholder = items.length ? '添加…' : '输入后回车';
    add.setAttribute('data-focus-id', `add:${f.key}`);
    const push = () => {
      // 逗号、顿号也当分隔：一次贴进来好几个也行
      const fresh = add.value.split(/[,，、]/).map((x) => x.trim().replace(/^#/, '')).filter((x) => x && !items.includes(x));
      add.value = '';
      if (!fresh.length) return;
      pendingFocus = `add:${f.key}`;
      api.commit(setProp(yaml, f.key, [...items, ...fresh]));
    };
    add.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === 'Enter' || e.key === ',' || e.key === '，') { e.preventDefault(); push(); }
      else if (e.key === 'Backspace' && !add.value && items.length) { pendingFocus = `add:${f.key}`; api.commit(setProp(yaml, f.key, items.slice(0, -1))); }
      else if (e.key === 'Escape') { e.stopPropagation(); add.value = ''; add.blur(); }
    });
    add.addEventListener('blur', push);
    value.appendChild(add);
  } else {
    const input = el('input', 'frontmatter-card__input');
    input.type = f.kind === 'date' ? 'date' : 'text';
    if (f.kind === 'number') input.inputMode = 'decimal';
    input.value = String(f.value);
    input.placeholder = '空';
    bindInput(input, String(f.value), (v) => {
      // 数字栏里填了不是数字的东西：当文本存（自动加引号），不硬塞成数字
      const kind = f.kind === 'number' && !/^[-+]?(\d+\.?\d*|\.\d+)$/.test(v.trim()) ? 'text' : f.kind;
      api.commit(setProp(yaml, f.key, v, kind));
    });
    if (f.kind === 'date') input.addEventListener('change', () => input.blur());
    value.appendChild(input);
  }

  const remove = el('button', 'frontmatter-card__remove', '×');
  remove.type = 'button';
  remove.title = `删掉「${f.key}」这个属性`;
  remove.addEventListener('click', () => api.commit(removeProp(yaml, f.key)));
  row.appendChild(remove);
  return row;
}

function renderAddRow(yaml: string, api: { commit: (source: string) => void }): HTMLElement {
  const row = el('div', 'frontmatter-card__row frontmatter-card__row--add');
  row.setAttribute('data-interactive', '');
  keepKeysInside(row);
  const name = el('input', 'frontmatter-card__input frontmatter-card__input--key');
  name.placeholder = '+ 添加属性';
  name.setAttribute('data-focus-id', 'new-prop');
  const kind = el('select', 'frontmatter-card__select');
  (Object.keys(KIND_LABEL) as (keyof typeof KIND_LABEL)[]).forEach((k) => { const o = el('option', '', KIND_LABEL[k]); o.value = k; kind.appendChild(o); });
  // 常见的名字顺手猜一下类型
  name.addEventListener('input', () => {
    const k = name.value.trim().toLowerCase();
    name.classList.remove('frontmatter-card__input--error');
    if (/^(tags?|alias(es)?|标签|别名)$/.test(k)) kind.value = 'list';
    else if (/(date|日期|due|created|updated|时间)$/.test(k)) kind.value = 'date';
    else if (/^(done|完成|draft|草稿|publish(ed)?)$/.test(k)) kind.value = 'checkbox';
  });
  const create = () => {
    const key = name.value.trim();
    if (!key) return;
    if (!isValidPropKey(key) || readProps(yaml).some((f) => f.key.toLowerCase() === key.toLowerCase())) {
      name.classList.add('frontmatter-card__input--error');
      name.title = '名字不能带冒号，也不能和已有的属性重名';
      return;
    }
    const k = kind.value as keyof typeof KIND_LABEL;
    const today = new Date();
    const initial = k === 'list' ? [] : k === 'checkbox' ? false : k === 'date' ? `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}` : '';
    // 建完直接把光标放进它的值里
    pendingFocus = k === 'list' ? `add:${key}` : null;
    api.commit(setProp(yaml, key, initial, k));
  };
  name.addEventListener('keydown', (e) => {
    if (e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Enter') { e.preventDefault(); create(); }
    if (e.key === 'Escape') { e.stopPropagation(); name.value = ''; name.blur(); }
  });
  row.append(name, kind);
  return row;
}
