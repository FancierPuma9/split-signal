import type { PuzzleServerModule } from '@split-signal/shared';
import { manifest } from './manifest';
import { KNOB_MAX, type Action, type Distortion, type Panel, type State, type View } from './types';

/** The panel has to stay right this long, so sweeping the controls can't win by accident. */
export const HOLD_MS = 2000;
/** Semitones of pitch drift per knob step away from correct. */
const PITCH_PER_STEP = 1.2;

const matches = (a: Panel, b: Panel) =>
  a.band === b.band && a.tuning === b.tuning && a.filter === b.filter && a.squelch === b.squelch;

/** Distortion for a clip heard with `panel` when the answer is `target`. Lighter as it gets closer. */
export function distortionFor(panel: Panel, target: Panel): Distortion {
  return {
    noise: panel.filter === target.filter ? 0 : 0.9,
    chop: panel.squelch === target.squelch ? 0 : 1,
    pitch: (panel.tuning - target.tuning) * PITCH_PER_STEP,
    narrow: Math.abs(panel.band - target.band) / KNOB_MAX,
  };
}

function withMatch(state: State, nowMs: number): State {
  const matchedSince = matches(state.panel, state.target) ? (state.matchedSince ?? nowMs) : null;
  return matchedSince === state.matchedSince ? state : { ...state, matchedSince };
}

const puzzle: PuzzleServerModule<State, View, Action> = {
  manifest,

  init({ rng, players }) {
    const [sender, receiver] = players;
    if (!sender || !receiver) throw new Error('needs a sender and a receiver');
    const target: Panel = {
      band: rng.int(0, KNOB_MAX),
      tuning: rng.int(0, KNOB_MAX),
      filter: rng.chance(0.5),
      squelch: rng.chance(0.5),
    };
    // Start every knob at least three steps off, and at least one switch wrong.
    const away = (v: number) => {
      const up = v + rng.int(3, 6);
      return up <= KNOB_MAX ? up : v - rng.int(3, Math.min(6, v));
    };
    const flipFilter = rng.chance(0.5);
    const panel: Panel = {
      band: away(target.band),
      tuning: away(target.tuning),
      filter: flipFilter ? !target.filter : target.filter,
      squelch: flipFilter ? target.squelch : !target.squelch,
    };
    return {
      target,
      panel,
      sender: sender.id,
      receiver: receiver.id,
      matchedSince: null,
      solved: false,
    };
  },

  view(state, playerId) {
    return playerId === state.sender
      ? { role: 'sender', target: state.target, solved: state.solved }
      : { role: 'receiver', panel: state.panel, solved: state.solved };
  },

  apply(state, playerId, action, ctx) {
    if (playerId !== state.receiver) return { reject: 'Only the Receiver can touch the panel' };
    let panel: Panel;
    if (action?.type === 'knob' && (action.control === 'band' || action.control === 'tuning')) {
      if (!Number.isInteger(action.value) || action.value < 0 || action.value > KNOB_MAX) {
        return { reject: `Knobs go from 0 to ${KNOB_MAX}` };
      }
      panel = { ...state.panel, [action.control]: action.value };
    } else if (
      action?.type === 'switch' &&
      (action.control === 'filter' || action.control === 'squelch') &&
      typeof action.on === 'boolean'
    ) {
      panel = { ...state.panel, [action.control]: action.on };
    } else {
      return { reject: 'Unknown action' };
    }
    return { state: withMatch({ ...state, panel }, ctx.elapsedMs) };
  },

  tick(state, nowMs) {
    if (state.solved || state.matchedSince === null || nowMs - state.matchedSince < HOLD_MS) {
      return state;
    }
    return { ...state, solved: true };
  },

  onClip(state, fromPlayerId) {
    if (fromPlayerId !== state.sender) return { reject: 'Only the Sender can transmit' };
    return {
      deliveries: [{ to: state.receiver, params: distortionFor(state.panel, state.target) }],
    };
  },

  isSolved: (state) => state.solved,

  score: () => ({}),
};

export default puzzle;
