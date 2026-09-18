import Image from '@tiptap/extension-image';
import { resolveAssetUrl } from '../utils/assetUrl';
import { currentNoteDir } from '../utils/currentNoteDir';

/**
 * 图片节点：文档里保存的仍是 Markdown 里写的地址（assets/a.png），
 * 显示时按笔记所在目录解析成可加载的地址 —— 否则相对路径会相对应用自身去找，图片永远是裂的。
 */
export const NoteImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      // 源文件里路径带空格、又没用 <> 包起来的宽松写法：保存时原样写回
      lenient: {
        default: false,
        parseHTML: (el: HTMLElement) => el.hasAttribute('data-lenient'),
        renderHTML: (attrs: Record<string, any>) => (attrs.lenient ? { 'data-lenient': '' } : {}),
      },
    };
  },

  addNodeView() {
    return ({ node }) => {
      let current = node;
      const img = document.createElement('img');
      const apply = () => {
        img.src = resolveAssetUrl(current.attrs.src || '', currentNoteDir());
        img.alt = current.attrs.alt || '';
        if (current.attrs.title) img.title = current.attrs.title;
        else img.removeAttribute('title');
      };
      apply();
      return {
        dom: img,
        update: (updated) => {
          if (updated.type !== current.type) return false;
          const changed = updated.attrs.src !== current.attrs.src || updated.attrs.alt !== current.attrs.alt || updated.attrs.title !== current.attrs.title;
          current = updated;
          if (changed) apply();
          return true;
        },
      };
    };
  },
});
