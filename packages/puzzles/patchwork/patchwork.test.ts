import { base64ToBytes, decodeWav } from '@split-signal/shared';
import { describe, expect, it } from 'vitest';
import { startPuzzle } from '../harness';
import { hasAudio, readAudio, readPack, sentences } from './content';
import { similarity, wordDiff, words } from './scoring';
import patchwork, { MAX_TEXT, createPatchwork } from './server';

const RATE = 8000;
const tone = {
  pcm: Float32Array.from({ length: RATE * 3 }, (_, i) => 0.4 * Math.sin(i / 7)),
  sampleRate: RATE,
};
const pack = [{ id: 'fox', text: 'The quick brown fox jumps over the lazy dog.' }];
const module = createPatchwork(pack, () => tone);

const start = () =>
  startPuzzle(module, {
    players: 2,
    hidden: [
      {
        name: 'the sentence',
        hiddenFrom: () => true,
        change: (s) => ({ ...s, truth: 'Something else entirely.' }),
      },
      {
        name: 'how the clip is split',
        hiddenFrom: () => true,
        change: (s) => ({
          ...s,
          slices: s.slices.map((x) => ({ ...x, owner: x.owner ? 0 : 1 })) as typeof s.slices,
        }),
      },
    ],
  });

describe('patchwork scoring', () => {
  it('compares words, ignoring case and punctuation', () => {
    expect(words("Don't STOP, believing!")).toEqual(['dont', 'stop', 'believing']);
    expect(similarity('The quick brown fox.', 'the quick brown fox')).toBe(100);
    expect(similarity('I love math class', 'I love mathematics class')).toBe(75);
    expect(similarity('one two three four', '')).toBe(0);
    expect(similarity('a b', 'a b c d')).toBe(50);
  });

  it('explains the differences word by word', () => {
    expect(wordDiff('the knight wrote it down', 'the night wrote down').diff).toEqual([
      { kind: 'same', word: 'the' },
      { kind: 'wrong', truth: 'knight', guess: 'night' },
      { kind: 'same', word: 'wrote' },
      { kind: 'missing', truth: 'it' },
      { kind: 'same', word: 'down' },
    ]);
    expect(wordDiff('a b', 'a x b').diff).toContainEqual({ kind: 'extra', guess: 'x' });
  });
});

describe('patchwork', () => {
  it('gives each player a different half of the same clip, never the whole', () => {
    const game = start();
    const a = game.view(0);
    const b = game.view(1);
    expect(a.clip).toBe('half-0');
    expect(b.clip).toBe('half-1');
    const assetA = game.assets(0)['half-0'];
    const assetB = game.assets(1)['half-1'];
    expect(Object.keys(game.assets(0))).toEqual(['half-0']);
    expect(assetA?.mime).toBe('audio/wav');
    const pcmA = decodeWav(base64ToBytes(assetA!.data)).pcm;
    const pcmB = decodeWav(base64ToBytes(assetB!.data)).pcm;
    expect(pcmA.length).toBe(tone.pcm.length);
    // Each half matches the original where it owns the slice and not elsewhere.
    const owned = game.state.slices.find((s) => s.owner === 0 && s.end - s.start > RATE * 0.2)!;
    const mid = Math.floor((owned.start + owned.end) / 2);
    expect(pcmA[mid]).toBeCloseTo(tone.pcm[mid]!, 3);
    expect(Math.abs(pcmB[mid]! - tone.pcm[mid]!)).toBeGreaterThan(0.0001);
  });

  it('splits identically for every team from the same seed', () => {
    expect(start().state.slices).toEqual(start().state.slices);
    expect(start().assets(0)).toEqual(start().assets(0));
  });

  it('keeps one shared text, with carets that follow each other’s edits', () => {
    const game = start();
    game.act(0, { type: 'edit', op: 'insert', index: 0, text: 'the fox' });
    game.act(1, { type: 'cursor', index: 7 });
    game.act(0, { type: 'edit', op: 'insert', index: 4, text: 'quick ' });
    expect(game.state.text).toBe('the quick fox');
    expect(game.state.cursors).toEqual({ 'player-1': 10, 'player-2': 13 });
    expect(game.view(0).partnerCursor).toBe(13);
    game.act(1, { type: 'edit', op: 'delete', index: 3, count: 6 });
    expect(game.state.text).toBe('the fox');
    expect(game.state.cursors['player-1']).toBe(4);
    // Newlines become spaces and the text can't grow past the cap.
    game.act(0, { type: 'edit', op: 'insert', index: 7, text: '\njumps' });
    expect(game.state.text).toBe('the fox jumps');
    // One insert is at most 120 characters; the whole text at most MAX_TEXT.
    game.act(0, { type: 'edit', op: 'insert', index: 0, text: 'x'.repeat(400) });
    expect(game.state.text.length).toBe(13 + 120);
    game.act(0, { type: 'edit', op: 'insert', index: 0, text: 'x'.repeat(400) });
    expect(game.state.text.length).toBe(MAX_TEXT);
    expect(game.act(1, { type: 'edit', op: 'insert', index: 0, text: 'y' }).ok).toBe(false);
  });

  it('scores the text when submitted, and reveals the sentence afterwards', () => {
    const game = start();
    game.act(1, {
      type: 'edit',
      op: 'insert',
      index: 0,
      text: 'the quick brown fox jumps over a lazy dog',
    });
    expect(game.solved).toBe(false);
    game.advance(4000);
    game.act(0, { type: 'submit' });
    expect(game.solved).toBe(true);
    expect(game.score()).toEqual({ points: 89, elapsedMs: 4000 });
    expect(game.act(1, { type: 'edit', op: 'insert', index: 0, text: 'z' }).ok).toBe(false);
    expect(game.reveal(0)?.result).toMatchObject({ truth: pack[0]!.text, points: 89 });
  });

  it('scores whatever was typed if time runs out without a submit', () => {
    const game = start();
    game.act(0, { type: 'edit', op: 'insert', index: 0, text: 'the quick brown fox' });
    expect(game.score()).toEqual({ points: 44 });
  });
});

describe('patchwork content', () => {
  it('ships rendered sentences of 10-15 words with unique ids', () => {
    const all = readPack();
    expect(all.length).toBeGreaterThanOrEqual(40);
    expect(new Set(all.map((s) => s.id)).size).toBe(all.length);
    for (const s of all) {
      expect(hasAudio(s.id), `${s.id} has no WAV (run pnpm gen:patchwork)`).toBe(true);
      const count = s.text.split(/\s+/).length;
      expect(count, s.id).toBeGreaterThanOrEqual(10);
      expect(count, s.id).toBeLessThanOrEqual(15);
    }
    expect(sentences).toHaveLength(all.length);
  });

  it('stores 22.05 kHz clips a few seconds long', () => {
    const { pcm, sampleRate } = readAudio(sentences[0]!.id);
    expect(sampleRate).toBe(22050);
    expect(pcm.length / sampleRate).toBeGreaterThan(1.5);
    expect(pcm.length / sampleRate).toBeLessThan(8);
  });

  it('plays with the shipped pack', () => {
    const game = startPuzzle(patchwork, { players: 2 });
    expect(game.view(0).durationMs).toBeGreaterThan(1000);
  });
});
