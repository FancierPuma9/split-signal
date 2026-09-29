import type { PuzzleServerModule } from '@split-signal/shared';
import { manifest } from './manifest';
import { BUTTON_COLORS, type Action, type State, type View } from './types';

// Dummy puzzle that exercises the pipeline end to end: seeded init, per-player views, accepted and
// rejected actions, and solving.
const puzzle: PuzzleServerModule<State, View, Action> = {
  manifest,

  init({ rng, players }) {
    const colors = rng.shuffle(BUTTON_COLORS);
    return {
      buttons: players.map((p, i) => ({
        playerId: p.id,
        color: colors[i % colors.length] ?? 'red',
        pressed: false,
      })),
    };
  },

  view(state, playerId) {
    const mine = state.buttons.find((b) => b.playerId === playerId);
    return {
      color: mine?.color ?? 'red',
      pressed: mine?.pressed ?? false,
      teamPressed: state.buttons.filter((b) => b.pressed).length,
      teamSize: state.buttons.length,
    };
  },

  apply(state, playerId, action) {
    if (action?.type !== 'press') return { reject: 'Unknown action' };
    const mine = state.buttons.find((b) => b.playerId === playerId);
    if (!mine) return { reject: 'You have no button' };
    if (mine.pressed) return { reject: 'Already pressed' };
    return {
      state: {
        buttons: state.buttons.map((b) => (b === mine ? { ...b, pressed: true } : b)),
      },
    };
  },

  isSolved: (state) => state.buttons.every((b) => b.pressed),

  score: (state) => ({ moves: state.buttons.filter((b) => b.pressed).length }),
};

export default puzzle;
