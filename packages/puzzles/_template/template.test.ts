import { describe, expect, it } from 'vitest';
import { runPuzzleScript, startPuzzle, type HiddenInfo } from '../harness';
import puzzle from './server';
import { MAX_NUMBER, type State } from './types';

// Tell the harness what each player must not know. It changes the secret and checks that the
// guessers' views come out identical, after every step of every test.
const hidden: HiddenInfo<State>[] = [
  {
    name: 'the secret number',
    hiddenFrom: (player) => player.seat !== 0,
    change: (state) => ({ ...state, secret: (state.secret % MAX_NUMBER) + 1 }),
  },
];

const notThe = (secret: number) => (secret === 1 ? 2 : 1);

describe('template: guess the number', () => {
  it('is solved when a guesser says the secret', () => {
    runPuzzleScript(puzzle, {
      players: 2,
      seed: 'fixed-seed',
      hidden,
      steps: (state) => [
        { seat: 0, action: { type: 'guess', value: state.secret }, expect: 'reject' },
        { seat: 1, action: { type: 'guess', value: notThe(state.secret) } },
        { seat: 1, action: { type: 'guess', value: state.secret } },
      ],
      expectSolved: true,
      expectScore: { moves: 2 },
    });
  });

  it('rejects out-of-range and malformed guesses', () => {
    const game = startPuzzle(puzzle, { players: 3, hidden });
    expect(game.act(2, { type: 'guess', value: 99 })).toMatchObject({ ok: false });
    expect(game.act(2, { type: 'guess', value: 2.5 })).toMatchObject({ ok: false });
    expect(game.solved).toBe(false);
  });

  it('only shows the secret to the knower', () => {
    const game = startPuzzle(puzzle, { players: 2 });
    expect(game.view(0)).toMatchObject({ role: 'knower', secret: game.state.secret });
    expect(game.view(1)).toEqual({ role: 'guesser', guesses: [], solved: false });
  });
});
