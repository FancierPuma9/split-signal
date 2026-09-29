import type { PlayerInfo, Rng } from '@split-signal/shared';
import { DIRECTIONS, type Cell, type Dir, type Tile } from './types';

const OFFSETS: Record<Dir, Cell> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export const cellKey = (c: Cell) => `${c.x},${c.y}`;
export const sameCell = (a: Cell, b: Cell) => a.x === b.x && a.y === b.y;
export const step = (c: Cell, dir: Dir): Cell => ({
  x: c.x + OFFSETS[dir].x,
  y: c.y + OFFSETS[dir].y,
});
export const inBounds = (c: Cell, size: number) => c.x >= 0 && c.y >= 0 && c.x < size && c.y < size;

/** Board size and tiles per player for a team size. Tune after playtesting. */
export function layoutFor(players: number): { size: number; tilesPerPlayer: number } {
  return { size: players <= 2 ? 4 : 5, tilesPerPlayer: 3 };
}

/**
 * Resolves one turn of simultaneous moves. A move succeeds if its destination is free once every
 * move is applied, so a tile can follow one that is leaving. Moves fail when:
 *   - the destination is off the board,
 *   - two or more tiles claim the same square (all of them fail),
 *   - two tiles try to swap places (they can't pass through each other),
 *   - the destination holds a tile that isn't successfully moving away (this cascades).
 * Submission order never matters.
 */
export function resolveTurn(
  tiles: readonly Tile[],
  moves: ReadonlyArray<{ tileId: string; dir: Dir }>,
  size: number,
): { moved: Set<string>; bumped: Set<string> } {
  const byId = new Map(tiles.map((t) => [t.id, t]));
  const occupant = new Map(tiles.map((t) => [cellKey(t.pos), t.id]));
  const bumped = new Set<string>();
  const dest = new Map<string, Cell>();

  for (const move of moves) {
    const tile = byId.get(move.tileId);
    if (!tile) continue;
    const to = step(tile.pos, move.dir);
    if (inBounds(to, size)) dest.set(tile.id, to);
    else bumped.add(tile.id);
  }

  const fail = (id: string) => {
    dest.delete(id);
    bumped.add(id);
  };

  // Same destination: everyone involved fails.
  const claims = new Map<string, string[]>();
  for (const [id, to] of dest) claims.set(cellKey(to), [...(claims.get(cellKey(to)) ?? []), id]);
  for (const ids of claims.values()) if (ids.length > 1) ids.forEach(fail);

  // Swaps: two tiles trading places would pass through each other.
  for (const [id, to] of [...dest]) {
    const other = occupant.get(cellKey(to));
    const otherTo = other && dest.get(other);
    const tile = byId.get(id);
    if (other && otherTo && tile && sameCell(otherTo, tile.pos)) {
      fail(id);
      fail(other);
    }
  }

  // Blocked by a tile that stays put; repeat until nothing changes so blocks cascade.
  let changed = true;
  while (changed) {
    changed = false;
    for (const [id, to] of [...dest]) {
      const other = occupant.get(cellKey(to));
      if (other && other !== id && !dest.has(other)) {
        fail(id);
        changed = true;
      }
    }
  }

  return { moved: new Set(dest.keys()), bumped };
}

/** Applies the successful moves from resolveTurn. */
export function applyMoves(
  tiles: readonly Tile[],
  moves: ReadonlyArray<{ tileId: string; dir: Dir }>,
  moved: ReadonlySet<string>,
): Tile[] {
  const dirs = new Map(moves.map((m) => [m.tileId, m.dir]));
  return tiles.map((tile) => {
    const dir = dirs.get(tile.id);
    return dir && moved.has(tile.id) ? { ...tile, pos: step(tile.pos, dir) } : tile;
  });
}

/**
 * Builds a solved layout (every tile on its target), then scrambles it with random legal single
 * moves. Every move is reversible, so the result is always solvable.
 */
export function generateTiles(
  players: readonly PlayerInfo[],
  rng: Rng,
): { size: number; tiles: Tile[] } {
  const { size, tilesPerPlayer } = layoutFor(players.length);
  const cells: Cell[] = [];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) cells.push({ x, y });
  const targets = rng.shuffle(cells);

  let tiles: Tile[] = players.flatMap((player, p) =>
    Array.from({ length: tilesPerPlayer }, (_, k) => {
      const target = targets[p * tilesPerPlayer + k] as Cell;
      return {
        id: `s${player.seat}-${k}`,
        owner: player.id,
        label: String.fromCharCode(65 + k),
        pos: target,
        target,
      };
    }),
  );

  const scrambleMoves = tiles.length * 10;
  for (let i = 0; i < scrambleMoves * 3; i++) {
    const offTarget = tiles.filter((t) => !sameCell(t.pos, t.target)).length;
    if (i >= scrambleMoves && offTarget === tiles.length) break;
    const tile = rng.pick(tiles);
    const to = step(tile.pos, rng.pick(DIRECTIONS));
    if (!inBounds(to, size) || tiles.some((t) => sameCell(t.pos, to))) continue;
    tiles = tiles.map((t) => (t === tile ? { ...t, pos: to } : t));
  }
  return { size, tiles };
}

export const allPlaced = (tiles: readonly Tile[]) => tiles.every((t) => sameCell(t.pos, t.target));
