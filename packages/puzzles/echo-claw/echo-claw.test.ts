import { describe, expect, it } from 'vitest';
import { startPuzzle, type HiddenInfo } from '../harness';
import {
  BUSY_MS,
  CLAW_LIMIT,
  DROP_MS,
  GRAB_RADIUS,
  TOY_RADIUS,
  advance,
  distance,
  toyAt,
} from './physics';
import puzzle from './server';
import type { OperatorView, SpotterView, State } from './types';

const hidden: HiddenInfo<State>[] = [
  {
    name: 'the toy',
    hiddenFrom: (player) => player.seat === 1,
    change: (state) => ({
      ...state,
      toy: { ...state.toy, x: 1 - state.toy.x, vx: -state.toy.vx },
      toyAt: { x: 1 - state.toyAt.x, y: state.toyAt.y },
    }),
  },
];

/** Where the toy will be at time t, bounces included. */
const toyWillBeAt = (state: State, t: number) => toyAt(advance(state, t).toy, t);

const clampClaw = (p: { x: number; y: number }) => ({
  x: Math.min(CLAW_LIMIT.max, Math.max(CLAW_LIMIT.min, p.x)),
  y: Math.min(CLAW_LIMIT.max, Math.max(CLAW_LIMIT.min, p.y)),
});

describe('echo claw', () => {
  it('shows the toy to the Spotter only', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    const spotter = game.view(0) as SpotterView;
    const operator = game.view(1) as OperatorView;
    expect(spotter).toMatchObject({ role: 'spotter', claw: { x: 0.5, y: 0.5 }, grabs: 0 });
    expect(spotter.toy).toEqual(game.state.toyAt);
    expect(operator.role).toBe('operator');
    expect(operator).not.toHaveProperty('toy');
    game.advance(3000);
    expect((game.view(0) as SpotterView).toy).not.toEqual(spotter.toy);
  });

  it('keeps the toy bouncing around inside the machine', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    for (let i = 0; i < 150; i++) {
      game.advance(500);
      const { x, y } = game.state.toyAt;
      for (const v of [x, y]) {
        expect(v).toBeGreaterThanOrEqual(TOY_RADIUS - 1e-6);
        expect(v).toBeLessThanOrEqual(1 - TOY_RADIUS + 1e-6);
      }
    }
    expect(game.state.bounces).toBeGreaterThan(5);
  });

  it('follows the same path however often it is ticked', () => {
    const { state } = startPuzzle(puzzle, { players: 2, seed: 'path' });
    let stepped = state;
    for (let t = 100; t <= 60_000; t += 100) stepped = advance(stepped, t);
    const jumped = advance(state, 60_000);
    expect(jumped.bounces).toBe(stepped.bounces);
    expect(jumped.toy.x).toBeCloseTo(stepped.toy.x, 9);
    expect(jumped.toy.vy).toBeCloseTo(stepped.toy.vy, 12);
    expect(jumped.toyAt).toEqual(stepped.toyAt);
  });

  it('gives every team the same toy', () => {
    const a = startPuzzle(puzzle, { players: 2, seed: 'fair' });
    const b = startPuzzle(puzzle, { players: 2, seed: 'fair' });
    a.advance(20_000);
    b.advance(20_000);
    expect(a.state.toyAt).toEqual(b.state.toyAt);
  });

  it('drives the claw while a direction is held, inside the glass', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    game.act(1, { type: 'move', dx: 1, dy: 0 });
    game.advance(1200);
    expect(game.state.claw.x).toBeCloseTo(0.7, 2);
    game.act(1, { type: 'move', dx: 0, dy: 0 });
    game.advance(1000);
    expect(game.state.claw.x).toBeCloseTo(0.7, 2);
    game.act(1, { type: 'move', dx: 1, dy: -1 });
    game.advance(10_000);
    expect(game.state.claw).toEqual({ x: CLAW_LIMIT.max, y: CLAW_LIMIT.min });
  });

  it('grabs the toy when the claw closes over it, then respawns it', () => {
    const game = startPuzzle(puzzle, { players: 2 });
    const target = toyWillBeAt(game.state, DROP_MS);
    const state = { ...game.state, claw: clampClaw(target), dropAt: 0 };
    expect(distance(state.claw, target)).toBeLessThan(GRAB_RADIUS);
    const after = advance(state, DROP_MS);
    expect(after.grabs).toEqual([DROP_MS]);
    expect(after.lastDrop).toEqual({ at: DROP_MS, hit: true });
    expect(after.respawns).toBe(1);
    expect(puzzle.score(after)).toEqual({ points: 1, elapsedMs: DROP_MS });
  });

  it('misses when the toy is elsewhere', () => {
    const { state } = startPuzzle(puzzle, { players: 2 });
    const toy = toyWillBeAt(state, DROP_MS);
    const claw = clampClaw({ x: toy.x > 0.5 ? 0.1 : 0.9, y: toy.y > 0.5 ? 0.1 : 0.9 });
    expect(distance(claw, toy)).toBeGreaterThan(GRAB_RADIUS);
    const after = advance({ ...state, claw, dropAt: 0 }, DROP_MS);
    expect(after.lastDrop).toEqual({ at: DROP_MS, hit: false });
    expect(after.grabs).toEqual([]);
    expect(after.toy).toEqual(advance(state, DROP_MS).toy);
  });

  it('keeps the claw busy for a while after a drop', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    game.act(1, { type: 'drop' });
    expect(game.view(1).dropping).toEqual({ at: 0 });
    game.advance(DROP_MS);
    expect(game.act(1, { type: 'drop' })).toMatchObject({ ok: false, reason: 'The claw is busy' });
    game.act(1, { type: 'move', dx: 1, dy: 0 });
    game.advance(BUSY_MS - DROP_MS);
    expect(game.state.claw.x).toBeCloseTo(0.5, 3);
    expect(game.state.dropAt).toBeNull();
    game.advance(600);
    expect(game.state.claw.x).toBeCloseTo(0.6, 2);
  });

  it('scores nothing without grabs and never ends early', () => {
    const game = startPuzzle(puzzle, { players: 2 });
    game.advance(75_000);
    expect(game.solved).toBe(false);
    expect(game.score()).toEqual({ points: 0 });
  });

  it('only lets the Operator work the claw, with sane directions', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    expect(game.act(0, { type: 'drop' })).toMatchObject({ ok: false });
    expect(game.act(1, { type: 'move', dx: 5, dy: 0 })).toMatchObject({ ok: false });
    expect(game.act(1, { type: 'move', dx: 0.5, dy: 0 })).toMatchObject({ ok: false });
    expect(game.act(1, { type: 'spin' } as never)).toMatchObject({ ok: false });
  });

  it('swaps roles on alternate rounds', () => {
    const game = startPuzzle(puzzle, { players: 2, roundIndex: 1 });
    expect(game.view(0).role).toBe('operator');
    expect(game.view(1).role).toBe('spotter');
  });
});
