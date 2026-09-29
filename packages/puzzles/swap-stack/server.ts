import type { PuzzleServerModule } from '@split-signal/shared';
import { BUILD_MS, PIECES, SORT_MS, manifest } from './manifest';
import { COLUMNS, MATERIALS, MATERIAL_NAMES, loads, settle, shortest, type Piece } from './tower';
import type { Action, State, View } from './types';

const activeBuilder = (state: State) => state.placed % state.builders.length;

/** Tallest surviving column, plus pieces standing / 100 to break ties. */
export function points(state: State): number {
  const all = state.columns.flat();
  const tallest = Math.max(0, ...all.map((c) => c.length));
  const standing = all.reduce((n, c) => n + c.length, 0);
  return tallest + standing / 100;
}

function sorted(state: State, swapped: boolean, now: number): State {
  const remaining = [...state.remaining];
  if (swapped && remaining.length >= 2)
    [remaining[0], remaining[1]] = [remaining[1]!, remaining[0]!];
  return {
    ...state,
    remaining,
    phase: 'build',
    phaseEndsAt: now + BUILD_MS,
    lastSort: { piece: state.placed, swapped },
  };
}

function place(state: State, column: number, now: number): State {
  const [piece, ...remaining] = state.remaining;
  if (!piece) return state;
  const b = activeBuilder(state);
  const columns = state.columns.map((set) => set.map((c) => [...c]));
  const { column: settled, fell } = settle([...columns[b]![column]!, piece]);
  columns[b]![column] = settled;
  const placed = state.placed + 1;
  const done = placed >= state.total;
  return {
    ...state,
    columns,
    remaining,
    placed,
    phase: 'sort',
    phaseEndsAt: now + SORT_MS,
    lastFall: fell > 0 ? { builder: b, column, count: fell, piece: placed - 1 } : state.lastFall,
    done,
  };
}

const puzzle: PuzzleServerModule<State, View, Action> = {
  manifest,

  init({ rng, players, roundIndex }) {
    if (players.length < 2) throw new Error('Swap Stack needs at least 2 players');
    // The Sorter rotates with the round; everyone else builds.
    const sorter = players[roundIndex % players.length]!.id;
    const builders = players.filter((p) => p.id !== sorter).map((p) => p.id);
    const remaining: Piece[] = Array.from({ length: PIECES }, (_, id) => ({
      id,
      material: rng.pick(MATERIAL_NAMES),
    }));
    return {
      sorter,
      builders,
      columns: builders.map(() => Array.from({ length: COLUMNS }, () => [])),
      remaining,
      placed: 0,
      total: PIECES,
      phase: 'sort',
      phaseEndsAt: SORT_MS,
      lastSort: null,
      lastFall: null,
      done: false,
    };
  },

  view(state, playerId) {
    const common = {
      phase: state.phase,
      phaseEndsAt: state.phaseEndsAt,
      placed: state.placed,
      total: state.total,
      activeBuilder: activeBuilder(state),
      lastSort: state.lastSort,
      lastFall: state.lastFall,
      done: state.done,
    };
    const queue = state.remaining.slice(0, 2);
    if (playerId === state.sorter) {
      return {
        ...common,
        role: 'sorter',
        columns: state.columns.map((set) =>
          set.map((c) => {
            const load = loads(c);
            return c.map((p, i) => ({
              id: p.id,
              material: p.material,
              load: load[i]!,
              strength: MATERIALS[p.material].strength,
            }));
          }),
        ),
        queue: queue.map((p) => ({ id: p.id, material: p.material })),
      };
    }
    // Builders see shapes, never materials.
    return {
      ...common,
      role: 'builder',
      me: state.builders.indexOf(playerId),
      columns: state.columns.map((set) => set.map((c) => c.map((p) => ({ id: p.id })))),
      queue: queue.map((p) => ({ id: p.id })),
    };
  },

  apply(state, playerId, action, ctx) {
    if (state.done) return { reject: 'The tower is finished' };
    if (action?.type === 'swap' || action?.type === 'keep') {
      if (playerId !== state.sorter) return { reject: 'Only the Sorter chooses the order' };
      if (state.phase !== 'sort') return { reject: 'Wait for the Builder' };
      return { state: sorted(state, action.type === 'swap', ctx.elapsedMs) };
    }
    if (action?.type === 'place') {
      if (state.builders[activeBuilder(state)] !== playerId) {
        return {
          reject: playerId === state.sorter ? 'The Sorter never places' : "It's not your turn",
        };
      }
      if (state.phase !== 'build') return { reject: 'Wait for the Sorter' };
      if (!Number.isInteger(action.column) || action.column < 0 || action.column >= COLUMNS) {
        return { reject: 'No such column' };
      }
      return { state: place(state, action.column, ctx.elapsedMs) };
    }
    return { reject: 'Unknown action' };
  },

  tick(state, now) {
    if (state.done || now < state.phaseEndsAt) return state;
    // Out of time: the Sorter keeps the order; the Builder's piece goes on the shortest column.
    if (state.phase === 'sort') return sorted(state, false, now);
    return place(state, shortest(state.columns[activeBuilder(state)]!), now);
  },

  isSolved: (state) => state.done,

  // Scored whether finished or not: the tower as it stands at the buzzer.
  score: (state) => ({ points: points(state) }),
};

export default puzzle;
