import { describe, it, expect, beforeEach } from 'vitest';
import { assignSpeaker, renameSpeaker, speakerNames, initialSpeakers, saveMyVoiceprint, forgetMyVoiceprint, ME_ID, type Speaker } from './speakers';
import fixture from './__fixtures__/speakerEmbeddings.json';

/**
 * 真实的声纹：三个差异明显的合成音色（A / B / C）轮流说 12 句话，长的 8 秒、短的只有 0.4 秒（「好的」「嗯，收到」），
 * 经过和正式运行同一套 VAD 切句、同一个声纹模型（3D-Speaker CAM++）算出来的 192 维向量。
 */
const UTTERANCES = fixture as { who: string; dur: number; emb: number[] }[];

function run(utterances = UTTERANCES, start: Speaker[] = []) {
  let speakers = start;
  const labels = utterances.map((u) => { const r = assignSpeaker(speakers, u.emb, u.dur); speakers = r.speakers; return r.speakerId; });
  return { speakers, labels };
}

describe('区分说话人', () => {
  beforeEach(() => localStorage.clear());

  it('三个人、十二句话（含四句半秒的短句）：分出三个人，每一句都归对', () => {
    const { speakers, labels } = run();
    expect(speakers.map((s) => s.name)).toEqual(['说话人 1', '说话人 2', '说话人 3']);
    const truth: Record<string, string> = {};
    UTTERANCES.forEach((u, i) => { truth[u.who] ??= labels[i]!; expect(labels[i]).toBe(truth[u.who]); });
    expect(new Set(Object.values(truth)).size).toBe(3);
  });

  it('短句不能立新人：开场第一句就是半秒的「好的」，不标；后面的人照常认出来', () => {
    const short = UTTERANCES.find((u) => u.dur < 1)!;
    const { speakers, labels } = run([short, ...UTTERANCES]);
    expect(labels[0]).toBeNull();
    expect(speakers).toHaveLength(3);
  });

  it('短句不更新声纹：免得半个字把一个人的声纹带偏', () => {
    const long = UTTERANCES.find((u) => u.who === 'A' && u.dur > 3)!;
    const short = UTTERANCES.find((u) => u.who === 'A' && u.dur < 1)!;
    const first = assignSpeaker([], long.emb, long.dur);
    const second = assignSpeaker(first.speakers, short.emb, short.dur);
    expect(second.speakerId).toBe('s1');
    expect(second.speakers).toBe(first.speakers);
  });

  it('没有声纹（没开这个功能，或这一句没算出来）就不标，也不动说话人列表', () => {
    const start = run().speakers;
    expect(assignSpeaker(start, null, 5)).toEqual({ speakers: start, speakerId: null });
    expect(assignSpeaker(start, [], 5)).toEqual({ speakers: start, speakerId: null });
  });

  it('改名；改成和别人一样的名字就是合并 —— 分多了用这个合回去', () => {
    const { speakers } = run();
    const renamed = renameSpeaker(speakers, 's2', ' 老王 ');
    expect(renamed.mergedInto).toBeNull();
    expect(speakerNames(renamed.speakers)).toMatchObject({ s1: '说话人 1', s2: '老王', s3: '说话人 3' });
    const merged = renameSpeaker(renamed.speakers, 's3', '老王');
    expect(merged.mergedInto).toBe('s2');
    expect(merged.speakers.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(merged.speakers[1].count).toBe(speakers[1].count + speakers[2].count);
    // 空名字、同名、不存在的人：什么都不变
    expect(renameSpeaker(speakers, 's1', '  ').speakers).toBe(speakers);
    expect(renameSpeaker(speakers, 's9', '谁').speakers).toBe(speakers);
    // 合并之后再来新人，编号接着往下排，不和已有的撞
    const c = UTTERANCES.find((u) => u.who === 'C' && u.dur > 3)!;
    const onlyAB = renameSpeaker(speakers, 's3', '说话人 1');   // 把 C 错并进 A 之后，C 的长句还是更像合并后的那个人
    expect(onlyAB.mergedInto).toBe('s1');
    expect(assignSpeaker(onlyAB.speakers, c.emb, c.dur).speakerId).toBe('s1');
  });

  it('「这是我」：记住声纹之后，新的一场里我一开口就标成「我」，别人照常编号', () => {
    const { speakers } = run();
    saveMyVoiceprint(speakers[1]);                     // B 是我
    const next = run(UTTERANCES, initialSpeakers());
    expect(next.speakers.map((s) => s.name)).toEqual(['我', '说话人 1', '说话人 2']);
    UTTERANCES.forEach((u, i) => { if (u.who === 'B') expect(next.labels[i]).toBe(ME_ID); else expect(next.labels[i]).not.toBe(ME_ID); });
    forgetMyVoiceprint();
    expect(initialSpeakers()).toEqual([]);
  });
});
