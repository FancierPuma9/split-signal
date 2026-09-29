import type { PuzzleServerModule } from '@split-signal/shared';
import { distance, generateBuilding, isWalkable, tileAt, type Pos } from './building';
import { NAVIGATOR_SEES_WALKER, manifest } from './manifest';
import type { Action, Dir, State, View } from './types';

/** How far the Walker can see, in tiles. */
export const VISION = 1;
/** Steps closer together than this are refused (the client repeats held keys slower). */
export const MIN_STEP_MS = 90;

const STEP: Record<'n' | 's' | 'e' | 'w', [number, number]> = {
  n: [0, -1],
  s: [0, 1],
  e: [1, 0],
  w: [-1, 0],
};

const same = (a: Pos, b: Pos) => a.floor === b.floor && a.x === b.x && a.y === b.y;

/** Where the Walker is headed now: the current objective, or the exit once they're all done. */
export function nextStop(state: State): Pos {
  return state.building.objectives[state.done] ?? state.building.entrance;
}

/**
 * Progress for teams that don't make it out: one point per objective, plus how much of the way
 * to the next stop they've covered (under a point, so finishing an objective always counts more).
 */
export function progress(state: State): number {
  const { building, done } = state;
  const from = done === 0 ? building.entrance : building.objectives[done - 1]!;
  const leg = distance(building.floors, from, nextStop(state));
  const left = distance(building.floors, state.pos, nextStop(state));
  const partial = leg > 0 ? Math.min(0.99, Math.max(0, 1 - left / leg)) : 0;
  return Math.round((done + partial) * 100) / 100;
}

function roomAt(state: State, p: Pos): string | null {
  const room = state.building.rooms.find(
    (r) => r.floor === p.floor && p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h,
  );
  return room?.name ?? null;
}

const puzzle: PuzzleServerModule<State, View, Action> = {
  manifest,

  init({ rng, players, roundIndex }) {
    const [a, b] = players;
    if (!a || !b) throw new Error('Airtime needs 2 players');
    const [navigator, walker] = roundIndex % 2 === 0 ? [a, b] : [b, a];
    const building = generateBuilding(rng);
    return {
      navigator: navigator.id,
      walker: walker.id,
      building,
      pos: building.entrance,
      done: 0,
      lastMoveAt: -MIN_STEP_MS,
      solvedAt: null,
    };
  },

  view(state, playerId) {
    const { building } = state;
    const solved = state.solvedAt !== null;
    if (playerId === state.navigator) {
      return {
        role: 'navigator',
        floors: building.floors.map((f) => [...f]),
        rooms: building.rooms,
        objectives: building.objectives.map((o, i) => ({
          floor: o.floor,
          x: o.x,
          y: o.y,
          label: o.label,
          icon: o.icon,
          done: i < state.done,
        })),
        current: state.done,
        entrance: building.entrance,
        walker: NAVIGATOR_SEES_WALKER ? state.pos : null,
        solved,
      };
    }
    const { pos } = state;
    const around: string[] = [];
    for (let dy = -VISION; dy <= VISION; dy++) {
      let row = '';
      for (let dx = -VISION; dx <= VISION; dx++) {
        row += tileAt(building.floors, { floor: pos.floor, x: pos.x + dx, y: pos.y + dy });
      }
      around.push(row);
    }
    const things = building.objectives.flatMap((o, i) =>
      i >= state.done &&
      o.floor === pos.floor &&
      Math.abs(o.x - pos.x) <= VISION &&
      Math.abs(o.y - pos.y) <= VISION
        ? [{ dx: o.x - pos.x, dy: o.y - pos.y, icon: o.icon, current: i === state.done }]
        : [],
    );
    const here = tileAt(building.floors, pos);
    const target = building.objectives[state.done];
    return {
      role: 'walker',
      floor: pos.floor,
      floors: building.floors.length,
      around,
      things,
      room: roomAt(state, pos),
      objectives: building.objectives.map((o, i) => ({ label: o.label, done: i < state.done })),
      current: state.done,
      canInteract: target !== undefined && same(target, pos),
      stairs: here === '^' ? 'up' : here === 'v' ? 'down' : null,
      solved,
    };
  },

  apply(state, playerId, action, ctx) {
    if (playerId !== state.walker) return { reject: 'Only the Walker can move' };
    if (state.solvedAt !== null) return { reject: 'You made it out' };
    const { building, pos } = state;

    if (action?.type === 'interact') {
      const target = building.objectives[state.done];
      if (!target || !same(target, pos)) return { reject: "There's nothing to do here" };
      return { state: { ...state, done: state.done + 1 } };
    }
    if (action?.type !== 'move') return { reject: 'Unknown action' };
    if (ctx.elapsedMs - state.lastMoveAt < MIN_STEP_MS) return { reject: 'Slow down' };

    const here = tileAt(building.floors, pos);
    let next: Pos;
    const dir: Dir = action.dir;
    if (dir === 'up' || dir === 'down') {
      if (here !== (dir === 'up' ? '^' : 'v')) return { reject: `There are no stairs ${dir} here` };
      next = { ...pos, floor: pos.floor + (dir === 'up' ? 1 : -1) };
    } else if (dir in STEP) {
      const [dx, dy] = STEP[dir];
      next = { floor: pos.floor, x: pos.x + dx, y: pos.y + dy };
      if (!isWalkable(tileAt(building.floors, next))) return { reject: "There's a wall there" };
    } else {
      return { reject: 'Unknown direction' };
    }

    const out = state.done === building.objectives.length && tileAt(building.floors, next) === 'E';
    return {
      state: {
        ...state,
        pos: next,
        lastMoveAt: ctx.elapsedMs,
        solvedAt: out ? ctx.elapsedMs : null,
      },
    };
  },

  isSolved: (state) => state.solvedAt !== null,

  // Race on time; points only count if nobody gets out.
  score: (state) => ({
    points: state.solvedAt !== null ? state.building.objectives.length + 1 : progress(state),
  }),
};

export default puzzle;
