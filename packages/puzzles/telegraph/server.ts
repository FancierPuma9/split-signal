import type { PuzzleServerModule } from '@split-signal/shared';
import { SIZE, generateRegion, generateTarget, splitBoard } from './board';
import { manifest } from './manifest';
import type { Action, State, View } from './types';

/** A wrong submit locks the Receivers out this long, and adds it to the team's time. */
export const PENALTY_MS = 8000;

const sameCells = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((cell, i) => cell === b[i]);

const puzzle: PuzzleServerModule<State, View, Action> = {
  manifest,

  init({ rng, players, roundIndex }) {
    if (players.length < 2) throw new Error('Telegraph needs at least 2 players');
    const region = generateRegion(rng.fork('region'));
    const bySeat = [...players].sort((a, b) => a.seat - b.seat);
    const sender = bySeat[roundIndex % bySeat.length]!.id;
    const receivers = bySeat.filter((p) => p.id !== sender);
    const halves = receivers.length === 2 ? splitBoard(region) : [region];
    return {
      size: SIZE,
      region,
      target: generateTarget(region, rng.fork('target')),
      sender,
      owners: Object.fromEntries(receivers.map((p, i) => [p.id, halves[i] ?? []])),
      filled: [],
      lastSubmit: null,
      wrongSubmits: 0,
      lockedUntil: null,
      solvedAt: null,
    };
  },

  view(state, playerId): View {
    const board = { size: state.size, region: state.region };
    const solved = state.solvedAt !== null;
    if (playerId === state.sender) {
      const receivers = Object.values(state.owners);
      return {
        role: 'sender',
        ...board,
        target: state.target,
        halves: receivers.length > 1 ? receivers : null,
        lastSubmit: state.lastSubmit && {
          cells: state.lastSubmit.cells,
          wrong: state.region.filter(
            (c) => state.target.includes(c) !== state.lastSubmit!.cells.includes(c),
          ),
        },
        wrongSubmits: state.wrongSubmits,
        lockedUntil: state.lockedUntil,
        solved,
      };
    }
    return {
      role: 'receiver',
      ...board,
      mine: state.owners[playerId] ?? [],
      filled: state.filled,
      wrongSubmits: state.wrongSubmits,
      lockedUntil: state.lockedUntil,
      solved,
    };
  },

  apply(state, playerId, action, ctx) {
    if (playerId === state.sender) return { reject: 'The Sender only has the button' };
    if (state.lockedUntil !== null && ctx.elapsedMs < state.lockedUntil) {
      return { reject: 'Locked after a wrong submit' };
    }
    if (action?.type === 'toggle') {
      if (!(state.owners[playerId] ?? []).includes(action.cell)) {
        return { reject: "That cell isn't yours" };
      }
      const filled = state.filled.includes(action.cell)
        ? state.filled.filter((c) => c !== action.cell)
        : [...state.filled, action.cell].sort((a, b) => a - b);
      return { state: { ...state, filled } };
    }
    if (action?.type === 'submit') {
      if (sameCells(state.filled, state.target)) {
        return { state: { ...state, solvedAt: ctx.elapsedMs } };
      }
      return {
        state: {
          ...state,
          lastSubmit: { cells: state.filled, at: ctx.elapsedMs },
          wrongSubmits: state.wrongSubmits + 1,
          lockedUntil: ctx.elapsedMs + PENALTY_MS,
        },
      };
    }
    return { reject: 'Unknown action' };
  },

  // Only the Sender has the button; the server refuses anyone else's taps.
  onSignal: (state, from) =>
    from === state.sender ? state : { reject: 'Only the Sender has the button' },

  reveal(state) {
    return {
      role: 'reveal',
      size: state.size,
      region: state.region,
      target: state.target,
      filled: state.filled,
      wrongSubmits: state.wrongSubmits,
    };
  },

  isSolved: (state) => state.solvedAt !== null,

  score: (state) =>
    state.solvedAt === null
      ? {}
      : { elapsedMs: state.solvedAt + state.wrongSubmits * PENALTY_MS, moves: state.wrongSubmits },
};

export default puzzle;
