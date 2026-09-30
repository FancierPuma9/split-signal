import type { Rng } from '@split-signal/shared';

export type Dir = 'n' | 'e' | 's' | 'w';
export const DIRS: readonly Dir[] = ['n', 'e', 's', 'w'];
export const BIT: Record<Dir, number> = { n: 1, e: 2, s: 4, w: 8 };
export const OPPOSITE: Record<Dir, Dir> = { n: 's', e: 'w', s: 'n', w: 'e' };

export const SIZE = 15;
export const JUNCTIONS = { min: 25, max: 35 };

export interface Maze {
  size: number;
  /** Open sides of each cell, as bits (n 1, e 2, s 4, w 8). Index = row * size + col. */
  cells: number[];
  start: number;
  exit: number;
}

export function step(cell: number, dir: Dir, size: number): number | null {
  const r = Math.floor(cell / size);
  const c = cell % size;
  if (dir === 'n') return r > 0 ? cell - size : null;
  if (dir === 's') return r < size - 1 ? cell + size : null;
  if (dir === 'w') return c > 0 ? cell - 1 : null;
  return c < size - 1 ? cell + 1 : null;
}

export const openSides = (maze: Maze, cell: number) =>
  DIRS.filter((d) => ((maze.cells[cell] ?? 0) & BIT[d]) !== 0);

/** A cell with three or more ways out: somewhere a direction has to be chosen. */
export const isJunction = (maze: Maze, cell: number) => openSides(maze, cell).length >= 3;

export function countJunctions(maze: Maze): number {
  return maze.cells.filter((_, cell) => isJunction(maze, cell)).length;
}

/**
 * A perfect maze (exactly one route between any two cells) by the growing-tree method: carving
 * from the newest cell makes long corridors, from a random one makes lots of branches. `newest` is
 * the chance of the former.
 */
function growingTree(size: number, rng: Rng, newest: number): number[] {
  const cells = new Array<number>(size * size).fill(0);
  const visited = new Set<number>();
  const start = rng.int(0, size * size - 1);
  const active = [start];
  visited.add(start);
  while (active.length > 0) {
    const index = rng.chance(newest) ? active.length - 1 : rng.int(0, active.length - 1);
    const cell = active[index]!;
    const options = DIRS.filter((d) => {
      const next = step(cell, d, size);
      return next !== null && !visited.has(next);
    });
    if (options.length === 0) {
      active.splice(index, 1);
      continue;
    }
    const dir = rng.pick(options);
    const next = step(cell, dir, size)!;
    cells[cell]! |= BIT[dir];
    cells[next]! |= BIT[OPPOSITE[dir]];
    visited.add(next);
    active.push(next);
  }
  return cells;
}

/**
 * A 15x15 perfect maze with 25-35 junctions (so there's plenty to say), entered at one corner and
 * left at the opposite one.
 */
export function generateMaze(rng: Rng, size = SIZE): Maze {
  const corners = [0, size - 1, size * (size - 1), size * size - 1];
  let best: { cells: number[]; off: number } | null = null;
  for (let attempt = 0; attempt < 40; attempt++) {
    const cells = growingTree(size, rng.fork(`attempt-${attempt}`), 0.7);
    const junctions = cells.filter((bits) => DIRS.filter((d) => bits & BIT[d]).length >= 3).length;
    const off = Math.max(0, JUNCTIONS.min - junctions, junctions - JUNCTIONS.max);
    if (!best || off < best.off) best = { cells, off };
    if (off === 0) break;
  }
  const corner = rng.int(0, 3);
  return { size, cells: best!.cells, start: corners[corner]!, exit: corners[3 - corner]! };
}

/** For every cell, the first step towards the exit (none at the exit itself). */
export function towardExit(maze: Maze): Array<Dir | null> {
  const toward = new Array<Dir | null>(maze.cells.length).fill(null);
  const seen = new Set([maze.exit]);
  const queue = [maze.exit];
  while (queue.length > 0) {
    const cell = queue.shift()!;
    for (const dir of openSides(maze, cell)) {
      const next = step(cell, dir, maze.size);
      if (next === null || seen.has(next)) continue;
      seen.add(next);
      toward[next] = OPPOSITE[dir];
      queue.push(next);
    }
  }
  return toward;
}

/** The route from start to exit, as cells. */
export function solution(maze: Maze): number[] {
  const toward = towardExit(maze);
  const path = [maze.start];
  let cell = maze.start;
  while (cell !== maze.exit) {
    const dir = toward[cell];
    if (!dir) break;
    cell = step(cell, dir, maze.size)!;
    path.push(cell);
  }
  return path;
}
