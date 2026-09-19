import { describe, it, expect } from 'vitest';
import { patchWebmDuration } from './webmDuration';

const bytes = (...parts: (number[] | Uint8Array)[]) => Uint8Array.from(parts.flatMap((p) => Array.from(p)));
/** 元素 = ID + 1 字节长度（<127）+ 内容 */
const el = (id: number[], body: number[] | Uint8Array) => bytes(id, [0x80 | body.length], body);
const ascii = (s: string) => Array.from(s).map((c) => c.charCodeAt(0));

const EBML = el([0x1a, 0x45, 0xdf, 0xa3], bytes(el([0x42, 0x82], ascii('webm'))));
const SEGMENT_UNKNOWN = [0x18, 0x53, 0x80, 0x67, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff];
const INFO_BODY = bytes(el([0x2a, 0xd7, 0xb1], [0x0f, 0x42, 0x40]), el([0x4d, 0x80], ascii('Chrome')), el([0x57, 0x41], ascii('Chrome')));
const INFO = el([0x15, 0x49, 0xa9, 0x66], INFO_BODY);
const TRACKS = el([0x16, 0x54, 0xae, 0x6b], [1, 2, 3, 4]);
const CLUSTER = [0x1f, 0x43, 0xb6, 0x75, 0x01, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 9, 9, 9];

/** 和 Chromium 的 MediaRecorder 写出来的文件头同一个结构 */
const file = bytes(EBML, SEGMENT_UNKNOWN, INFO, TRACKS, CLUSTER);

describe('给 WebM 补时长', () => {
  it('在 Info 段末尾加上 Duration，Info 的长度跟着改，前后的字节一个不动', () => {
    const patched = patchWebmDuration(file, 57_250)!;
    expect(patched).not.toBeNull();
    const infoStart = EBML.length + SEGMENT_UNKNOWN.length;
    expect(patched.consumed).toBe(infoStart + INFO.length);
    // Info 之前原样
    expect(Array.from(patched.head.subarray(0, infoStart + 4))).toEqual(Array.from(file.subarray(0, infoStart + 4)));
    // 新长度：8 字节写法，值 = 原内容 + Duration 元素（2 + 1 + 8）
    const size = patched.head.subarray(infoStart + 4, infoStart + 12);
    expect(size[0]).toBe(0x01);
    expect(size[7]).toBe(INFO_BODY.length + 11);
    // 原来的子元素还在，后面跟着 Duration = 57250（单位毫秒，float64）
    const body = patched.head.subarray(infoStart + 12);
    expect(Array.from(body.subarray(0, INFO_BODY.length))).toEqual(Array.from(INFO_BODY));
    expect(Array.from(body.subarray(INFO_BODY.length, INFO_BODY.length + 3))).toEqual([0x44, 0x89, 0x88]);
    expect(new DataView(body.buffer, body.byteOffset + INFO_BODY.length + 3, 8).getFloat64(0)).toBe(57_250);
    expect(patched.head.length).toBe(infoStart + 12 + INFO_BODY.length + 11);
    // 拼回去之后，Info 后面紧接着还是 Tracks
    const whole = bytes(patched.head, file.subarray(patched.consumed));
    expect(Array.from(whole.subarray(patched.head.length, patched.head.length + 4))).toEqual([0x16, 0x54, 0xae, 0x6b]);
  });

  it('时长的单位跟着 TimecodeScale 走', () => {
    const micro = bytes(EBML, SEGMENT_UNKNOWN, el([0x15, 0x49, 0xa9, 0x66], bytes(el([0x2a, 0xd7, 0xb1], [0x00, 0x03, 0xe8]))), TRACKS);   // 1000 ns = 微秒
    const patched = patchWebmDuration(micro, 2_000)!;
    const view = new DataView(patched.head.buffer, patched.head.length - 8, 8);
    expect(view.getFloat64(0)).toBe(2_000_000);
  });

  it('拿不准就不动：不是 WebM、Segment 长度已知、已经有时长、Info 没读全、时长不对', () => {
    expect(patchWebmDuration(bytes([0x00, 0x01, 0x02, 0x03]), 1000)).toBeNull();
    expect(patchWebmDuration(bytes(EBML, [0x18, 0x53, 0x80, 0x67, 0x90], INFO, TRACKS), 1000)).toBeNull();
    const withDuration = bytes(EBML, SEGMENT_UNKNOWN, el([0x15, 0x49, 0xa9, 0x66], bytes(INFO_BODY, [0x44, 0x89, 0x84, 0, 0, 0, 0])), TRACKS);
    expect(patchWebmDuration(withDuration, 1000)).toBeNull();
    expect(patchWebmDuration(file.subarray(0, EBML.length + SEGMENT_UNKNOWN.length + 10), 1000)).toBeNull();
    expect(patchWebmDuration(file, 0)).toBeNull();
    expect(patchWebmDuration(file, NaN)).toBeNull();
  });
});
