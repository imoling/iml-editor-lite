import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { DOMSerializer } from '@tiptap/pm/model';
import { htmlToMarkdown } from './markdown';

/**
 * 增量序列化：按顶层块缓存 Markdown。
 * ProseMirror 的节点是不可变对象，没被编辑的块在新文档里仍是同一个对象，直接复用缓存；
 * 只有被改动的块才重新走 HTML → Markdown。整篇转换的开销从 O(全文) 降到 O(改动块)。
 */
const blockCache = new WeakMap<PMNode, string>();

export interface SerializedDoc {
  markdown: string;
  /** 文档里是否含有 data URL 图片（用于防止往返转换丢图的保护逻辑） */
  hasDataImage: boolean;
}

export function serializeDoc(editor: Editor): SerializedDoc {
  const { doc, schema } = editor.state;
  const serializer = DOMSerializer.fromSchema(schema);
  const parts: string[] = [];
  let hasDataImage = false;

  doc.forEach((node) => {
    let md = blockCache.get(node);
    if (md === undefined) {
      const container = document.createElement('div');
      container.appendChild(serializer.serializeNode(node));
      md = htmlToMarkdown(container.innerHTML).trim();
      blockCache.set(node, md);
    }
    if (md) parts.push(md);
    if (!hasDataImage) {
      node.descendants((child) => {
        if (child.type.name === 'image' && typeof child.attrs.src === 'string' && child.attrs.src.startsWith('data:')) {
          hasDataImage = true;
          return false;
        }
        return !hasDataImage;
      });
      if (node.type.name === 'image' && typeof node.attrs.src === 'string' && node.attrs.src.startsWith('data:')) hasDataImage = true;
    }
  });

  return { markdown: parts.join('\n\n'), hasDataImage };
}
