import { describe, it, expect } from 'vitest';
import { isAudioFile, audioBaseName, mixToMono } from './audioFile';

describe('录音文件', () => {
  it('认得常见的录音格式，不把笔记和图片当成录音', () => {
    for (const f of ['/a/周会.m4a', 'C:\\\\rec\\\\x.MP3', '/a/b.wav', '/a/c.flac', '/a/d.webm', '/a/e.ogg']) expect(isAudioFile(f)).toBe(true);
    for (const f of ['/a/周会.md', '/a/x.png', '/a/m4a', '/a/x.mp4']) expect(isAudioFile(f)).toBe(false);
  });

  it('文件名（去掉目录和扩展名）用来给笔记起名', () => {
    expect(audioBaseName('/Users/me/录音/2026-09-20 产品周会.m4a')).toBe('2026-09-20 产品周会');
    expect(audioBaseName('C:\\\\rec\\\\lesson.01.mp3')).toBe('lesson.01');
  });

  it('立体声平均成单声道；本来就是单声道的原样返回', () => {
    const mono = new Float32Array([0.5, -0.5]);
    expect(mixToMono([mono])).toBe(mono);
    expect(Array.from(mixToMono([new Float32Array([1, 0, -1]), new Float32Array([0, 0.5, -1])]))).toEqual([0.5, 0.25, -1]);
  });
});
