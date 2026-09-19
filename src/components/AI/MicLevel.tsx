import React, { useEffect, useState } from 'react';

interface Props {
  /** 取当前音量（0~1）。传函数而不是数值：采样节奏由这里定，外面不用跟着每 90 ms 重渲染一次 */
  getLevel: () => number;
  running: boolean;
  bars?: number;
}

/** 滚动的音量条：最近几秒的声音大小，一眼看出「麦克风有没有在收音」 */
export const LevelBars: React.FC<Props> = ({ getLevel, running, bars = 32 }) => {
  const [levels, setLevels] = useState<number[]>(() => Array(bars).fill(0));

  useEffect(() => {
    if (!running) { setLevels(Array(bars).fill(0)); return; }
    const timer = setInterval(() => setLevels((prev) => [...prev.slice(1), getLevel()]), 90);
    return () => clearInterval(timer);
  }, [running, bars, getLevel]);

  return (
    <div className={`level-bars ${running ? 'level-bars--live' : ''}`} aria-hidden>
      {levels.map((v, i) => <span key={i} style={{ height: `${Math.max(8, Math.min(100, v * 115))}%` }} />)}
    </div>
  );
};
