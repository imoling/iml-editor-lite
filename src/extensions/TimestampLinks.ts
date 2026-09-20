import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

/**
 * 笔记里的时间戳可点：实时转写时按 ⌘⇧L「打点」，会在你记的要点里插入一个 [12:05]；
 * 这篇笔记里有带录音的转写块时，点这个时间，录音就跳到那一刻 —— 你记的要点和当时的声音就这样连起来了。
 *
 * 时间戳就是正文里的普通文字（文件里也是 `[12:05]`，别的编辑器打开不会多出任何东西），这里只是给它加一层装饰。
 * 只在笔记里真有带录音的转写块时才生效：免得把平常文章里的 [1:30] 也变成一个点了没反应的链接
 */
const STAMP = /\[(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\]/g;
const key = new PluginKey<DecorationSet>('timestampLinks');

const hasPlayableTranscript = (doc: PMNode): boolean => {
  let found = false;
  doc.descendants((node) => {
    if (found) return false;
    if (node.type.name === 'rawBlock' && /<details data-iml-transcript>[\s\S]*<audio\b/.test(node.attrs.raw || '')) found = true;
    return !found;
  });
  return found;
};

function build(doc: PMNode): DecorationSet {
  if (!hasPlayableTranscript(doc)) return DecorationSet.empty;
  const decorations: Decoration[] = [];
  doc.descendants((node, pos, parent) => {
    if (!node.isText || !node.text || parent?.type.spec.code) return;
    if (node.marks.some((m) => m.type.name === 'code' || m.type.name === 'link')) return;
    for (const m of node.text.matchAll(STAMP)) {
      const seconds = Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
      decorations.push(Decoration.inline(pos + m.index!, pos + m.index! + m[0].length, { class: 'ts-link', 'data-seconds': String(seconds), title: '点一下，录音跳到这一刻' }));
    }
  });
  return DecorationSet.create(doc, decorations);
}

export const TimestampLinks = Extension.create({
  name: 'timestampLinks',
  addProseMirrorPlugins() {
    return [new Plugin<DecorationSet>({
      key,
      state: {
        init: (_config, state) => build(state.doc),
        apply: (tr, old) => (tr.docChanged ? build(tr.doc) : old),
      },
      props: {
        decorations: (state) => key.getState(state),
        handleClick(view, _pos, event) {
          const el = (event.target as HTMLElement | null)?.closest?.('.ts-link') as HTMLElement | null;
          if (!el) return false;
          // 这篇里可能不止一场转写：用时间戳后面最近的那一块的录音，后面没有就用第一块
          const audios = Array.from(view.dom.querySelectorAll<HTMLAudioElement>('details[data-iml-transcript] audio'));
          const audio = audios.find((a) => el.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING) ?? audios[0];
          if (!audio) return false;
          audio.currentTime = Number(el.dataset.seconds || 0);
          void audio.play().catch(() => {});
          return true;
        },
      },
    })];
  },
});
