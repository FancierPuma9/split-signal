export type Material = 'wood' | 'iron' | 'steel' | 'concrete';

/** Weight it puts on the pieces below, and how much weight it can carry itself. */
export const MATERIALS: Record<Material, { weight: number; strength: number }> = {
  wood: { weight: 1, strength: 2 },
  iron: { weight: 3, strength: 5 },
  steel: { weight: 4, strength: 8 },
  concrete: { weight: 5, strength: 6 },
};

export const MATERIAL_NAMES = Object.keys(MATERIALS) as Material[];
export const COLUMNS = 5;

export interface Piece {
  id: number;
  material: Material;
}

/** The weight resting on each piece of a column (bottom first). */
export function loads(column: readonly Piece[]): number[] {
  const out = Array<number>(column.length).fill(0);
  let above = 0;
  for (let i = column.length - 1; i >= 0; i--) {
    out[i] = above;
    above += MATERIALS[column[i]!.material].weight;
  }
  return out;
}

/**
 * Settles a column after a placement: the lowest piece carrying more than its strength fails, and
 * it and everything above it fall off. Pieces below it were holding the full stack, so they're
 * fine once it's gone. Returns the column that's left and how many pieces fell.
 */
export function settle(column: readonly Piece[]): { column: Piece[]; fell: number } {
  const load = loads(column);
  const failing = column.findIndex((p, i) => load[i]! > MATERIALS[p.material].strength);
  if (failing === -1) return { column: [...column], fell: 0 };
  return { column: column.slice(0, failing), fell: column.length - failing };
}

/** The column to use when the Builder runs out of time: the shortest, leftmost first. */
export function shortest(columns: readonly (readonly Piece[])[]): number {
  let best = 0;
  columns.forEach((c, i) => {
    if (c.length < columns[best]!.length) best = i;
  });
  return best;
}
