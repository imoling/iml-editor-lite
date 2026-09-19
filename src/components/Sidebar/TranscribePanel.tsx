import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff, Square, FileDown, FilePlus, ListChecks, Copy, Check, Eraser, Download, SlidersHorizontal, ShieldCheck, PanelLeft, ChevronRight } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { useTranscribeStore } from '../../stores/transcribeStore';
import { useAiReadiness } from '../../utils/aiReadiness';
import { currentMicLabel, micPermission } from '../../utils/micDevices';
import { formatClock, transcriptText } from '../../utils/transcript';
import { LevelBars } from '../AI/MicLevel';
import { PanelIntro } from './PanelIntro';

const formatSize = (bytes: number) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`);

const POINTS = [
  { icon: <ShieldCheck size={13} />, text: '识别在这台电脑上完成，音频不保存、不上传' },
  { icon: <PanelLeft size={13} />, text: '转写时可以切到别的面板，不会中断' },
  { icon: <ListChecks size={13} />, text: '结束后结合你记的要点，一键整理成纪要' },
];

/** 录音期间每秒走一次的计时 */
function useElapsed(running: boolean): number {
  const elapsed = useTranscribeStore((s) => s.elapsed);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [running]);
  return elapsed();
}

/**
 * 实时转写：开会、听课时点开始，你照常在正文里记要点，全文它来记。
 * 识别在本机完成，音频不保存、不上传。停下来之后可以把全文折叠着放进笔记，再让模型结合你记的要点整理出纪要。
 */
export const TranscribePanel: React.FC = () => {
  const aiEnabled = useAppStore((s) => s.aiEnabled);
  const activeTabId = useAppStore((s) => s.activeTabId);
  const openDialog = useAppStore((s) => s.openDialog);
  const t = useTranscribeStore();
  const readiness = useAiReadiness(aiEnabled);
  const [copied, setCopied] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const recording = t.status === 'recording';
  const elapsed = useElapsed(recording);
  const getLevel = useCallback(() => useTranscribeStore.getState().level, []);

  useEffect(() => { void t.refresh(); void t.refreshMics(); }, []);
  // 新的一句出来就滚到底
  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [t.segments.length, t.partial?.text]);

  const asr = t.asr;
  const hasText = t.segments.length > 0;
  const busy = t.status === 'starting' || t.status === 'stopping';
  const live = recording || t.status === 'stopping';
  const openConfig = () => openDialog('transcribe-config');

  const head = (
    <div className="ask-panel__head">
      <span className="sidebar-section-title">实时转写</span>
      <span className="row gap-6">
        {hasText && t.status === 'idle' && <button className="btn-link" onClick={t.clear} title="清空这次的转写"><Eraser size={12} /> 清空</button>}
        {aiEnabled && asr?.supported && <button className="icon-btn icon-btn--sm" onClick={openConfig} title="语音模型与收音设备"><SlidersHorizontal size={13} /></button>}
      </span>
    </div>
  );

  if (!aiEnabled) {
    return <div className="ask-panel">{head}<div className="tree-empty tree-empty--root">AI 功能已在设置里关闭。<button className="btn-link" onClick={() => openDialog('settings')}>去打开</button></div></div>;
  }
  if (!asr) return <div className="ask-panel">{head}</div>;
  if (!asr.supported) {
    return <div className="ask-panel">{head}<div className="tree-empty tree-empty--root">这个平台暂时还不支持实时转写。</div></div>;
  }

  // ── 还没下载语音模型 ──
  if (!asr.installed) {
    const dl = asr.install;
    const pct = dl?.active && dl.total ? Math.round((dl.received / dl.total) * 100) : 0;
    return (
      <div className="ask-panel">
        {head}
        <div className="ask-panel__list">
          <PanelIntro icon={<Mic size={20} />} title="你记要点，全文它来记" lead="开会、听课时点开始，边听边出字。" points={POINTS}>
            <div className="panel-intro__action">
              {dl?.active ? (
                <>
                  <div className="lm-progress"><div className="lm-progress__bar" style={{ width: `${pct}%` }} /></div>
                  <div className="panel-intro__row">
                    <span>{dl.step} {pct}% · {formatSize(dl.received)} / {formatSize(dl.total)}</span>
                    <button className="btn-link" onClick={t.cancelInstall}>取消</button>
                  </div>
                </>
              ) : (
                <>
                  <button className="btn btn-primary btn-xs panel-intro__cta" onClick={t.install}><Download size={13} /> {dl?.error ? '重试下载' : `下载语音模型 · ${formatSize(asr.downloadBytes)}`}</button>
                  <div className="panel-intro__note">第一次用需要下载，只下载一次</div>
                </>
              )}
              {dl?.error && <div className="ask-status ask-status--error">下载失败：{dl.error}</div>}
            </div>
          </PanelIntro>
        </div>
      </div>
    );
  }

  const denied = micPermission(asr.micAccess, t.heardSignal) === 'blocked';
  const micName = live && t.deviceLabel ? t.deviceLabel : currentMicLabel(t.micId, t.mics);
  const device = (
    <button className={`rec-device ${denied || t.silent ? 'rec-device--warn' : ''}`} onClick={openConfig} title="换麦克风、试音">
      {denied || t.silent ? <MicOff size={11} /> : <Mic size={11} />}
      <span className="truncate">{denied ? '麦克风权限被关掉了' : t.silent ? '没有声音进来，检查一下麦克风' : micName || '麦克风'}</span>
      <ChevronRight size={11} />
    </button>
  );

  return (
    <div className="ask-panel">
      {head}

      {live ? (
        // ── 正在转写：状态、计时、音量、在用哪个麦克风 ──
        <div className="rec-card rec-card--live">
          <div className="rec-card__row">
            <span className="rec-live"><span className="rec-live__dot" /> 转写中</span>
            <span className="rec-clock">{formatClock(elapsed)}</span>
            <button className="rec-stop" onClick={() => void t.stop()} disabled={busy}><Square size={10} /> {t.status === 'stopping' ? '收尾中…' : '停止'}</button>
          </div>
          <LevelBars getLevel={getLevel} running={recording} bars={36} />
          {device}
        </div>
      ) : hasText ? (
        // ── 停下来了：可以接着录 ──
        <div className="rec-card rec-card--paused">
          <div className="rec-card__row">
            <span className="rec-paused">已停止 · {t.segments.length} 句</span>
            <span className="rec-clock rec-clock--muted">{formatClock(elapsed)}</span>
            <button className="rec-resume" onClick={() => void t.start()} disabled={busy}><Mic size={11} /> {t.status === 'starting' ? '准备中…' : '继续'}</button>
          </div>
        </div>
      ) : (
        // ── 还没开始：一个大按钮 ──
        <div className="rec-card rec-card--hero">
          <button className="rec-start" onClick={() => void t.start()} disabled={busy} title="开始转写"><Mic size={22} /></button>
          <div className="rec-start__label">{t.status === 'starting' ? '正在准备…' : '开始转写'}</div>
          {device}
        </div>
      )}
      {t.error && <div className="ask-status ask-status--error">{t.error}</div>}

      <div className="ask-panel__list" ref={listRef}>
        {!hasText && !t.partial ? (
          live
            ? <div className="rec-listening"><span className="ask-dots" /> 正在听……有人说话，文字就会出现在这里</div>
            : <PanelIntro title="你记要点，全文它来记" lead="开会、听课时点开始，照常在正文里记你的要点。" points={POINTS} />
        ) : (
          <>
            {t.segments.map((s, i) => (
              <div key={i} className="transcribe-line"><span className="transcribe-line__time">{formatClock(s.start)}</span><span>{s.text}</span></div>
            ))}
            {t.partial && <div className="transcribe-line transcribe-line--partial"><span className="transcribe-line__time">{formatClock(t.partial.start)}</span><span>{t.partial.text}<span className="transcribe-caret" /></span></div>}
          </>
        )}
      </div>

      {/* 停下来之后：整理纪要是主操作，全文的去处放在下面一排 */}
      {hasText && t.status === 'idle' && (
        <div className="transcribe-actions">
          <button
            className="btn btn-primary btn-xs transcribe-actions__main"
            disabled={t.minutes.running || !readiness.ready}
            title={readiness.ready ? '结合你在笔记里记的要点，整理出议题、结论和待办' : `${readiness.message}，整理纪要要靠一个对话模型`}
            onClick={() => void t.generateMinutes()}
          >{t.minutes.running ? <><span className="ask-dots" /> {t.minutes.progress}</> : <><ListChecks size={13} /> 整理纪要</>}</button>
          {!readiness.ready && <button className="btn-link transcribe-actions__hint" onClick={() => openDialog('ai-setup')}>配置一个对话模型后可以整理纪要</button>}
          {t.minutes.error && <div className="ask-status ask-status--error">整理纪要失败：{t.minutes.error}</div>}
          <div className="transcribe-actions__row">
            <button className="transcribe-tool" disabled={!activeTabId} title={activeTabId ? '折叠着放到当前笔记的末尾（同一场再放一次是更新，不会重复）' : '先打开一篇笔记'} onClick={() => t.insertIntoActiveNote()}><FileDown size={13} /> 放进笔记</button>
            <button className="transcribe-tool" title="新建一篇会议记录，带上转写全文" onClick={() => void t.saveAsNewNote()}><FilePlus size={13} /> 存为新笔记</button>
            <button className="transcribe-tool" onClick={() => { void navigator.clipboard.writeText(transcriptText(t.segments)); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
              {copied ? <><Check size={13} /> 已复制</> : <><Copy size={13} /> 复制</>}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
