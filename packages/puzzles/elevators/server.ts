import type { Context, PuzzleServerModule } from '@split-signal/shared';
import { CAPACITY, TOP_FLOOR, generateQueue, resolveTurn } from './logic';
import { manifest } from './manifest';
import type { Action, Pick, State, View } from './types';

/** A turn resolves when everyone has picked, or when this runs out (no pick means idle). */
export const TURN_MS = 12_000;

function resolve(state: State, ctx: Context, nowMs: number): State {
  const picks = ctx.players.map((p) => ({ player: p.id, pick: state.picks[p.id] ?? 'idle' }));
  const { trips, remaining, delivered } = resolveTurn(
    state.queue,
    picks,
    state.elevators,
    state.capacity,
    ctx.rng,
  );
  const turns = state.turns + 1;
  return {
    ...state,
    queue: remaining,
    delivered: [...state.delivered, ...delivered],
    turns,
    turnStartedAt: nowMs,
    picks: {},
    last: { turn: turns, picks, trips },
    solved: remaining.length === 0,
  };
}

const puzzle: PuzzleServerModule<State, View, Action> = {
  manifest,

  init({ rng, players }) {
    const elevators = players.length;
    return {
      topFloor: TOP_FLOOR,
      elevators,
      capacity: CAPACITY,
      queue: generateQueue(elevators, rng),
      delivered: [],
      turns: 0,
      turnStartedAt: 0,
      picks: {},
      last: null,
      solved: false,
    };
  },

  view(state, playerId, ctx) {
    const teammates = ctx.players.filter((p) => p.id !== playerId);
    return {
      topFloor: state.topFloor,
      elevators: state.elevators,
      capacity: state.capacity,
      queue: state.queue,
      delivered: state.delivered.length,
      turns: state.turns,
      turnStartedAt: state.turnStartedAt,
      turnMs: TURN_MS,
      myPick: state.picks[playerId] ?? null,
      teammatesReady: teammates.filter((p) => state.picks[p.id] !== undefined).length,
      teammates: teammates.length,
      last: state.last,
      solved: state.solved,
    };
  },

  apply(state, playerId, action, ctx) {
    let pick: Pick;
    if (action?.type === 'idle') {
      pick = 'idle';
    } else if (action?.type === 'pick') {
      const { elevator, floor } = action;
      if (!Number.isInteger(elevator) || elevator < 0 || elevator >= state.elevators) {
        return { reject: 'No such elevator' };
      }
      if (!Number.isInteger(floor) || floor < 2 || floor > state.topFloor) {
        return { reject: 'No such floor' };
      }
      pick = { elevator, floor };
    } else {
      return { reject: 'Unknown action' };
    }
    const next = { ...state, picks: { ...state.picks, [playerId]: pick } };
    const everyoneReady = ctx.players.every((p) => next.picks[p.id] !== undefined);
    return { state: everyoneReady ? resolve(next, ctx, ctx.elapsedMs) : next };
  },

  tick(state, nowMs, ctx) {
    return nowMs - state.turnStartedAt >= TURN_MS ? resolve(state, ctx, nowMs) : state;
  },

  isSolved: (state) => state.solved,

  score: (state) => ({ moves: state.turns }),
};

export default puzzle;
