import { describe, expect, it } from 'vitest';
import { startPuzzle, type HiddenInfo, type PuzzleDriver } from '../harness';
import puzzle, { MAX_TARGET_PLAYS, NOTE_COUNT, PLAYBACK_MS } from './server';
import type { Action, State, View } from './types';

// Arrangers are deaf: shifting every pitch must not change their view at all.
const hidden: HiddenInfo<State>[] = [
  {
    name: 'every pitch',
    hiddenFrom: (p, s) => p.id !== s.listener,
    change: (state) => ({
      ...state,
      tiles: state.tiles.map((t) => ({ ...t, pitch: t.pitch + 1 })),
    }),
  },
];

type Game = PuzzleDriver<State, View, Action>;

/** Which seats got which job (they're dealt at random). */
function jobs(game: Game) {
  const listener = game.players.findIndex((p) => p.id === game.state.listener);
  const arrangers = game.players.map((_, seat) => seat).filter((seat) => seat !== listener);
  return { listener, arranger: arrangers[0]!, arrangers };
}

/** Selection-sort the slots into the answer using swaps, as seat `seat`. */
function arrange(game: Game, seat = jobs(game).arranger) {
  for (let i = 0; i < game.state.answer.length; i++) {
    const j = game.state.slots.indexOf(game.state.answer[i] as string);
    if (j !== i) game.act(seat, { type: 'swap', a: i, b: j });
  }
}

describe('melody sort', () => {
  it('gives the listener pitches and the arranger only symbols', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    const listener = game.view(jobs(game).listener);
    const arranger = game.view(jobs(game).arranger);
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
    game.act(jobs(game).arranger, { type: 'play' });
    expect(game.solved).toBe(true);
  });

  it('lets the listener hear each playback, and blocks replaying mid-playback', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    const seats = jobs(game);
    game.act(seats.arranger, { type: 'play' });
    const listener = game.view(seats.listener);
    if (listener.role !== 'listener') throw new Error('expected listener');
    expect(listener.playback?.id).toBe(1);
    expect(listener.playback?.pitches).toHaveLength(NOTE_COUNT);
    expect(game.act(seats.arranger, { type: 'play' })).toMatchObject({ ok: false });
    game.advance(PLAYBACK_MS);
    expect(game.act(seats.arranger, { type: 'play' })).toMatchObject({ ok: true });
  });

  it('limits target replays', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    const { listener } = jobs(game);
    for (let i = 0; i < MAX_TARGET_PLAYS; i++) game.act(listener, { type: 'replay' });
    expect(game.act(listener, { type: 'replay' })).toMatchObject({ ok: false });
  });

  it('keeps roles apart', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    const { listener, arranger } = jobs(game);
    expect(game.act(listener, { type: 'swap', a: 0, b: 1 })).toMatchObject({ ok: false });
    expect(game.act(listener, { type: 'play' })).toMatchObject({ ok: false });
    expect(game.act(arranger, { type: 'replay' })).toMatchObject({ ok: false });
    expect(game.act(arranger, { type: 'swap', a: 0, b: 9 })).toMatchObject({ ok: false });
  });

  it('deals the listener job to a random player, without changing the melody', () => {
    const listeners = new Set<number>();
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const game = startPuzzle(puzzle, { players: 3, seed });
      listeners.add(jobs(game).listener);
      const pitches = game.state.tiles.map((t) => t.pitch);
      const duo = startPuzzle(puzzle, { players: 2, seed });
      expect(duo.state.tiles.map((t) => t.pitch)).toEqual(pitches);
    }
    expect(listeners.size).toBeGreaterThan(1);
  });

  it('splits tiles between two arrangers, who can only move their own', () => {
    const game = startPuzzle(puzzle, { players: 3, hidden });
    const [first, second] = jobs(game).arrangers as [number, number];
    const a = game.view(first);
    const b = game.view(second);
    if (a.role !== 'arranger' || b.role !== 'arranger') throw new Error('expected arrangers');
    expect(a.slots.filter((s) => s.mine)).toHaveLength(NOTE_COUNT / 2);
    expect(b.slots.filter((s) => s.mine)).toHaveLength(NOTE_COUNT / 2);
    const theirs = b.slots.flatMap((s, i) => (s.mine ? [i] : []));
    expect(game.act(first, { type: 'swap', a: theirs[0]!, b: theirs[1]! })).toMatchObject({
      ok: false,
    });
  });
});
