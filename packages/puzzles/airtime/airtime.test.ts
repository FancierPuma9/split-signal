import { describe, expect, it } from 'vitest';
import { startPuzzle, type HiddenInfo, type PuzzleDriver } from '../harness';
import { neighbours, tileAt, type Building, type Pos } from './building';
import puzzle, { MIN_STEP_MS, progress } from './server';
import type { Action, Dir, NavigatorView, State, View, WalkerView } from './types';

type Game = PuzzleDriver<State, View, Action>;

const key = (p: Pos) => `${p.floor}:${p.x}:${p.y}`;

/** The shortest list of moves from one tile to another. */
function route(b: Building, from: Pos, to: Pos): Dir[] {
  const prev = new Map<string, Pos | null>([[key(from), null]]);
  const queue = [from];
  for (let i = 0; i < queue.length && !prev.has(key(to)); i++) {
    for (const q of neighbours(b.floors, queue[i]!)) {
      if (prev.has(key(q))) continue;
      prev.set(key(q), queue[i]!);
      queue.push(q);
    }
  }
  const dirs: Dir[] = [];
  for (let p = to; key(p) !== key(from);) {
    const q = prev.get(key(p))!;
    dirs.unshift(
      q.floor < p.floor
        ? 'up'
        : q.floor > p.floor
          ? 'down'
          : q.x < p.x
            ? 'e'
            : q.x > p.x
              ? 'w'
              : q.y < p.y
                ? 's'
                : 'n',
    );
    p = q;
  }
  return dirs;
}

function walk(game: Game, to: Pos) {
  for (const dir of route(game.state.building, game.state.pos, to)) {
    game.advance(MIN_STEP_MS);
    expect(game.act(1, { type: 'move', dir })).toMatchObject({ ok: true });
  }
}

/** A tile nowhere near the Walker: another floor, or at least three steps away. */
function farTile(state: State): Pos {
  const { building, pos } = state;
  for (let f = 0; f < building.floors.length; f++) {
    for (let y = 1; y < building.floors[f]!.length - 1; y++) {
      for (let x = 1; x < building.floors[f]![y]!.length - 1; x++) {
        if (f !== pos.floor || Math.abs(x - pos.x) > 2 || Math.abs(y - pos.y) > 2) {
          if (!building.objectives.some((o) => o.floor === f && o.x === x && o.y === y))
            return { floor: f, x, y };
        }
      }
    }
  }
  throw new Error('no far tile');
}

const hidden: HiddenInfo<State>[] = [
  {
    name: 'the map beyond one step',
    hiddenFrom: (p) => p.seat === 1,
    change: (state) => {
      const far = farTile(state);
      const floors = state.building.floors.map((rows, f) =>
        f !== far.floor
          ? rows
          : rows.map((row, y) =>
              y !== far.y
                ? row
                : row.slice(0, far.x) + (row[far.x] === '#' ? '.' : '#') + row.slice(far.x + 1),
            ),
      );
      return { ...state, building: { ...state.building, floors } };
    },
  },
  {
    name: 'where the objectives are',
    hiddenFrom: (p) => p.seat === 1,
    change: (state) => {
      const far = farTile(state);
      const objectives = state.building.objectives.map((o, i) =>
        i === state.building.objectives.length - 1 && state.done < i ? { ...o, ...far } : o,
      );
      return { ...state, building: { ...state.building, objectives } };
    },
    until: (state) => state.done >= state.building.objectives.length - 1,
  },
];

