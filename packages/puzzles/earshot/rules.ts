import type { Rng } from '@split-signal/shared';
import { BIT, DIRS, OPPOSITE, distancesFrom, step, type Dir, type Maze } from '../lib/maze';
import type { Ghost, Hunter } from './types';

export const GHOST_STEP_MS = 1500;
export const RADIUS = { min: 2, max: 12 };
/** Loudness (dBFS) at the smallest and largest radius. */
export const LOUDNESS = { quiet: -50, loud: -10 };
export const SMOOTH_MS = 500;
/** No level report for this long counts as silence. */
export const SILENT_AFTER_MS = 1000;
export const BEAM_TILES = 2;
export const BATTERY = { max: 100, drainPerSec: 20, rechargePerSec: 5, minToLight: 5 };
export const CATCH_COOLDOWN_MS = 2000;
export const MUTE_MS = 5000;
export const HUNTER_STEP_MS = 150;
export const HUNTER_SIGHT = 3;
export const POINTS = { own: 5, enemy: 3 };
/** How much farther enemy hunters hear a ghost than its own hunter does (never below 1). */
export const ENEMY_RANGE_MULTIPLIER = 1;
/** Respawns land at least this far (by path) from every hunter. */
const FAR = 6;

/** The radius a loudness asks for: 2 tiles when quiet, 12 when loud. */
export function radiusFor(db: number): number {
  const t = Math.max(0, Math.min(1, (db - LOUDNESS.quiet) / (LOUDNESS.loud - LOUDNESS.quiet)));
  return RADIUS.min + t * (RADIUS.max - RADIUS.min);
}

/** Moves the radius towards what the ghost's loudness asks for, over about SMOOTH_MS. */
export function smoothRadius(ghost: Ghost, now: number, dtMs: number): number {
  const silent = ghost.heardAt === null || now - ghost.heardAt > SILENT_AFTER_MS;
  const target = silent ? RADIUS.min : radiusFor(ghost.db);
  const next = ghost.radius + (target - ghost.radius) * Math.min(1, dtMs / SMOOTH_MS);
  return Math.round(next * 10) / 10;
}

/**
 * Whether a hunter can hear a ghost, and how loud: within the ghost's radius measured along the
 * maze (so a ghost behind a wall sounds farther than one down the corridor), fading to nothing
 * at the edge. A muted ghost can't be heard at all.
 */
export function hearing(
  maze: Maze,
  ghost: Ghost,
  hunterPos: number,
  enemy: boolean,
  now: number,
  distances: number[] = distancesFrom(maze, ghost.pos),
): { audible: boolean; gain: number } {
  const muted = ghost.mutedUntil !== null && now < ghost.mutedUntil;
  const radius = ghost.radius * (enemy ? Math.max(1, ENEMY_RANGE_MULTIPLIER) : 1);
  const dist = distances[hunterPos] ?? Infinity;
  if (muted || dist > radius) return { audible: false, gain: 0 };
  return { audible: true, gain: Math.max(0, 1 - dist / radius) };
}

/** The tiles a hunter's flashlight lights: up to two ahead, stopped by walls. */
export function litTiles(maze: Maze, hunter: Hunter): number[] {
  if (!hunter.light) return [];
  const tiles: number[] = [];
  let cell = hunter.pos;
  for (let i = 0; i < BEAM_TILES; i++) {
    if (((maze.cells[cell] ?? 0) & BIT[hunter.facing]) === 0) break;
    cell = step(cell, hunter.facing, maze.size)!;
    tiles.push(cell);
  }
  return tiles;
}

/** One drift step: any open way except straight back, unless it's a dead end. */
export function drift(maze: Maze, ghost: Ghost, rng: Rng): number {
  const options = DIRS.filter((d) => ((maze.cells[ghost.pos] ?? 0) & BIT[d]) !== 0).map((d) =>
    step(ghost.pos, d, maze.size)!,
  );
  const forward = options.filter((c) => c !== ghost.prev);
  return rng.pick(forward.length > 0 ? forward : options);
}

/** A seeded tile far from every hunter, for a respawn or a teleport. */
export function farTile(maze: Maze, hunters: readonly number[], rng: Rng): number {
  const maps = hunters.map((h) => distancesFrom(maze, h));
  const far = maze.cells
    .map((_, cell) => cell)
    .filter((cell) => maps.every((d) => (d[cell] ?? 0) >= FAR));
  return rng.pick(far.length > 0 ? far : maze.cells.map((_, cell) => cell));
}

export { OPPOSITE, type Dir };
