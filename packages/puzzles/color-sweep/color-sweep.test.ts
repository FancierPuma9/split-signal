import { describe, expect, it } from 'vitest';
import { startPuzzle, type HiddenInfo } from '../harness';
import { SWEEP_MS, TOTAL_MS, colorAt, sweepAt, sweepT } from './gradient';
import puzzle from './server';
import type { LockerView, RevealView, SpotterView, State } from './types';

const hidden: HiddenInfo<State>[] = [
  {
    name: 'the target colour',
    hiddenFrom: (player) => player.seat === 1,
    change: (state) => ({ ...state, target: state.target > 0.5 ? 0.2 : 0.8 }),
    until: (state) => state.lock !== null,
  },
];

describe('color sweep: the sweep', () => {
  it('runs there and back at constant speed', () => {
    expect([0, 3000, 6000, 9000, 12000, 15000].map(sweepT)).toEqual([0, 0.5, 1, 0.5, 0, 0.5]);
    expect(sweepAt(0)).toEqual({ sweep: 1, forward: true });
    expect(sweepAt(7000)).toEqual({ sweep: 1, forward: false });
    expect(sweepAt(12_000)).toEqual({ sweep: 2, forward: true });
    expect(sweepAt(TOTAL_MS + 5000)).toEqual({ sweep: 5, forward: false });
  });

  it('blends evenly between stops', () => {
    const stops = [
      { r: 0, g: 0, b: 0 },
      { r: 200, g: 100, b: 0 },
      { r: 200, g: 100, b: 200 },
    ];
    expect(colorAt(stops, 0)).toEqual(stops[0]);
    expect(colorAt(stops, 0.25)).toEqual({ r: 100, g: 50, b: 0 });
    expect(colorAt(stops, 1)).toEqual(stops[2]);
  });
});

describe('color sweep', () => {
  it('shows the target to the Spotter only', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    const spotter = game.view(0) as SpotterView;
    const locker = game.view(1) as LockerView;
    expect(spotter).toMatchObject({ role: 'spotter', target: game.state.target, lock: null });
    expect(locker).toMatchObject({ role: 'locker', result: null });
    expect(locker).not.toHaveProperty('target');
    expect(locker.stops).toHaveLength(5);
  });

  it('builds the same varied gradient for every team, with the target inside', () => {
    for (let i = 0; i < 40; i++) {
      const a = startPuzzle(puzzle, { players: 2, seed: `g-${i}` }).state;
      const b = startPuzzle(puzzle, { players: 2, seed: `g-${i}` }).state;
      expect(a.stops).toEqual(b.stops);
      expect(a.target).toBeGreaterThanOrEqual(0.1);
      expect(a.target).toBeLessThanOrEqual(0.9);
      for (const c of a.stops) {
        for (const v of [c.r, c.g, c.b])
          expect(Number.isInteger(v) && v >= 0 && v <= 255).toBe(true);
      }
    }
  });

  it('scores a lock on the target at 100, and further off less', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    game.advance(Math.round(game.state.target * SWEEP_MS));
    game.act(1, { type: 'lock' });
    expect(game.solved).toBe(true);
    expect(game.score().points).toBeGreaterThan(99.8);

    const late = startPuzzle(puzzle, { players: 2 });
    const t = late.state.target;
    // On the way back, a quarter of the gradient past the target.
    late.advance(Math.round((2 - Math.min(1, t + 0.25)) * SWEEP_MS));
    late.act(1, { type: 'lock' });
    expect(late.score().points).toBeCloseTo(
      100 - Math.round(Math.abs(Math.min(1, t + 0.25) - t) * 1000) / 10,
      0,
    );
  });

  it('shows everyone the result once locked', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    game.advance(2000);
    game.act(1, { type: 'lock' });
    const view = game.view(1) as LockerView;
    expect(view.lock).toEqual({ at: 2000, t: 0.333 });
    expect(view.result).toMatchObject({ target: game.state.target, lockT: 0.333 });
    expect(view.result?.points).toBe(game.score().points);
  });

  it('allows one lock, by the Locker, while the sweeps run', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    expect(game.act(0, { type: 'lock' })).toMatchObject({ ok: false });
    game.act(1, { type: 'lock' });
    expect(game.act(1, { type: 'lock' })).toMatchObject({ ok: false });

    const slow = startPuzzle(puzzle, { players: 2 });
    slow.advance(TOTAL_MS);
    expect(slow.act(1, { type: 'lock' })).toMatchObject({
      ok: false,
      reason: 'The sweeps are over',
    });
  });

  it('scores nothing without a lock', () => {
    const game = startPuzzle(puzzle, { players: 2 });
    game.advance(TOTAL_MS);
    expect(game.solved).toBe(false);
    expect(game.score()).toEqual({ points: 0 });
    expect((game.reveal(0) as RevealView).result).toEqual({
      target: game.state.target,
      lockT: null,
      points: 0,
    });
  });

  it('swaps roles on alternate rounds', () => {
    const game = startPuzzle(puzzle, { players: 2, roundIndex: 3 });
    expect(game.view(0).role).toBe('locker');
    expect(game.view(1).role).toBe('spotter');
  });
});