describe('airtime', () => {
  it('gives the Navigator the map and the Walker one step of it', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    const nav = game.view(0) as NavigatorView;
    const walker = game.view(1) as WalkerView;
    expect(nav.floors).toHaveLength(game.state.building.floors.length);
    expect(nav.walker).toEqual(game.state.building.entrance);
    expect(nav.objectives[0]).toMatchObject({ done: false, floor: expect.any(Number) });
    expect(walker.around).toHaveLength(3);
    expect(walker.around[1]![1]).toBe('E');
    expect(walker.objectives[0]).toEqual({
      label: game.state.building.objectives[0]!.label,
      done: false,
    });
    expect(walker).not.toHaveProperty('floors.0');
  });

  it('walks the whole route: every objective in order, then out', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    const { objectives, entrance } = game.state.building;
    for (const [i, objective] of objectives.entries()) {
      walk(game, objective);
      expect((game.view(1) as WalkerView).canInteract).toBe(true);
      expect(game.act(1, { type: 'interact' })).toMatchObject({ ok: true });
      expect(game.state.done).toBe(i + 1);
    }
    expect(game.solved).toBe(false);
    walk(game, entrance);
    expect(game.solved).toBe(true);
    expect(game.view(0)).toMatchObject({ solved: true });
  });

  it('only counts objectives in order', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    walk(game, game.state.building.objectives[1]!);
    expect((game.view(1) as WalkerView).canInteract).toBe(false);
    expect(game.act(1, { type: 'interact' })).toMatchObject({ ok: false });
    expect(game.state.done).toBe(0);
  });

  it('refuses walls, fake stairs, and stepping too fast', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    const { building, pos } = game.state;
    const wall = (['n', 's', 'e', 'w'] as const).find((d) => {
      const [dx, dy] = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] }[d];
      return tileAt(building.floors, { floor: pos.floor, x: pos.x + dx!, y: pos.y + dy! }) === '#';
    })!;
    game.advance(MIN_STEP_MS);
    expect(game.act(1, { type: 'move', dir: wall })).toMatchObject({
      ok: false,
      reason: "There's a wall there",
    });
    expect(game.act(1, { type: 'move', dir: 'up' })).toMatchObject({ ok: false });
    const [first] = route(building, pos, building.objectives[0]!);
    game.act(1, { type: 'move', dir: first! });
    expect(game.act(1, { type: 'move', dir: first! })).toMatchObject({
      ok: false,
      reason: 'Slow down',
    });
    expect(game.act(0, { type: 'move', dir: first! })).toMatchObject({ ok: false });
  });

  it('takes the stairs between floors', () => {
    for (let i = 0; i < 30; i++) {
      const game = startPuzzle(puzzle, { players: 2, seed: `stairs-${i}` });
      const { building } = game.state;
      if (building.floors.length < 2) continue;
      const y = building.floors[0]!.findIndex((row) => row.includes('^'));
      const stairs = { floor: 0, x: building.floors[0]![y]!.indexOf('^'), y };
      walk(game, stairs);
      expect((game.view(1) as WalkerView).stairs).toBe('up');
      game.advance(MIN_STEP_MS);
      game.act(1, { type: 'move', dir: 'up' });
      expect(game.state.pos).toEqual({ ...stairs, floor: 1 });
      expect(game.view(1) as WalkerView).toMatchObject({ floor: 1, stairs: 'down' });
      return;
    }
    throw new Error('no multi-floor building in 30 seeds');
  });

  it('scores progress for teams that never get out', () => {
    const game = startPuzzle(puzzle, { players: 2 });
    expect(game.score()).toEqual({ points: 0 });
    const { objectives } = game.state.building;
    const steps = route(game.state.building, game.state.pos, objectives[0]!);
    for (const dir of steps.slice(0, Math.ceil(steps.length / 2))) {
      game.advance(MIN_STEP_MS);
      game.act(1, { type: 'move', dir });
    }
    expect(progress(game.state)).toBeGreaterThan(0.3);
    expect(progress(game.state)).toBeLessThan(1);
    walk(game, objectives[0]!);
    game.act(1, { type: 'interact' });
    expect(game.score().points).toBeGreaterThanOrEqual(1);
    expect(game.score().points).toBeLessThan(2);
  });

  it('swaps roles on alternate rounds', () => {
    const game = startPuzzle(puzzle, { players: 2, roundIndex: 1 });
    expect(game.view(0).role).toBe('walker');
    expect(game.view(1).role).toBe('navigator');
  });
});
