import type { Context, PuzzleServerModule } from '@split-signal/shared';
import { deal, tally } from './deal';
import { manifest } from './manifest';
import type { Action, State, View } from './types';

function view(state: State, playerId: string, ctx: Context): View {
  const holding = state.correct
    .filter((id) => state.holders[id] === playerId)
    .map((id) => {
      const owner = Object.keys(state.boards).find((p) =>
        state.boards[p]!.some((i) => i.id === id),
      )!;
      return { owner, look: state.boards[owner]!.find((i) => i.id === id)!.look };
    });
  return {
    board: state.boards[playerId] ?? [],
    picked: state.picks[playerId] ?? [],
    holding,
    submitted: state.submitted[playerId] !== undefined,
    teammatesDone: ctx.players
      .filter((p) => p.id !== playerId && state.submitted[p.id] !== undefined)
      .map((p) => p.id),
  };
}

const puzzle: PuzzleServerModule<State, View, Action> = {
  manifest,

  init({ rng, players }) {
    if (players.length !== 3) throw new Error('Overdraft needs exactly 3 players');
    return deal(players, rng);
  },

  view,

  apply(state, playerId, action, ctx) {
    if (state.submitted[playerId] !== undefined) return { reject: "You've submitted" };
    if (action?.type === 'toggle') {
      if (!(state.boards[playerId] ?? []).some((i) => i.id === action.itemId)) {
        return { reject: "That isn't on your board" };
      }
      const mine = state.picks[playerId] ?? [];
      const next = mine.includes(action.itemId)
        ? mine.filter((id) => id !== action.itemId)
        : [...mine, action.itemId];
      return { state: { ...state, picks: { ...state.picks, [playerId]: next } } };
    }
    if (action?.type === 'submit') {
      return { state: { ...state, submitted: { ...state.submitted, [playerId]: ctx.elapsedMs } } };
    }
    return { reject: 'Unknown action' };
  },

  reveal(state, playerId, ctx) {
    const t = tally(state);
    return {
      ...view(state, playerId, ctx),
      result: {
        correct: state.correct,
        quota: state.quota,
        points: t.points,
        tally: { correct: t.correct, missed: t.missed, surplus: t.surplus },
        boards: state.boards,
        picks: state.picks,
      },
    };
  },

  // Done when all three have submitted; anyone who never does counts with what they'd picked.
  isSolved: (state) => Object.keys(state.submitted).length >= Object.keys(state.boards).length,

  score(state) {
    const times = Object.values(state.submitted);
    const done = times.length >= Object.keys(state.boards).length;
    return { points: tally(state).points, ...(done ? { elapsedMs: Math.max(...times) } : {}) };
  },
};

export default puzzle;
