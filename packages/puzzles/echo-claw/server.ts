import type { PuzzleServerModule } from '@split-signal/shared';
import { manifest } from './manifest';
import { BUSY_MS, DROP_MS, advance, spawn } from './physics';
import type { Action, State, View } from './types';

const isStep = (v: unknown) => v === -1 || v === 0 || v === 1;

const puzzle: PuzzleServerModule<State, View, Action> = {
  manifest,

  init({ rng, players, roundIndex }) {
    const [a, b] = players;
    if (!a || !b) throw new Error('Echo Claw needs 2 players');
    const [spotter, operator] = roundIndex % 2 === 0 ? [a, b] : [b, a];
    const pathSeed = String(rng.int(0, 2 ** 31 - 1));
    const toy = spawn(pathSeed, 0, 0);
    return {
      spotter: spotter.id,
      operator: operator.id,
      pathSeed,
      toy,
      toyAt: { x: Math.round(toy.x * 1000) / 1000, y: Math.round(toy.y * 1000) / 1000 },
      respawns: 0,
      bounces: 0,
      claw: { x: 0.5, y: 0.5 },
      steer: { dx: 0, dy: 0 },
      dropAt: null,
      closed: false,
      movedTo: 0,
      grabs: [],
      lastDrop: null,
    };
  },

  view(state, playerId) {
    const common = {
      claw: state.claw,
      dropping: state.dropAt === null ? null : { at: state.dropAt },
      busyMs: BUSY_MS,
      dropMs: DROP_MS,
      grabs: state.grabs.length,
      lastDrop: state.lastDrop,
    };
    return playerId === state.spotter
      ? { ...common, role: 'spotter', toy: state.toyAt }
      : { ...common, role: 'operator' };
  },

  apply(state, playerId, action, ctx) {
    if (playerId !== state.operator) return { reject: 'Only the Operator works the claw' };
    const now = ctx.elapsedMs;
    const current = advance(state, now);
    switch (action?.type) {
      case 'move':
        if (!isStep(action.dx) || !isStep(action.dy)) return { reject: 'Bad direction' };
        return { state: { ...current, steer: { dx: action.dx, dy: action.dy }, movedTo: now } };
      case 'drop':
        if (current.dropAt !== null) return { reject: 'The claw is busy' };
        return { state: { ...current, dropAt: now, closed: false, movedTo: now } };
      default:
        return { reject: 'Unknown action' };
    }
  },

  tick: (state, nowMs) => advance(state, nowMs),

  // Everyone plays the full round; the most grabs wins.
  isSolved: () => false,

  score: (state) => ({
    points: state.grabs.length,
    // Tie on grabs: whoever got their last one first.
    ...(state.grabs.length > 0 ? { elapsedMs: state.grabs.at(-1) } : {}),
  }),
};

export default puzzle;
