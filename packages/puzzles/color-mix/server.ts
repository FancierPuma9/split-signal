import type { PuzzleServerModule } from '@split-signal/shared';
import { colorDistance, type Rgb } from './color';
import { manifest } from './manifest';
import { CHANNELS, type Action, type Channel, type State, type View } from './types';

/** CIEDE2000 distance that counts as a match. Tune in playtest. */
export const TOLERANCE = 5;
/** How long the match has to hold, so nobody can win by sweeping a slider past it. */
export const HOLD_MS = 1500;
/** How far the starting mix must be from the target. */
const MIN_START_DISTANCE = 25;

const zero = (): Rgb => ({ r: 0, g: 0, b: 0 });

export function mixOf(state: Pick<State, 'sliders'>): Rgb {
  const mix = zero();
  for (const s of Object.values(state.sliders)) {
    for (const ch of CHANNELS) mix[ch] = Math.min(255, mix[ch] + s[ch]);
  }
  return mix;
}

function withMatch(state: State, nowMs: number): State {
  const matching = colorDistance(mixOf(state), state.target) <= TOLERANCE;
  const matchSince = matching ? (state.matchSince ?? nowMs) : null;
  return matchSince === state.matchSince ? state : { ...state, matchSince };
}

const puzzle: PuzzleServerModule<State, View, Action> = {
  manifest,

  init({ rng, players: seated }) {
    // Jobs (who sees the target, who gets which slider) are dealt at random, on their own stream
    // so the colors don't depend on them.
    const players = rng.fork('roles').shuffle(seated);
    const split = players.length >= 3;
    const max = split ? 255 : 127;
    const controls: Record<string, Channel[]> = {};
    const sliders: Record<string, Rgb> = {};
    players.forEach((p, i) => {
      const mine = split ? [CHANNELS[i % 3] as Channel] : [...CHANNELS];
      controls[p.id] = mine;
      sliders[p.id] = zero();
      for (const ch of mine) sliders[p.id]![ch] = Math.round(max / 2);
    });

    // The target is a sum of settings the players could reach, so it's always solvable.
    const start = mixOf({ sliders });
    let target = start;
    for (let attempt = 0; attempt < 50; attempt++) {
      const hidden: Record<string, Rgb> = {};
      for (const p of players) {
        hidden[p.id] = zero();
        for (const ch of controls[p.id] ?? []) hidden[p.id]![ch] = rng.int(0, max);
      }
      target = mixOf({ sliders: hidden });
      if (colorDistance(target, start) >= MIN_START_DISTANCE) break;
    }

    const [first] = players;
    if (!first) throw new Error('needs players');
    return {
      target,
      sliders,
      controls,
      max,
      targetViewer: first.id,
      matchSince: null,
      solved: false,
    };
  },

  view(state, playerId) {
    const role = playerId === state.targetViewer ? 'target' : 'mix';
    return {
      role,
      swatch: role === 'target' ? state.target : mixOf(state),
      controls: state.controls[playerId] ?? [],
      sliders: state.sliders[playerId] ?? zero(),
      max: state.max,
      holdingSince: state.matchSince,
      holdMs: HOLD_MS,
      solved: state.solved,
    };
  },

  apply(state, playerId, action, ctx) {
    if (action?.type !== 'set' || !CHANNELS.includes(action.channel)) {
      return { reject: 'Unknown action' };
    }
    if (!state.controls[playerId]?.includes(action.channel)) {
      return { reject: "That isn't your slider" };
    }
    if (!Number.isInteger(action.value) || action.value < 0 || action.value > state.max) {
      return { reject: `Sliders go from 0 to ${state.max}` };
    }
    const current = state.sliders[playerId] ?? zero();
    if (current[action.channel] === action.value) return { state };
    const sliders = {
      ...state.sliders,
      [playerId]: { ...current, [action.channel]: action.value },
    };
    return { state: withMatch({ ...state, sliders }, ctx.elapsedMs) };
  },

  tick(state, nowMs) {
    if (state.solved || state.matchSince === null || nowMs - state.matchSince < HOLD_MS) {
      return state;
    }
    return { ...state, solved: true };
  },

  isSolved: (state) => state.solved,

  // Race: decided on time, which the runtime tracks.
  score: () => ({}),
};

export default puzzle;
