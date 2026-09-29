import type { PuzzleServerModule } from '@split-signal/shared';
import { allPlaced, applyMoves, generateTiles, resolveTurn } from './logic';
import { manifest } from './manifest';
import { DIRECTIONS, type Action, type Dir, type State, type View } from './types';

/** A turn resolves when everyone has chosen, or when this runs out. */
export const TURN_MS = 10_000;

function resolve(state: State, nowMs: number): State {
  const moves = Object.values(state.plans).filter(
    (plan): plan is { tileId: string; dir: Dir } => plan !== 'pass',
  );
  const { moved, bumped } = resolveTurn(state.tiles, moves, state.size);
  const tiles = applyMoves(state.tiles, moves, moved);
  const turns = state.turns + 1;
  return {
    ...state,
    tiles,
    turns,
    turnStartedAt: nowMs,
    plans: {},
    last: { turn: turns, moved: [...moved], bumped: [...bumped] },
    solved: allPlaced(tiles),
  };
}

const puzzle: PuzzleServerModule<State, View, Action> = {
  manifest,

  init({ rng, players }) {
    const { size, tiles } = generateTiles(players, rng);
    return { size, tiles, turns: 0, turnStartedAt: 0, plans: {}, last: null, solved: false };
  },

  view(state, playerId, ctx) {
    const mine = new Set(state.tiles.filter((t) => t.owner === playerId).map((t) => t.id));
    const seat = ctx.players.find((p) => p.id === playerId)?.seat ?? 0;
    const teammates = ctx.players.filter((p) => p.id !== playerId);
    return {
      size: state.size,
      tiles: state.tiles
        .filter((t) => mine.has(t.id))
        .map((t) => ({
          id: t.id,
          label: t.label,
          x: t.pos.x,
          y: t.pos.y,
          targetX: t.target.x,
          targetY: t.target.y,
        })),
      colorIndex: seat,
      turns: state.turns,
      turnStartedAt: state.turnStartedAt,
      turnMs: TURN_MS,
      myPlan: state.plans[playerId] ?? null,
      teammatesReady: teammates.filter((p) => state.plans[p.id] !== undefined).length,
      teammates: teammates.length,
      last: state.last && {
        turn: state.last.turn,
        moved: state.last.moved.filter((id) => mine.has(id)),
        bumped: state.last.bumped.filter((id) => mine.has(id)),
      },
      solved: state.solved,
    };
  },

  apply(state, playerId, action, ctx) {
    let plan: State['plans'][string];
    if (action?.type === 'pass') {
      plan = 'pass';
    } else if (action?.type === 'move' && DIRECTIONS.includes(action.dir)) {
      const tile = state.tiles.find((t) => t.id === action.tileId);
      if (!tile || tile.owner !== playerId) return { reject: 'That is not your tile' };
      plan = { tileId: tile.id, dir: action.dir };
    } else {
      return { reject: 'Unknown action' };
    }

    const next = { ...state, plans: { ...state.plans, [playerId]: plan } };
    const everyoneReady = ctx.players.every((p) => next.plans[p.id] !== undefined);
    return { state: everyoneReady ? resolve(next, ctx.elapsedMs) : next };
  },

  tick(state, nowMs) {
    return nowMs - state.turnStartedAt >= TURN_MS ? resolve(state, nowMs) : state;
  },

  isSolved: (state) => state.solved,

  score: (state) => ({ moves: state.turns }),
};

export default puzzle;
