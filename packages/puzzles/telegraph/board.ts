import type { Rng } from '@split-signal/shared';

export const SIZE = 10;
export const REGION_CELLS = { min: 20, max: 45 };
export const FILL = { min: 0.3, max: 0.4 };

const neighbours = (cell: number, size: number): number[] => {
  const r = Math.floor(cell / size);
  const c = cell % size;
  const out: number[] = [];
  if (r > 0) out.push(cell - size);
  if (r < size - 1) out.push(cell + size);
  if (c > 0) out.push(cell - 1);
  if (c < size - 1) out.push(cell + 1);
  return out;
};

/** Every cell touching this one, diagonals included. */
const around = (cell: number, size: number): number[] => {
  const r = Math.floor(cell / size);
  const c = cell % size;
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr;
      const cc = c + dc;
      if ((dr || dc) && rr >= 0 && rr < size && cc >= 0 && cc < size) out.push(rr * size + cc);
    }
  }
  return out;
};

/**
 * An irregular board: a connected blob grown from a random start (arms, bays, bumps), plus one to
 * three stray islands of one or two cells that don't touch it. Different every round, so no
 * numbering scheme agreed in advance fits it.
 */
export function generateRegion(rng: Rng, size = SIZE): number[] {
  // Islands add one to six cells, which keeps the total in range.
  const target = rng.int(REGION_CELLS.min - 1, REGION_CELLS.max - 6);
  const start = rng.int(2, size - 3) * size + rng.int(2, size - 3);
  const blob = new Set([start]);
  while (blob.size < target) {
    // Grow from a random edge cell, leaning towards the newest cells to make arms.
    const cells = [...blob];
    const from = rng.chance(0.6)
      ? cells[cells.length - 1 - rng.int(0, Math.min(3, cells.length - 1))]!
      : rng.pick(cells);
    const options = neighbours(from, size).filter((n) => !blob.has(n));
    if (options.length > 0) blob.add(rng.pick(options));
  }
  const taken = new Set(blob);
  const islands = rng.int(1, 3);
  for (let i = 0, tries = 0; i < islands && tries < 200; tries++) {
    const cell = rng.int(0, size * size - 1);
    if ([cell, ...around(cell, size)].some((c) => taken.has(c))) continue;
    const island = [cell];
    const next = rng.pick(neighbours(cell, size));
    if (rng.chance(0.5) && !around(next, size).some((c) => taken.has(c))) island.push(next);
    for (const c of island) taken.add(c);
    i += 1;
  }
  return [...taken].sort((a, b) => a - b);
}

/** 30-40% of the board, seeded. */
export function generateTarget(region: readonly number[], rng: Rng): number[] {
  const count = Math.round(region.length * (FILL.min + rng.next() * (FILL.max - FILL.min)));
  return rng
    .shuffle(region)
    .slice(0, Math.max(1, count))
    .sort((a, b) => a - b);
}

/** Splits the board between two Receivers down its middle column (left half, right half). */
export function splitBoard(region: readonly number[], size = SIZE): [number[], number[]] {
  const cols = region.map((c) => c % size).sort((a, b) => a - b);
  const middle = cols[Math.floor(cols.length / 2)] ?? size / 2;
  const left = region.filter((c) => c % size < middle);
  const right = region.filter((c) => c % size >= middle);
  return left.length > 0 && right.length > 0
    ? [left, right]
    : [region.slice(0, 1), region.slice(1)];
}
