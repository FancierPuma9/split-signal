import type { PuzzleServerModule } from '@split-signal/shared';
import { SWEEPS, SWEEP_MS, TOTAL_MS, hslToRgb, sweepT, type Rgb } from './gradient';
import { manifest } from './manifest';
import type { Action, Result, State, View } from './types';

const round3 = (v: number) => Math.round(v * 1000) / 1000;

export function result(state: State): Result {
  const lockT = state.lock?.t ?? null;
  const points = lockT === null ? 0 : Math.round((1 - Math.abs(lockT - state.target)) * 1000) / 10;
  return { target: state.target, lockT, points };
}

const puzzle: PuzzleServerModule<State, View, Action> = {
  manifest,

  init({ rng, players, roundIndex }) {
    const [a, b] = players;
    if (!a || !b) throw new Error('Color Sweep needs 2 players');
    const [spotter, locker] = roundIndex % 2 === 0 ? [a, b] : [b, a];
    // Five stops, each a big hue step from the last, so the whole sweep is clearly moving.
    const stops: Rgb[] = [];
    let hue = rng.int(0, 359);
    for (let i = 0; i < 5; i++) {
      hue = (hue + (rng.chance(0.5) ? 1 : -1) * rng.int(50, 140) + 360) % 360;
      stops.push(hslToRgb(hue, rng.int(55, 90), rng.int(38, 68)));
    }
    return {
      spotter: spotter.id,
      locker: locker.id,
      stops,
      target: round3(0.1 + rng.next() * 0.8),
      lock: null,
    };
  },

  view(state, playerId) {
    const common = { stops: state.stops, sweepMs: SWEEP_MS, sweeps: SWEEPS, lock: state.lock };
    const done = state.lock === null ? null : result(state);
    return playerId === state.spotter
      ? { ...common, role: 'spotter', target: state.target, result: done }
      : { ...common, role: 'locker', result: done };
  },

  reveal: (state) => ({ role: 'reveal', stops: state.stops, result: result(state) }),

  apply(state, playerId, action, ctx) {
    if (playerId !== state.locker) return { reject: 'Only the Locker can lock' };
    if (action?.type !== 'lock') return { reject: 'Unknown action' };
    if (state.lock !== null) return { reject: 'You already locked' };
    if (ctx.elapsedMs >= TOTAL_MS) return { reject: 'The sweeps are over' };
    // Scored at the server's clock, the same for every team.
    return { state: { ...state, lock: { at: ctx.elapsedMs, t: round3(sweepT(ctx.elapsedMs)) } } };
  },

  isSolved: (state) => state.lock !== null,

  // No lock by the end of the fifth sweep scores 0, which never wins.
  score: (state) => ({ points: result(state).points }),
};

export default puzzle;
