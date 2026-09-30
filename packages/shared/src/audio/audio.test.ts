import { describe, expect, it } from 'vitest';
import { createRng } from '../rng';
import { maskedClip, pinkNoise, rms, splitClip, transformPcm } from './pcm';
import { base64ToBytes, bytesToBase64, decodeWav, encodeWav } from './wav';

const RATE = 8000;

/** A clip made of 100ms blocks, block i holding the constant value (i + 1) / 100. */
function blocks(count: number): Float32Array {
  const len = RATE / 10;
  const pcm = new Float32Array(count * len);
  for (let i = 0; i < count; i++) pcm.fill((i + 1) / 100, i * len, (i + 1) * len);
  return pcm;
}

describe('transformPcm', () => {
  it('reverses', () => {
    const pcm = Float32Array.from([1, 2, 3, 4].map((n) => n / 10));
    expect([...transformPcm(pcm, RATE, { kind: 'reverse' }, createRng('x'))]).toEqual(
      [...pcm].reverse(),
    );
  });

  it('shuffles whole slices in a seeded order, keeping the length', () => {
    const pcm = blocks(10);
    const shuffle = { kind: 'shuffle', sliceMs: 100 } as const;
    const out = transformPcm(pcm, RATE, shuffle, createRng('seed'));
    expect(out.length).toBe(pcm.length);
    // The middle of each output slice is some input block, and every block appears once.
    const middles = Array.from({ length: 10 }, (_, i) => out[i * 800 + 400]);
    expect([...middles].sort()).toEqual(
      Array.from({ length: 10 }, (_, i) => Math.fround((i + 1) / 100)).sort(),
    );
    expect(middles).not.toEqual(Array.from({ length: 10 }, (_, i) => Math.fround((i + 1) / 100)));
    expect([...transformPcm(pcm, RATE, shuffle, createRng('seed'))]).toEqual([...out]);
    // Edges are faded so the cuts don't click.
    expect(out[0]).toBe(0);
  });
});

describe('splitClip', () => {
  it('covers the clip with in-range slices dealt to both players, runs of three at most', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      const length = RATE * 6;
      const slices = splitClip(length, RATE, createRng(seed), {
        minSliceMs: 300,
        maxSliceMs: 2500,
      });
      expect(slices[0]?.start).toBe(0);
      expect(slices.at(-1)?.end).toBe(length);
      let run = 0;
      slices.forEach((s, i) => {
        if (i > 0) expect(s.start).toBe(slices[i - 1]?.end);
        expect(s.end - s.start).toBeGreaterThanOrEqual(RATE * 0.3);
        run = i > 0 && slices[i - 1]?.owner === s.owner ? run + 1 : 1;
        expect(run).toBeLessThanOrEqual(3);
      });
      expect(new Set(slices.map((s) => s.owner)).size).toBe(2);
      expect(
        splitClip(length, RATE, createRng(seed), { minSliceMs: 300, maxSliceMs: 2500 }),
      ).toEqual(slices);
    }
  });
});

describe('maskedClip', () => {
  it("keeps a player's own slices and hides the rest under noise of the same loudness", () => {
    const pcm = new Float32Array(RATE * 2);
    for (let i = 0; i < pcm.length; i++) pcm[i] = 0.3 * Math.sin(i / 5);
    const slices = [
      { start: 0, end: RATE, owner: 0 as const },
      { start: RATE, end: RATE * 2, owner: 1 as const },
    ];
    const mine = maskedClip(pcm, RATE, slices, 0, createRng('m'));
    expect(mine.length).toBe(pcm.length);
    // Away from the crossfade, the first half is untouched and the second is noise.
    for (let i = 0; i < RATE - 200; i += 97) expect(mine[i]).toBeCloseTo(pcm[i] ?? 0, 6);
    const noise = mine.subarray(RATE + 200);
    expect(rms(noise)).toBeCloseTo(rms(pcm), 1);
    expect([...noise.subarray(0, 50)]).not.toEqual([...pcm.subarray(RATE + 200, RATE + 250)]);
  });

  it('makes seeded pink noise at a target loudness', () => {
    const noise = pinkNoise(RATE, 0.1, createRng('n'));
    expect(rms(noise)).toBeCloseTo(0.1, 5);
    expect([...pinkNoise(RATE, 0.1, createRng('n'))]).toEqual([...noise]);
  });
});

describe('WAV and base64', () => {
  it('round-trips mono 16-bit audio', () => {
    const pcm = Float32Array.from({ length: 500 }, (_, i) => Math.sin(i / 10) * 0.8);
    const decoded = decodeWav(encodeWav(pcm, 22050));
    expect(decoded.sampleRate).toBe(22050);
    expect(decoded.pcm.length).toBe(500);
    decoded.pcm.forEach((s, i) => expect(s).toBeCloseTo(pcm[i] ?? 0, 3));
  });

  it('encodes base64 like everyone else', () => {
    const hello = Uint8Array.from([104, 101, 108, 108, 111]);
    expect(bytesToBase64(hello)).toBe('aGVsbG8=');
    expect([...base64ToBytes('aGVsbG8=')]).toEqual([...hello]);
    const wav = encodeWav(Float32Array.from([0.1, -0.2, 0.3]), 8000);
    expect([...base64ToBytes(bytesToBase64(wav))]).toEqual([...wav]);
  });

  it('refuses what it cannot read', () => {
    expect(() => decodeWav(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toThrow();
  });
});
