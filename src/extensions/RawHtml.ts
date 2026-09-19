import { Node, mergeAttributes } from '@tiptap/core';
import { encodeRaw, decodeRaw, markdownToHtml } from '../utils/markdown';
import { sanitizeHtml } from '../utils/sanitize';
import { resolveImagesInHtml } from '../utils/assetUrl';
import { currentNoteDir } from '../utils/currentNoteDir';
import { createSourceNodeView } from './sourceNodeView';
import { parseClock } from '../utils/transcript';

/**
 * 原文的渲染结果。原文可能是 HTML，也可能是 Markdown（与文字同段的图片、带链接的徽章图），统一走预览管线再净化。
 * 渲染出来没有看得见的东西（注释、单独的 </details>）时返回 null，调用方直接显示原文。
 */
function renderedPreview(raw: string, inline = false): string | null {
  let html = resolveImagesInHtml(sanitizeHtml(markdownToHtml(raw, true)), currentNoteDir());
  if (inline) html = html.trim().replace(/^<p>([\s\S]*)<\/p>$/, '$1');
  const probe = document.createElement('div');
  probe.innerHTML = html;
  const visible = (probe.textContent || '').trim() || probe.querySelector('img, svg, video, audio, hr, table, input');
  return visible ? html : null;
}

/**
 * 带录音的转写块：点一句话，录音跳到那句话开始的地方。
 * 播放器和这些行上的双击不往外传 —— 否则连点两下就进了「编辑原文」
 */
function wireTranscriptPlayback(body: HTMLElement) {
  const audio = body.querySelector<HTMLAudioElement>('details[data-iml-transcript] audio');
  if (!audio) return;
  audio.closest('details')?.classList.add('transcript--playable');
  // 同一时间只响一处：通知转写面板里的播放器停下，别的笔记块里在播的也停
  audio.addEventListener('play', () => {
    window.dispatchEvent(new Event('iml:audio-play'));
    document.querySelectorAll('audio').forEach((other) => { if (other !== audio) other.pause(); });
  });
  const lineOf = (e: Event) => (e.target as HTMLElement).closest?.('details[data-iml-transcript] p') as HTMLElement | null;
  body.addEventListener('click', (e) => {
    const line = lineOf(e);
    const at = line ? parseClock(line.textContent || '') : null;
    if (at === null) return;
    audio.currentTime = at;
    void audio.play().catch(() => {});
  });
  body.addEventListener('dblclick', (e) => { if (lineOf(e) || (e.target as HTMLElement).closest?.('audio')) e.stopPropagation(); });
}

/**
 * 原样保留块：编辑器的文档模型表达不了的内容 —— HTML 块（<details>、<div align>、带宽高的 <img>、注释……）
 * 和脚注定义。原文整段存在属性里，保存时一个字符都不改；展示净化后的渲染结果，双击改原文。
 */
export const RawBlock = Node.create({
  name: 'rawBlock',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      raw: {
        default: '',
        parseHTML: (el: HTMLElement) => decodeRaw(el.getAttribute('data-raw')),
        renderHTML: (attrs: Record<string, any>) => ({ 'data-raw': encodeRaw(attrs.raw) }),
      },
      kind: {
        default: 'html',
        parseHTML: (el: HTMLElement) => el.getAttribute('data-raw-block') || 'html',
        renderHTML: (attrs: Record<string, any>) => ({ 'data-raw-block': attrs.kind }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-raw-block]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes), node.attrs.raw || ' '];
  },

  addNodeView() {
    return ({ node, editor, getPos }) => createSourceNodeView({
      node, editor, getPos,
      className: `raw-block raw-block--${node.attrs.kind}`,
      title: '这段内容按原文保存 · 双击编辑',
      multiline: true,
      getSource: (n) => n.attrs.raw,
      toAttrs: (source) => (source.trim() ? { raw: source.replace(/\s+$/, '') } : null),
      render: (display, n) => {
        const badge = document.createElement('span');
        badge.className = 'raw-block__badge';
        badge.textContent = n.attrs.kind === 'footnote' ? '脚注' : 'HTML';
        display.appendChild(badge);
        const body = document.createElement('div');
        const preview = n.attrs.kind === 'footnote' ? null : renderedPreview(n.attrs.raw);
        if (preview) {
          body.className = 'raw-block__preview';
          body.innerHTML = preview;
          wireTranscriptPlayback(body);
        } else {
          body.className = 'raw-block__source';
          body.textContent = n.attrs.raw;
        }
        display.appendChild(body);
      },
    });
  },
});

/** 行内的原样保留：成对的未知 HTML 标签（<span style>、<font> 等）与行内注释 */
export const RawInline = Node.create({
  name: 'rawInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      raw: {
        default: '',
        parseHTML: (el: HTMLElement) => decodeRaw(el.getAttribute('data-raw')),
        renderHTML: (attrs: Record<string, any>) => ({ 'data-raw': encodeRaw(attrs.raw) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-raw-inline]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-raw-inline': '' }), node.attrs.raw || ' '];
  },

  renderText({ node }) {
    return node.attrs.raw;
  },

  addNodeView() {
    return ({ node, editor, getPos }) => createSourceNodeView({
      node, editor, getPos,
      tag: 'span',
      className: 'raw-inline',
      title: '这段 HTML 按原文保存 · 双击编辑',
      getSource: (n) => n.attrs.raw,
      toAttrs: (source) => (source.trim() ? { raw: source.trim() } : null),
      render: (display, n) => {
        const preview = renderedPreview(n.attrs.raw, true);
        if (preview) display.innerHTML = preview;
        else {
          display.classList.add('raw-inline__source');
          display.textContent = n.attrs.raw;
        }
      },
    });
  },
});
