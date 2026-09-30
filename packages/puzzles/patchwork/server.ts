import {
  bytesToBase64,
  createRng,
  encodeWav,
  maskedClip,
  splitClip,
  type Context,
  type DecodedWav,
  type PuzzleAsset,
  type PuzzleServerModule,
} from '@split-signal/shared';
import { readAudio, sentences, type Sentence } from './content';
import { manifest } from './manifest';
import { similarity, wordDiff } from './scoring';
import type { Action, State, View } from './types';

/** Slice lengths for splitting the sentence between the two players. */
export const SLICE_MS = { minSliceMs: 300, maxSliceMs: 2500 };
/** The longest the shared guess can get. */
export const MAX_TEXT = 240;
const MAX_INSERT = 120;

/** Which half of the clip a player hears: seat 0 gets one, seat 1 the other. */
function halfOf(ctx: Pick<Context, 'players'>, playerId: string): 0 | 1 {
  const seat = ctx.players.find((p) => p.id === playerId)?.seat ?? 0;
  return seat % 2 === 0 ? 0 : 1;
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

/** Moves the other carets to follow an edit at `index` that changed the length by `delta`. */
function shiftCursors(
  cursors: Record<string, number>,
  editor: string,
  index: number,
  delta: number,
  editorAt: number,
): Record<string, number> {
  const next: Record<string, number> = {};
  for (const [id, at] of Object.entries(cursors)) {
    if (id === editor) continue;
    if (delta >= 0) next[id] = at > index ? at + delta : at;
    else next[id] = at > index - delta ? at + delta : Math.min(at, index);
  }
  next[editor] = editorAt;
  return next;
}

/** Builds the puzzle from a sentence pack. The default export uses the shipped, rendered pack. */
export function createPatchwork(
  pack: readonly Sentence[],
  audioOf: (id: string) => DecodedWav,
): PuzzleServerModule<State, View, Action> {
  if (pack.length === 0) throw new Error('Patchwork needs at least one rendered sentence');
  // Every team hears the same halves, so each half is built once per round and shared.
  const clips = new Map<string, PuzzleAsset>();

  const buildHalf = (state: State, half: 0 | 1): PuzzleAsset => {
    const key = `${state.noiseSeed}:${state.sentenceId}:${half}`;
    let asset = clips.get(key);
    if (!asset) {
      const { pcm, sampleRate } = audioOf(state.sentenceId);
      const masked = maskedClip(
        pcm,
        sampleRate,
        state.slices,
        half,
        createRng(`${state.noiseSeed}:${half}`),
      );
      asset = { mime: 'audio/wav', data: bytesToBase64(encodeWav(masked, sampleRate)) };
      if (clips.size >= 12) clips.clear();
      clips.set(key, asset);
    }
    return asset;
  };

  const view = (state: State, playerId: string, ctx: Context): View => {
    const partner = ctx.players.find((p) => p.id !== playerId);
    return {
      clip: `half-${halfOf(ctx, playerId)}`,
      durationMs: state.durationMs,
      text: state.text,
      maxLength: MAX_TEXT,
      partnerCursor: partner ? (state.cursors[partner.id] ?? null) : null,
      partnerName: partner?.name ?? null,
      submitted: state.submittedBy !== null,
    };
  };

  return {
    manifest,

    init({ rng, seed, players }) {
      if (players.length < 2) throw new Error('Patchwork needs 2 players');
      const sentence = rng.pick(pack);
      const { pcm, sampleRate } = audioOf(sentence.id);
      return {
        sentenceId: sentence.id,
        truth: sentence.text,
        slices: splitClip(pcm.length, sampleRate, rng.fork('slices'), SLICE_MS),
        noiseSeed: `${seed}:patchwork:noise`,
        durationMs: Math.round((pcm.length / sampleRate) * 1000),
        text: '',
        cursors: {},
        submittedBy: null,
        submittedAt: null,
      };
    },

    view,

    assets(state, playerId, ctx) {
      const half = halfOf(ctx, playerId);
      return { [`half-${half}`]: () => buildHalf(state, half) };
    },

    apply(state, playerId, action, ctx) {
      if (action?.type === 'submit') {
        return { state: { ...state, submittedBy: playerId, submittedAt: ctx.elapsedMs } };
      }
      if (action?.type === 'cursor') {
        if (!Number.isInteger(action.index)) return { reject: 'Bad cursor' };
        const at = clamp(action.index, 0, state.text.length);
        if (state.cursors[playerId] === at) return { state };
        return { state: { ...state, cursors: { ...state.cursors, [playerId]: at } } };
      }
      if (action?.type !== 'edit' || !Number.isInteger(action.index)) {
        return { reject: 'Unknown action' };
      }
      const index = clamp(action.index, 0, state.text.length);
      if (action.op === 'insert') {
        if (typeof action.text !== 'string') return { reject: 'Bad edit' };
        const room = MAX_TEXT - state.text.length;
        const typed = action.text.replace(/[\r\n\t]+/g, ' ').slice(0, Math.min(MAX_INSERT, room));
        if (typed === '') return room > 0 ? { state } : { reject: "That's as long as it gets" };
        const text = state.text.slice(0, index) + typed + state.text.slice(index);
        const cursors = shiftCursors(
          state.cursors,
          playerId,
          index,
          typed.length,
          index + typed.length,
        );
        return { state: { ...state, text, cursors } };
      }
      if (action.op === 'delete') {
        if (!Number.isInteger(action.count) || action.count < 1) return { reject: 'Bad edit' };
        const count = Math.min(action.count, state.text.length - index);
        if (count === 0) return { state };
        const text = state.text.slice(0, index) + state.text.slice(index + count);
        const cursors = shiftCursors(state.cursors, playerId, index, -count, index);
        return { state: { ...state, text, cursors } };
      }
      return { reject: 'Unknown edit' };
    },

    reveal(state, playerId, ctx) {
      return {
        ...view(state, playerId, ctx),
        result: {
          truth: state.truth,
          guess: state.text,
          points: similarity(state.truth, state.text),
          diff: wordDiff(state.truth, state.text).diff,
        },
      };
    },

    isSolved: (state) => state.submittedBy !== null,

    score: (state) => ({
      points: similarity(state.truth, state.text),
      ...(state.submittedAt !== null ? { elapsedMs: state.submittedAt } : {}),
    }),
  };
}

export default createPatchwork(sentences, readAudio);
