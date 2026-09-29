import { describe, expect, it } from 'vitest';
import { startPuzzle, type HiddenInfo, type PuzzleDriver } from '../harness';
import { KEYS, PHRASES } from './phrases';
import puzzle, { PHRASES_PER_ROUND } from './server';
import type { Action, State, View } from './types';

type Game = PuzzleDriver<State, View, Action>;

const seatOwning = (game: Game, key: string) =>
  game.players.findIndex((p) => p.id === game.state.owners[key]);

/** Types the whole round, each key pressed by its owner. */
function typeEverything(game: Game) {
  while (!game.solved) {
    const phrase = game.state.phrases[game.state.phraseIndex] as string;
    const key = phrase[game.state.typed] as string;
    game.act(seatOwning(game, key), { type: 'key', key });
  }
}

// With three players, which teammate owns a key you don't must stay hidden.
const hidden: HiddenInfo<State>[] = [
  {
    name: "which teammate owns seat 1's keys",
    hiddenFrom: (p) => p.seat === 0,
    change: (state) => {
      const ids = [...new Set(Object.values(state.owners))];
      const [, second, third] = ids;
      return {
        ...state,
        owners: Object.fromEntries(
          Object.entries(state.owners).map(([k, id]) => [
            k,
            id === second ? third : id === third ? second : id,
          ]),
        ) as Record<string, string>,
      };
    },
  },
];

describe('split keyboard', () => {
  it('only uses characters that are on the keyboard', () => {
    for (const phrase of PHRASES) {
      for (const ch of phrase) expect(KEYS, `"${ch}" in "${phrase}"`).toContain(ch);
    }
  });

  it('splits every key evenly between players', () => {
    for (const players of [2, 3]) {
      const game = startPuzzle(puzzle, { players });
      const counts = game.players.map((_, seat) => game.view(seat).myKeys.length);
      expect(counts.reduce((a, b) => a + b)).toBe(KEYS.length);
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    }
  });

  it('accepts the next character only from its owner', () => {
    const game = startPuzzle(puzzle, { players: 3, hidden });
    const next = game.view(0).phrase[0] as string;
    const owner = seatOwning(game, next);
    const other = (owner + 1) % 3;
    game.act(other, { type: 'key', key: next });
    expect(game.state.typed).toBe(0);
    expect(game.view(other).lastError).toMatchObject({ key: next, reason: 'not-yours' });
    game.act(owner, { type: 'key', key: next.toUpperCase() });
    expect(game.state.typed).toBe(1);
  });

  it('flags a key that is not the next character', () => {
    const game = startPuzzle(puzzle, { players: 2 });
    const phrase = game.view(0).phrase;
    const wrong = KEYS.find((k) => k !== phrase[0]) as string;
    game.act(seatOwning(game, wrong), { type: 'key', key: wrong });
    expect(game.state.typed).toBe(0);
    expect(game.view(seatOwning(game, wrong)).lastError?.reason).toBe('wrong');
  });

  it('moves through every phrase and is solved at the end', () => {
    const game = startPuzzle(puzzle, { players: 2 });
    expect(game.view(0).phraseCount).toBe(PHRASES_PER_ROUND);
    typeEverything(game);
    expect(game.solved).toBe(true);
    expect(game.score()).toEqual({ moves: 0 });
  });

  it('rejects malformed keys', () => {
    const game = startPuzzle(puzzle, { players: 2 });
    expect(game.act(0, { type: 'key', key: 'ab' })).toMatchObject({ ok: false });
    expect(game.act(0, { type: 'key', key: 5 as unknown as string })).toMatchObject({ ok: false });
  });
});
