import type { Rng } from '@split-signal/shared';

export const SIZE = 9;
/** Start and target are at least this many steps apart. */
export const MIN_DISTANCE = 6;

export interface Cell {
  x: number;
  y: number;
}

export type Dir = 'up' | 'down' | 'left' | 'right';
export const DIRS: readonly Dir[] = ['up', 'down', 'left', 'right'];
export const STEP: Record<Dir, [number, number]> = {
  up: [0, -1],
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
};

export const isOpen = (grid: readonly string[], c: Cell) => grid[c.y]?.[c.x] === '.';

/** Where a move ends up: one step, unless a wall or the edge is in the way. */
export function stepFrom(grid: readonly string[], c: Cell, dir: Dir): Cell {
  const [dx, dy] = STEP[dir];
  const next = { x: c.x + dx, y: c.y + dy };
  return isOpen(grid, next) ? next : c;
}

export const manhattan = (a: Cell, b: Cell) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

export function distances(grid: readonly string[], from: Cell): Map<string, number> {
  const dist = new Map([[`${from.x},${from.y}`, 0]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i]!;
    for (const dir of DIRS) {
      const n = stepFrom(grid, c, dir);
      const k = `${n.x},${n.y}`;
      if (dist.has(k)) continue;
      dist.set(k, dist.get(`${c.x},${c.y}`)! + 1);
      queue.push(n);
    }
  }
  return dist;
}

/** A 9×9 grid with a few wall blocks, every open cell reachable from every other. */
export function makeGrid(rng: Rng): string[] {
  for (;;) {
    const cells = Array.from({ length: SIZE }, () => Array<string>(SIZE).fill('.'));
    const blocks = rng.int(4, 6);
    for (let b = 0; b < blocks; b++) {
      // A short bar, one to three cells, sometimes bent.
      let x = rng.int(1, SIZE - 2);
      let y = rng.int(1, SIZE - 2);
      const length = rng.int(1, 3);
      for (let i = 0; i < length; i++) {
        cells[y]![x] = '#';
        const [dx, dy] = STEP[rng.pick(DIRS)];
        x = Math.min(SIZE - 2, Math.max(1, x + dx));
        y = Math.min(SIZE - 2, Math.max(1, y + dy));
      }
    }
    const grid = cells.map((row) => row.join(''));
    const open = grid.flatMap((row, y) =>
      [...row].flatMap((t, x) => (t === '.' ? [{ x, y }] : [])),
    );
    if (distances(grid, open[0]!).size === open.length) return grid;
  }
}

/** A start and target at least MIN_DISTANCE steps apart. */
export function placePair(rng: Rng, grid: readonly string[]): { start: Cell; target: Cell } {
  const open = grid.flatMap((row, y) => [...row].flatMap((t, x) => (t === '.' ? [{ x, y }] : [])));
  for (;;) {
    const start = rng.pick(open);
    const far = [...distances(grid, start)]
      .filter(([, d]) => d >= MIN_DISTANCE)
      .map(([k]) => {
        const [x, y] = k.split(',').map(Number);
        return { x: x!, y: y! };
      });
    if (far.length > 0) return { start, target: rng.pick(far) };
  }
}
