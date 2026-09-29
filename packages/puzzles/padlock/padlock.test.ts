import { describe, expect, it } from 'vitest';
import { startPuzzle, type HiddenInfo, type PuzzleDriver } from '../harness';
import puzzle, { DIALS_PER_PLAYER, TURN_MS } from './server';
import type { Action, State, View } from './types';

// Nobody may learn the combination from their view.
const hidden: HiddenInfo<State>[] = [
  {
    name: 'the combination',
    hiddenFrom: () => true,
    change: (state) => ({
      ...state,
      combination: state.combination.map((c) => (c + 1) % 10),
    }),
  },
];

type Game = PuzzleDriver<State, View, Action>;

/** Steer every dial onto its number, two players each moving one dial per turn. */
function solve(game: Game) {
  for (let guard = 0; guard < 200 && !game.solved; guard++) {
    for (let seat = 0; seat < game.players.length; seat++) {
      const { dials, combination, owners } = game.state;
      const mine = owners.flatMap((id, i) => (id === game.player(seat).id ? [i] : []));
      const dial = mine.find((i) => dials[i] !== combination[i]);
      if (dial === undefined) game.act(seat, { type: 'hold' });
      else game.act(seat, { type: 'turn', dial, dir: 1 });
      if (game.solved) break;
    }
  }
}

describe('padlock', () => {
  it('gives each player two dials and shows everyone every dial', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    expect(game.state.dials).toHaveLength(2 * DIALS_PER_PLAYER);
    expect(game.view(0).mine).toEqual([0, 1]);
    expect(game.view(1).mine).toEqual([2, 3]);
    expect(game.view(1).dials).toEqual(game.state.dials);
    expect(game.view(0).dialSeats).toEqual([0, 0, 1, 1]);
  });

  it('scales to six dials for three players', () => {
    const game = startPuzzle(puzzle, { players: 3, hidden });
    expect(game.state.dials).toHaveLength(6);
    expect(game.view(2).mine).toEqual([4, 5]);
  });

  it('resolves both turns together and wraps 9 to 0', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    const [d0, , d2] = game.state.dials as [number, number, number, number];
    game.act(0, { type: 'turn', dial: 0, dir: -1 });
    expect(game.state.dials[0]).toBe(d0); // not yet: waiting for seat 1
    expect(game.view(1).teammatesReady).toBe(1);
    game.act(1, { type: 'turn', dial: 2, dir: 1 });
    expect(game.state.dials[0]).toBe((d0 + 9) % 10);
    expect(game.state.dials[2]).toBe((d2 + 1) % 10);
    expect(game.state.turns).toBe(1);
  });

  it('chimes when a moved dial lands on its number, buzzes otherwise, silent on holds', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    const { combination, dials } = game.state;
    // Move dial 0 toward its number; hold the other player.
    const landing = ((dials[0] as number) + 1) % 10 === combination[0];
    game.act(0, { type: 'turn', dial: 0, dir: 1 });
    game.act(1, { type: 'hold' });
    expect(game.state.history[0]?.sound).toBe(landing ? 'chime' : 'buzz');

    game.act(0, { type: 'hold' });
    game.act(1, { type: 'hold' });
    expect(game.state.history[1]?.sound).toBeNull();
  });

  it('keeps choices secret until the turn resolves', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    game.act(0, { type: 'turn', dial: 1, dir: 1 });
    const view = game.view(1);
    expect(view.myChoice).toBeNull();
    expect(view.teammatesReady).toBe(1);
    expect(JSON.stringify(view)).not.toContain('"dir"');
  });

  it("rejects turning someone else's dial and malformed actions", () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    expect(game.act(0, { type: 'turn', dial: 2, dir: 1 })).toMatchObject({ ok: false });
    expect(game.act(0, { type: 'turn', dial: 0, dir: 2 as 1 })).toMatchObject({ ok: false });
  });

  it('resolves on the turn timer', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    game.act(0, { type: 'turn', dial: 0, dir: 1 });
    game.advance(TURN_MS);
    expect(game.state.turns).toBe(1);
    expect(game.state.history[0]?.moved).toHaveLength(1);
  });

  it('opens when every dial is right, scored in turns', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden, seed: 'open-sesame' });
    solve(game);
    expect(game.solved).toBe(true);
    expect(game.state.open).toBe(true);
    expect(game.score()).toEqual({ moves: game.state.turns });
  });
});
