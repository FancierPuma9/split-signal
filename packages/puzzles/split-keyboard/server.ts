import type { PuzzleServerModule } from '@split-signal/shared';
import { manifest } from './manifest';
import { KEYS, PHRASES } from './phrases';
import type { Action, State, View } from './types';

export const PHRASES_PER_ROUND = 2;

const puzzle: PuzzleServerModule<State, View, Action> = {
  manifest,

  init({ rng, players }) {
    // Deal the keys round-robin from a shuffled deck: an even split, scattered across the board.
    const owners: Record<string, string> = {};
    rng.shuffle(KEYS).forEach((key, i) => {
      owners[key] = players[i % players.length]?.id ?? '';
    });
    return {
      phrases: rng.shuffle(PHRASES).slice(0, PHRASES_PER_ROUND),
      phraseIndex: 0,
      typed: 0,
      owners,
      errors: {},
      errorCount: 0,
      solved: false,
    };
  },

  view(state, playerId) {
    return {
      phrase: state.phrases[state.phraseIndex] ?? '',
      typed: state.typed,
      phraseIndex: state.phraseIndex,
      phraseCount: state.phrases.length,
      myKeys: KEYS.filter((k) => state.owners[k] === playerId),
      lastError: state.errors[playerId] ?? null,
      solved: state.solved,
    };
  },

  apply(state, playerId, action) {
    if (action?.type !== 'key' || typeof action.key !== 'string' || action.key.length !== 1) {
      return { reject: 'Unknown action' };
    }
    const key = action.key.toLowerCase();
    const phrase = state.phrases[state.phraseIndex] ?? '';
    const miss = (reason: 'not-yours' | 'wrong'): { state: State } => {
      const errorCount = state.errorCount + 1;
      return {
        state: {
          ...state,
          errorCount,
          errors: { ...state.errors, [playerId]: { id: errorCount, key, reason } },
        },
      };
    };

    if (key !== phrase[state.typed]) return miss('wrong');
    if (state.owners[key] !== playerId) return miss('not-yours');

    const typed = state.typed + 1;
    if (typed < phrase.length) return { state: { ...state, typed } };
    const phraseIndex = state.phraseIndex + 1;
    return phraseIndex < state.phrases.length
      ? { state: { ...state, phraseIndex, typed: 0 } }
      : { state: { ...state, typed, solved: true } };
  },

  isSolved: (state) => state.solved,

  // Race: decided on time. Mistakes are counted for curiosity only.
  score: (state) => ({ moves: state.errorCount }),
};

export default puzzle;
