import { describe, expect, it } from 'vitest';
import type { PlayerInfo, PuzzleServerModule } from './puzzle';
import { PuzzleSession } from './session';

interface State {
  target: number;
  value: number;
  ticks: number;
}
type Action = { type: 'add'; amount: number } | { type: 'explode' };

const counter: PuzzleServerModule<State, { value: number; target?: number }, Action> = {
  manifest: {
    id: 'counter',
    name: 'Counter',
    description: 'Count to the target.',
    teams: { min: 1, max: 3 },
    playersPerTeam: { min: 1, max: 2 },
    winCondition: 'race',
    timeLimitSeconds: 60,
    comms: { type: 'none' },
  },
  init: ({ rng }) => ({ target: rng.int(3, 9), value: 0, ticks: 0 }),
  view: (state, playerId, ctx) =>
    ctx.players[0]?.id === playerId
      ? { value: state.value, target: state.target }
      : { value: state.value },
  apply: (state, _playerId, action) => {
    if (action.type === 'explode') throw new Error('boom');
    if (action.amount === 0) return { state };
    if (action.amount < 0) return { reject: 'No going backwards' };
    return { state: { ...state, value: state.value + action.amount } };
  },
  tick: (state, nowMs) => (nowMs >= 1000 ? { ...state, ticks: state.ticks + 1 } : state),
  isSolved: (state) => state.value === state.target,
  score: (state) => ({ moves: state.value }),
};

const players: PlayerInfo[] = [
  { id: 'a', name: 'A', seat: 0 },
  { id: 'b', name: 'B', seat: 1 },
];

function session(seed = 'seed', clock = () => 0) {
  return new PuzzleSession(counter, { seed, teamId: 't1', players, clock });
}

describe('PuzzleSession', () => {
  it('gives every team the same puzzle for the same seed', () => {
    const one = new PuzzleSession(counter, { seed: 's', teamId: 't1', players, clock: () => 0 });
    const two = new PuzzleSession(counter, { seed: 's', teamId: 't2', players, clock: () => 0 });
    expect(one.state).toEqual(two.state);
  });

  it('applies, rejects, and reports unchanged state', () => {
    const s = session();
    expect(s.apply('a', { type: 'add', amount: 1 })).toEqual({ ok: true, changed: true });
    expect(s.apply('a', { type: 'add', amount: 0 })).toEqual({ ok: true, changed: false });
    expect(s.apply('a', { type: 'add', amount: -1 })).toEqual({
      ok: false,
      reason: 'No going backwards',
    });
    expect(s.state.value).toBe(1);
  });

  it('turns module exceptions into rejections', () => {
    const outcome = session().apply('a', { type: 'explode' });
    expect(outcome).toMatchObject({ ok: false, reason: 'Invalid action' });
  });

  it('rejects players from other teams', () => {
    expect(session().apply('stranger', { type: 'add', amount: 1 })).toMatchObject({ ok: false });
  });

  it('projects per-player views', () => {
    const s = session();
    expect(s.view('a')).toHaveProperty('target');
    expect(s.view('b')).not.toHaveProperty('target');
  });

  it('stops accepting actions once solved', () => {
    const s = session();
    s.apply('a', { type: 'add', amount: s.state.target });
    expect(s.solved).toBe(true);
    expect(s.score()).toEqual({ moves: s.state.target });
    expect(s.apply('a', { type: 'add', amount: 1 })).toMatchObject({ ok: false });
  });

  it('ticks with the injected clock', () => {
    let now = 0;
    const s = session('seed', () => now);
    expect(s.tick()).toBe(false);
    now = 1000;
    expect(s.tick()).toBe(true);
    expect(s.state.ticks).toBe(1);
  });
});
