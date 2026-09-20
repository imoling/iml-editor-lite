import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom';
import { FileText, FilePlus } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { loadLinkedContent, fillEmbeds, LinkedContent } from '../../utils/noteEmbed';

const SHOW_DELAY = 450;
const HIDE_DELAY = 180;
const WIDTH = 420;
const MAX_HEIGHT = 340;
/** 卡片里不值得渲染整篇长文：够看清「这是哪篇、讲什么」就行，要细看点进去 */
const MAX_CHARS = 3000;

interface Shown {
  target: string;
  rect: DOMRect;
  content: LinkedContent;
}

/**
 * 悬浮预览：鼠标在 [[链接]] 上停一会儿，就地弹出那篇笔记（或链接指的那个小节）的内容，不用点过去再点回来。
 * 富文本编辑器和源码模式的预览区都生效。一打字、一滚动、一点别处就收起，不挡正事。
 */
export const LinkPreview: React.FC = () => {
  const [shown, setShown] = useState<Shown | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 鼠标现在停在哪个链接上：内容读回来时如果已经移开了，就不弹了 */
  const hovering = useRef<Element | null>(null);
  const activeTabId = useAppStore((s) => s.activeTabId);

  useEffect(() => {
    const clear = (t: React.MutableRefObject<ReturnType<typeof setTimeout> | null>) => { if (t.current) { clearTimeout(t.current); t.current = null; } };
    const hideNow = () => { clear(showTimer); clear(hideTimer); hovering.current = null; setShown(null); };
    const hideSoon = () => { clear(hideTimer); hideTimer.current = setTimeout(() => { hovering.current = null; setShown(null); }, HIDE_DELAY); };

    const linkUnder = (e: Event): HTMLElement | null => {
      const t = e.target as HTMLElement | null;
      const link = t?.closest?.<HTMLElement>('[data-wiki-link]') ?? null;
      // 只管编辑区里的链接；嵌入块的标题栏下面就是内容本身，卡片里的链接不再套一层卡片
      if (!link || !link.closest('.editor-area') || link.closest('.note-embed__head')) return null;
      return link;
    };

    const onOver = (e: MouseEvent) => {
      if ((e.target as HTMLElement | null)?.closest?.('.link-preview')) { clear(hideTimer); return; }
      const link = linkUnder(e);
      if (!link || !useAppStore.getState().linkPreview) return; // 设置里关掉了就不弹
      clear(hideTimer);
      if (hovering.current === link) return;
      hovering.current = link;
      clear(showTimer);
      showTimer.current = setTimeout(async () => {
        const target = link.getAttribute('data-wiki-link') || '';
        const from = useAppStore.getState().activeTabId;
        const content = await loadLinkedContent(target, { fromPath: from && !from.startsWith('new-') ? from : null, maxChars: MAX_CHARS });
        if (hovering.current !== link || !link.isConnected) return;
        setShown({ target, rect: link.getBoundingClientRect(), content });
      }, SHOW_DELAY);
    };

    const onOut = (e: MouseEvent) => {
      const from = e.target as HTMLElement | null;
      const to = e.relatedTarget as HTMLElement | null;
      const leftLink = !!linkUnder(e) && !to?.closest?.('[data-wiki-link]');
      const leftCard = !!from?.closest?.('.link-preview') && !to?.closest?.('.link-preview');
      if (!leftLink && !leftCard) return;
      if (to?.closest?.('.link-preview')) return; // 从链接移进卡片：留着，让人能滚动、能点里面的链接
      clear(showTimer);
      hideSoon();
    };

    const onDown = (e: MouseEvent) => { if (!(e.target as HTMLElement | null)?.closest?.('.link-preview')) hideNow(); };
    const onScroll = (e: Event) => { if (!(e.target as HTMLElement | null)?.closest?.('.link-preview')) hideNow(); };

    document.addEventListener('mouseover', onOver);
    document.addEventListener('mouseout', onOut);
    document.addEventListener('mousedown', onDown, true);
    document.addEventListener('keydown', hideNow, true);
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('blur', hideNow);
    return () => {
      hideNow();
      document.removeEventListener('mouseover', onOver);
      document.removeEventListener('mouseout', onOut);
      document.removeEventListener('mousedown', onDown, true);
      document.removeEventListener('keydown', hideNow, true);
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('blur', hideNow);
    };
  }, []);

  // 换了笔记就收起
  useEffect(() => { hovering.current = null; setShown(null); }, [activeTabId]);

  // 卡片里的嵌入（被预览的那篇自己又嵌了别的）
  useEffect(() => {
    if (shown?.content.kind === 'note' && bodyRef.current) void fillEmbeds(bodyRef.current, shown.content.path, [shown.content.path]);
  }, [shown]);

  // 同一份内容要给同一个 { __html } 对象：React 19 按对象身份判断要不要重设 innerHTML，重设会冲掉填好的嵌入
  const markup = useMemo(() => ({ __html: shown?.content.kind === 'note' ? shown.content.html : '' }), [shown]);

  if (!shown) return null;
  const { rect, content, target } = shown;
  const below = window.innerHeight - rect.bottom;
  const placeAbove = below < MAX_HEIGHT + 16 && rect.top > below;
  const style: React.CSSProperties = {
    width: WIDTH,
    maxHeight: Math.max(120, Math.min(MAX_HEIGHT, (placeAbove ? rect.top : below) - 16)),
    left: Math.min(Math.max(rect.left, 8), window.innerWidth - WIDTH - 8),
    ...(placeAbove ? { bottom: window.innerHeight - rect.top + 6 } : { top: rect.bottom + 6 }),
  };

  const open = (link: string) => { setShown(null); hovering.current = null; void useAppStore.getState().openWikiLink(link); };
  const onBodyClick = (e: React.MouseEvent) => {
    const el = e.target as HTMLElement;
    const wiki = el.closest('[data-wiki-link]');
    if (wiki) { e.preventDefault(); open(wiki.getAttribute('data-wiki-link') || ''); return; }
    const anchor = el.closest('a[href]');
    if (anchor) {
      e.preventDefault();
      const href = anchor.getAttribute('href') || '';
      if (/^https?:|^mailto:/i.test(href)) window.api.shell.openExternal(href);
    }
  };

  return ReactDOM.createPortal(
    <div className="link-preview" style={style}>
      {content.kind === 'missing' ? (
        <div className="link-preview__head link-preview__head--missing" onClick={() => open(target)}>
          <FilePlus size={13} /> <span className="truncate">{content.name}</span>
          <span className="link-preview__hint">还没有这篇，点击新建</span>
        </div>
      ) : content.kind === 'image' ? (
        <img className="link-preview__image" src={content.src} alt="" />
      ) : content.kind === 'audio' ? (
        <audio className="link-preview__audio" controls src={content.src} />
      ) : content.kind === 'video' ? (
        <video className="link-preview__image" controls preload="metadata" src={content.src} />
      ) : content.kind === 'file' ? (
        <div className="link-preview__head link-preview__head--missing" onClick={() => void window.api.search.openAttachment(content.path)} title="用系统默认的应用打开">
          <FileText size={13} /> <span className="truncate">{content.path.split(/[/\\]/).pop()}</span>
          <span className="link-preview__hint">点击打开</span>
        </div>
      ) : (
        <>
          <div className="link-preview__head" onClick={() => open(target)} title="打开这篇笔记">
            <FileText size={13} />
            <span className="truncate">{content.title}{content.section ? ` › ${content.section}` : ''}</span>
          </div>
          {content.kind === 'no-section' ? (
            <div className="link-preview__empty">这篇笔记里没有「{content.section}」这一节。</div>
          ) : (
            <div ref={bodyRef} className="link-preview__body markdown-body custom-scrollbar" onClick={onBodyClick}>
              <div dangerouslySetInnerHTML={markup} />
              {content.truncated && <div className="link-preview__more" onClick={() => open(target)}>内容还有很多，点击打开全文 →</div>}
            </div>
          )}
        </>
      )}
    </div>,
    document.body,
  );
};
