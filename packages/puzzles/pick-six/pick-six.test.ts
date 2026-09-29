import { describe, expect, it } from 'vitest';
import { startPuzzle, type HiddenInfo } from '../harness';
import { PICK_MS, REVEAL_MS, TURNS } from './manifest';
import { scoreTurn } from './scoring';
import puzzle from './server';
import type { State } from './types';

// Players t1-p1, t1-p2 (team-1) and t2-p1, t2-p2 (team-2); t3-* when there are three teams.
const teamOf = {
  a1: 't1',
  a2: 't1',
  b1: 't2',
  b2: 't2',
  c1: 't3',
};

describe('pick six: scoring', () => {
  it('scores face value, with hunters taking their prey across teams', () => {
    expect(scoreTurn({ a1: 5, a2: 3, b1: 4, b2: 6 }, teamOf)).toEqual({
      players: { a1: 5, a2: 7, b1: 0, b2: 6 },
      teams: { t1: 12, t2: 6 },
    });
  });

  it('counts a number two teammates both picked once', () => {
    expect(scoreTurn({ a1: 5, a2: 5, b1: 2, b2: 1 }, teamOf).teams).toEqual({ t1: 0, t2: 8 });
    expect(scoreTurn({ a1: 4, a2: 4, b1: 5, b2: 5 }, teamOf).teams).toEqual({ t1: 4, t2: 5 });
  });

  it('never lets you hunt your own partner', () => {
    expect(scoreTurn({ a1: 1, a2: 6, b1: 2, b2: 3 }, teamOf).players).toEqual({
      a1: 1,
      a2: 6,
      b1: 2,
      b2: 3,
    });
  });

  it('pays every hunter in full, from any other team', () => {
    expect(scoreTurn({ a1: 1, b1: 1, c1: 6 }, teamOf).players).toEqual({ a1: 7, b1: 7, c1: 0 });
    // Only prey on another team counts: b1's partner picked the 6.
    expect(scoreTurn({ a1: 1, b1: 1, b2: 6 }, teamOf).players).toEqual({ a1: 7, b1: 1, b2: 0 });
  });

  it('scores nothing for no pick', () => {
    expect(scoreTurn({ a1: null, a2: 2, b1: null, b2: null }, teamOf)).toEqual({
      players: { a1: 0, a2: 2, b1: 0, b2: 0 },
      teams: { t1: 2, t2: 0 },
    });
  });
});

const hidden: HiddenInfo<State>[] = [
  {
    name: "the other players' picks this turn",
    hiddenFrom: (p) => p.id !== 't2-p1',
    // Whether they've picked is public; what they picked isn't.
    change: (state) => ({
      ...state,
      picks: { ...state.picks, 't2-p1': (state.picks['t2-p1']! % 6) + 1 },
    }),
    until: (state) => !('t2-p1' in state.picks),
  },
];

const everyonePicks = (
  game: ReturnType<typeof startPuzzle<State, unknown, unknown>>,
  ns: number[],
) => ns.forEach((n, seat) => game.act(seat, { type: 'pick', n }));

describe('pick six', () => {
  it('keeps picks secret until everyone is in, then reveals and scores', () => {
    const game = startPuzzle(puzzle, { teams: [2, 2], hidden });
    game.act(0, { type: 'pick', n: 5 });
    expect(game.view(0)).toMatchObject({ myPick: 5, picked: ['t1-p1'], phase: 'pick', last: null });
    expect(game.view(1)).toMatchObject({ myPick: null, picked: ['t1-p1'] });
    everyonePicks(game as never, [5, 3, 4, 6]);
    const view = game.view(2);
    expect(view).toMatchObject({ phase: 'reveal', turn: 1, totals: { 'team-1': 12, 'team-2': 6 } });
    expect(view.last?.picks).toEqual({ 't1-p1': 5, 't1-p2': 3, 't2-p1': 4, 't2-p2': 6 });
    expect(game.act(0, { type: 'pick', n: 1 })).toMatchObject({ ok: false });
    game.advance(REVEAL_MS);
    expect(game.view(0)).toMatchObject({ phase: 'pick', myPick: null, picked: [] });
  });

  it('closes the turn when the timer runs out, scoring missing picks as 0', () => {
    const game = startPuzzle(puzzle, { teams: [2, 2], hidden });
    game.act(0, { type: 'pick', n: 4 });
    game.advance(PICK_MS);
    expect(game.view(0).last?.picks).toEqual({
      't1-p1': 4,
      't1-p2': null,
      't2-p1': null,
      't2-p2': null,
    });
    expect(game.view(0).totals).toEqual({ 'team-1': 4, 'team-2': 0 });
  });

  it(`ends after ${TURNS} turns with each team's total`, () => {
    const game = startPuzzle(puzzle, { teams: [2, 2], hidden });
    for (let t = 0; t < TURNS; t++) {
      expect(game.solved).toBe(false);
      everyonePicks(game as never, [6, 5, 2, 2]);
      game.advance(REVEAL_MS);
    }
    expect(game.solved).toBe(true);
    // Team 2's 2 hunts team 1's 5 (7), deduped; team 1 keeps its 6.
    expect(game.score()).toEqual({ teams: { 'team-1': { points: 60 }, 'team-2': { points: 70 } } });
    expect(game.reveal(0)).toMatchObject({ over: true, turn: TURNS });
  });

  it('only takes whole numbers from 1 to 6', () => {
    const game = startPuzzle(puzzle, { teams: [2, 2], hidden });
    for (const n of [0, 7, 2.5])
      expect(game.act(0, { type: 'pick', n })).toMatchObject({ ok: false });
    expect(game.act(0, { type: 'pick', n: 3 })).toMatchObject({ ok: true });
    expect(game.act(0, { type: 'pick', n: 4 })).toMatchObject({ ok: true });
    expect(game.view(0).myPick).toBe(4);
  });

  it('works with three teams', () => {
    const game = startPuzzle(puzzle, { teams: [2, 2, 2], hidden });
    everyonePicks(game as never, [1, 2, 1, 3, 6, 4]);
    // 1 hunts team 3's 6 (7) + 2 (no 5 about); 1 + 3 hunt the 6 and the 4 (7 + 7); both zeroed.
    expect(game.view(0).totals).toEqual({ 'team-1': 9, 'team-2': 14, 'team-3': 0 });
  });
});
