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
/** Top of every slider. Each channel belongs to exactly one player. */
const MAX = 255;

/**
 * Deals red, green and blue out between the players: one each for three, and one for one
 * player and two for the other when there are two.
 */
export function dealChannels(players: number, channels: readonly Channel[]): Channel[][] {
  const [a, b, c] = channels as [Channel, Channel, Channel];
  return players >= 3 ? [[a], [b], [c]] : [[a], [b, c]];
}

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
    if (seated.length < 2) throw new Error('Color Mix needs 2 players');
    // Jobs (who sees the target, who gets which colors) are dealt at random, on their own stream
    // so the target color doesn't depend on them.
    const roles = rng.fork('roles');
    const players = roles.shuffle(seated);
    const dealt = dealChannels(players.length, roles.shuffle(CHANNELS));
    const controls: Record<string, Channel[]> = {};
    const sliders: Record<string, Rgb> = {};
    players.forEach((p, i) => {
      const mine = dealt[i] ?? [];
      controls[p.id] = mine;
      sliders[p.id] = zero();
      for (const ch of mine) sliders[p.id]![ch] = Math.round(MAX / 2);
    });

    // Every channel has an owner with the full range, so any color is reachable.
    const start = mixOf({ sliders });
    let target = start;
    for (let attempt = 0; attempt < 50; attempt++) {
      target = { r: rng.int(0, MAX), g: rng.int(0, MAX), b: rng.int(0, MAX) };
      if (colorDistance(target, start) >= MIN_START_DISTANCE) break;
    }

    return {
      target,
      sliders,
      controls,
      max: MAX,
      targetViewer: roles.pick(players).id,
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
