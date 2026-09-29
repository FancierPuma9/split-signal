import { describe, expect, it } from 'vitest';
import { startPuzzle, type HiddenInfo, type PuzzleDriver } from '../harness';
import puzzle, { MAX_TARGET_PLAYS, NOTE_COUNT, PLAYBACK_MS } from './server';
import type { Action, State, View } from './types';

// Arrangers are deaf: shifting every pitch must not change their view at all.
const hidden: HiddenInfo<State>[] = [
  {
    name: 'every pitch',
    hiddenFrom: (p) => p.seat !== 0,
    change: (state) => ({
      ...state,
      tiles: state.tiles.map((t) => ({ ...t, pitch: t.pitch + 1 })),
    }),
  },
];

type Game = PuzzleDriver<State, View, Action>;

/** Selection-sort the slots into the answer using swaps, as seat `seat`. */
function arrange(game: Game, seat = 1) {
  for (let i = 0; i < game.state.answer.length; i++) {
    const j = game.state.slots.indexOf(game.state.answer[i] as string);
    if (j !== i) game.act(seat, { type: 'swap', a: i, b: j });
  }
}

describe('melody sort', () => {
  it('gives the listener pitches and the arranger only symbols', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    const listener = game.view(0);
    const arranger = game.view(1);
    expect(listener.role).toBe('listener');
    expect(arranger.role).toBe('arranger');
    if (listener.role !== 'listener' || arranger.role !== 'arranger') return;
    expect(listener.target).toHaveLength(NOTE_COUNT);
    expect(arranger.slots).toHaveLength(NOTE_COUNT);
    expect(JSON.stringify(arranger)).not.toMatch(/pitch|target/);
  });

  it('starts scrambled with distinct notes', () => {
    const game = startPuzzle(puzzle, { players: 2 });
    expect(game.state.slots).not.toEqual(game.state.answer);
    expect(new Set(game.state.tiles.map((t) => t.pitch)).size).toBe(NOTE_COUNT);
  });

  it('is solved when the correct arrangement is played', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    arrange(game);
    expect(game.solved).toBe(false); // not until it's played
    game.act(1, { type: 'play' });
    expect(game.solved).toBe(true);
  });

  it('lets the listener hear each playback, and blocks replaying mid-playback', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    game.act(1, { type: 'play' });
    const listener = game.view(0);
    if (listener.role !== 'listener') throw new Error('expected listener');
    expect(listener.playback?.id).toBe(1);
    expect(listener.playback?.pitches).toHaveLength(NOTE_COUNT);
    expect(game.act(1, { type: 'play' })).toMatchObject({ ok: false });
    game.advance(PLAYBACK_MS);
    expect(game.act(1, { type: 'play' })).toMatchObject({ ok: true });
  });

  it('limits target replays', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    for (let i = 0; i < MAX_TARGET_PLAYS; i++) game.act(0, { type: 'replay' });
    expect(game.act(0, { type: 'replay' })).toMatchObject({ ok: false });
  });

  it('keeps roles apart', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    expect(game.act(0, { type: 'swap', a: 0, b: 1 })).toMatchObject({ ok: false });
    expect(game.act(0, { type: 'play' })).toMatchObject({ ok: false });
    expect(game.act(1, { type: 'replay' })).toMatchObject({ ok: false });
    expect(game.act(1, { type: 'swap', a: 0, b: 9 })).toMatchObject({ ok: false });
  });

  it('splits tiles between two arrangers, who can only move their own', () => {
    const game = startPuzzle(puzzle, { players: 3, hidden });
    const a = game.view(1);
    const b = game.view(2);
    if (a.role !== 'arranger' || b.role !== 'arranger') throw new Error('expected arrangers');
    expect(a.slots.filter((s) => s.mine)).toHaveLength(NOTE_COUNT / 2);
    expect(b.slots.filter((s) => s.mine)).toHaveLength(NOTE_COUNT / 2);
    const theirs = b.slots.flatMap((s, i) => (s.mine ? [i] : []));
    expect(game.act(1, { type: 'swap', a: theirs[0]!, b: theirs[1]! })).toMatchObject({
      ok: false,
    });
  });
});
