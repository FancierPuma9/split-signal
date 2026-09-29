import type { PuzzleServerModule } from '@split-signal/shared';
import { clusters, readPicture, type Cluster } from './content';
import { manifest } from './manifest';
import type { Action, State, View } from './types';

/** The first wrong guess locks the Guessers out this long; each one after doubles it. */
export const LOCKOUT_BASE_MS = 5000;
/** How many words the Guessers see, target included (capped by the cluster's size). */
export const LIST_SIZE = { min: 6, max: 8 };

export function lockoutMs(wrongCount: number): number {
  return LOCKOUT_BASE_MS * 2 ** (wrongCount - 1);
}

const picturesFor = (cluster: Cluster, word: string) => cluster.pictures[word] ?? [];

/** Builds the puzzle from a content pack. The default export uses the shipped pack. */
export function createSplitHairs(
  pack: readonly Cluster[],
): PuzzleServerModule<State, View, Action> {
  const playable = pack.filter((c) => c.words.some((w) => picturesFor(c, w).length > 0));
  if (playable.length === 0) throw new Error('Split Hairs needs at least one pictured word');

  return {
    manifest,

    init({ rng, players, roundIndex }) {
      if (players.length < 2) throw new Error('Split Hairs needs at least 2 players');
      const drawer = players[roundIndex % players.length]!.id;
      const cluster = rng.pick(playable);
      const target = rng.pick(cluster.words.filter((w) => picturesFor(cluster, w).length > 0));
      const picture = rng.pick(picturesFor(cluster, target));
      const size = Math.min(cluster.words.length, rng.int(LIST_SIZE.min, LIST_SIZE.max));
      const decoys = rng.shuffle(cluster.words.filter((w) => w !== target)).slice(0, size - 1);
      return {
        drawer,
        clusterId: cluster.id,
        words: rng.shuffle([target, ...decoys]),
        target,
        picture,
        wrong: [],
        lockedUntil: null,
        solvedAt: null,
      };
    },

    view(state, playerId) {
      const solved = state.solvedAt !== null;
      if (playerId === state.drawer) {
        return {
          role: 'drawer',
          canDraw: true,
          picture: readPicture(state.picture),
          wrongCount: state.wrong.length,
          lockedUntil: state.lockedUntil,
          solved,
        };
      }
      return {
        role: 'guesser',
        canDraw: false,
        words: state.words,
        wrong: state.wrong,
        lockedUntil: state.lockedUntil,
        solved,
      };
    },

    // Under the scoreboard, everyone finally sees both halves: the word and the picture.
    reveal: (state) => ({
      role: 'reveal',
      canDraw: false,
      word: state.target,
      picture: readPicture(state.picture),
      words: state.words,
      wrong: state.wrong,
      solved: state.solvedAt !== null,
    }),

    apply(state, playerId, action, ctx) {
      if (state.solvedAt !== null) return { reject: 'Already solved' };
      if (playerId === state.drawer) return { reject: 'The Drawer can only draw' };
      if (action?.type !== 'guess' || typeof action.word !== 'string') {
        return { reject: 'Unknown action' };
      }
      if (!state.words.includes(action.word)) return { reject: "That word isn't on the list" };
      if (state.lockedUntil !== null && ctx.elapsedMs < state.lockedUntil) {
        const seconds = Math.ceil((state.lockedUntil - ctx.elapsedMs) / 1000);
        return { reject: `Locked out for ${seconds}s` };
      }
      if (state.wrong.includes(action.word)) return { reject: 'You already tried that one' };

      if (action.word === state.target) return { state: { ...state, solvedAt: ctx.elapsedMs } };
      const wrong = [...state.wrong, action.word];
      return { state: { ...state, wrong, lockedUntil: ctx.elapsedMs + lockoutMs(wrong.length) } };
    },

    isSolved: (state) => state.solvedAt !== null,

    // Race: decided on time, which the runtime tracks. Lockouts cost time, not points.
    score: () => ({}),
  };
}

export default createSplitHairs(clusters);
