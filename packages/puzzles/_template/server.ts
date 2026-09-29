import type { PuzzleServerModule } from '@split-signal/shared';
import { manifest } from './manifest';
import { MAX_NUMBER, type Action, type State, type View } from './types';

const puzzle: PuzzleServerModule<State, View, Action> = {
  manifest,

  // Build the starting state. All randomness comes from ctx.rng, so every team gets the same number.
  init({ rng, players }) {
    const [knower] = players;
    if (!knower) throw new Error('needs at least one player');
    return { secret: rng.int(1, MAX_NUMBER), knowerId: knower.id, guesses: [], solved: false };
  },

  // The asymmetry lives here: only the knower's view contains the secret.
  view(state, playerId) {
    const guesses = state.guesses.map((g) => g.value);
    if (playerId === state.knowerId) {
      return { role: 'knower', secret: state.secret, guesses, solved: state.solved };
    }
    return { role: 'guesser', guesses, solved: state.solved };
  },

  // Actions come from the network, so check the shape first. Never mutate state; return a copy.
  apply(state, playerId, action) {
    if (action?.type !== 'guess' || !Number.isInteger(action.value)) {
      return { reject: 'Unknown action' };
    }
    if (playerId === state.knowerId) return { reject: 'You know it. Tell your team instead!' };
    if (action.value < 1 || action.value > MAX_NUMBER) {
      return { reject: `Pick a number from 1 to ${MAX_NUMBER}` };
    }
    return {
      state: {
        ...state,
        guesses: [...state.guesses, { by: playerId, value: action.value }],
        solved: action.value === state.secret,
      },
    };
  },

  // Optional hooks, delete if unused:
  // tick(state, nowMs, ctx) { return state; }            // turn timers, simultaneous resolution
  // onSignal(state, fromPlayerId, signal, ctx) { ... }   // signals that change state

  isSolved: (state) => state.solved,

  score: (state) => ({ moves: state.guesses.length }),
};

export default puzzle;
