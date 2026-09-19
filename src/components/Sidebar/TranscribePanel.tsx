import React, { useEffect, useRef, useState } from 'react';
import { Mic, Square, FileDown, FilePlus, ListChecks, Copy, Check, Eraser, Download } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { useTranscribeStore } from '../../stores/transcribeStore';
import { useAiReadiness } from '../../utils/aiReadiness';
import { formatClock, transcriptText } from '../../utils/transcript';

const formatSize = (bytes: number) => (bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(1)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`);

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

  useEffect(() => { void t.refresh(); }, []);
  // 新的一句出来就滚到底
  useEffect(() => { const el = listRef.current; if (el) el.scrollTop = el.scrollHeight; }, [t.segments.length, t.partial?.text]);

  const asr = t.asr;
  const hasText = t.segments.length > 0;
  const busy = t.status === 'starting' || t.status === 'stopping';

  const head = (
    <div className="ask-panel__head">
      <span className="sidebar-section-title">实时转写</span>
      {hasText && t.status === 'idle' && <button className="btn-link" onClick={t.clear} title="清空这次的转写"><Eraser size={12} /> 清空</button>}
    </div>
  );

  if (!aiEnabled) {
    return <div className="ask-panel">{head}<div className="tree-empty tree-empty--root">AI 功能已在设置里关闭。<button className="btn-link" onClick={() => openDialog('settings')}>去打开</button></div></div>;
  }
  if (!asr) return <div className="ask-panel">{head}</div>;
  if (!asr.supported) {
    return <div className="ask-panel">{head}<div className="tree-empty tree-empty--root">这个平台暂时还不支持实时转写。</div></div>;
  }

  // ── 还没下载识别组件 ──
  if (!asr.installed) {
    const dl = asr.install;
    const pct = dl?.active && dl.total ? Math.round((dl.received / dl.total) * 100) : 0;
    return (
      <div className="ask-panel">
        {head}
        <div className="transcribe-setup">
          <p>开会、听课时点开始，你照常在正文里记要点，全文它来记。</p>
          <p className="ask-intro__hint">语音识别在这台电脑上完成，音频不保存、不上传。第一次用需要下载识别组件和语音模型，约 {formatSize(asr.downloadBytes)}，只下载一次。</p>
          {dl?.active ? (
            <>
              <div className="lm-progress"><div className="lm-progress__bar" style={{ width: `${pct}%` }} /></div>
              <div className="transcribe-setup__row">
                <span className="ask-intro__hint">{dl.step} {pct}% · {formatSize(dl.received)} / {formatSize(dl.total)}</span>
                <button className="btn-link" onClick={t.cancelInstall}>取消</button>
              </div>
            </>
          ) : (
            <button className="btn btn-primary btn-xs" onClick={t.install}><Download size={12} /> {dl?.error ? '重试下载' : '下载'}</button>
          )}
          {dl?.error && <div className="ask-status ask-status--error">下载失败：{dl.error}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="ask-panel">
      {head}

      <div className="transcribe-bar">
        {recording || t.status === 'stopping' ? (
          <button className="transcribe-btn transcribe-btn--stop" onClick={() => void t.stop()} disabled={busy}><Square size={11} /> 停止</button>
        ) : (
          <button className="transcribe-btn" onClick={() => void t.start()} disabled={busy}><Mic size={13} /> {t.status === 'starting' ? '正在准备…' : hasText ? '继续转写' : '开始转写'}</button>
        )}
        {(recording || hasText) && <span className={`transcribe-clock ${recording ? 'transcribe-clock--live' : ''}`}>{formatClock(elapsed)}</span>}
        {recording && <span className="transcribe-level" title="麦克风音量"><span style={{ width: `${Math.round(t.level * 100)}%` }} /></span>}
      </div>
      {t.error && <div className="ask-status ask-status--error">{t.error}</div>}

      <div className="ask-panel__list" ref={listRef}>
        {!hasText && !t.partial ? (
          <div className="ask-intro">
            {recording
              ? <p>正在听……有人说话，文字就会出现在这里。</p>
              : <><p>开会、听课时点开始，你照常在正文里记要点，全文它来记。</p><p className="ask-intro__hint">识别在本机完成，音频不保存、不上传。录音期间可以切到别的面板，不会中断。</p></>}
          </div>
        ) : (
          <>
            {t.segments.map((s, i) => (
              <div key={i} className="transcribe-line"><span className="transcribe-line__time">{formatClock(s.start)}</span><span>{s.text}</span></div>
            ))}
            {t.partial && <div className="transcribe-line transcribe-line--partial"><span className="transcribe-line__time">{formatClock(t.partial.start)}</span><span>{t.partial.text}</span></div>}
          </>
        )}
      </div>

      {/* 停下来之后：把全文放进笔记，再整理纪要 */}
      {hasText && t.status === 'idle' && (
        <div className="transcribe-actions">
          <button className="btn btn-secondary btn-xs" disabled={!activeTabId} title={activeTabId ? '折叠着追加到当前笔记的末尾' : '先打开一篇笔记'} onClick={() => t.insertIntoActiveNote()}><FileDown size={12} /> 放进当前笔记</button>
          <button className="btn btn-secondary btn-xs" onClick={() => void t.saveAsNewNote()}><FilePlus size={12} /> 存为新笔记</button>
          <button
            className="btn btn-primary btn-xs"
            disabled={t.minutes.running || !readiness.ready}
            title={readiness.ready ? '结合你在笔记里记的要点，整理出议题、结论和待办' : `${readiness.message}，整理纪要要靠一个对话模型`}
            onClick={() => void t.generateMinutes()}
          ><ListChecks size={12} /> {t.minutes.running ? t.minutes.progress : '整理纪要'}</button>
          <button className="btn-link" onClick={() => { void navigator.clipboard.writeText(transcriptText(t.segments)); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
            {copied ? <><Check size={11} /> 已复制</> : <><Copy size={11} /> 复制全文</>}
          </button>
          {!readiness.ready && <button className="btn-link" onClick={() => openDialog('ai-setup')}>配置模型后可以整理纪要</button>}
          {t.minutes.error && <div className="ask-status ask-status--error">整理纪要失败：{t.minutes.error}</div>}
        </div>
      )}
    </div>
  );
};
