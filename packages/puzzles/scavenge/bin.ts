import type { Rng } from '@split-signal/shared';
import { COLORS, MOTIFS, PATTERNS, SHAPES, type Look } from '../lib/composite';
import type { Part } from './types';

export const CLUSTERS = 8;
export const VARIANTS = 5;
export const NEEDED = 8;
/** Every pair of teams needs exactly this many of the same parts. */
export const SHARED_PER_PAIR = 2;

/**
 * The bin: eight families of look-alike parts (a shape and color each), five variants apiece
 * (differing in pattern and motif), one of each. Describing a part means naming its family and
 * then its variant.
 */
export function generateBin(rng: Rng): Part[] {
  const families = rng
    .shuffle(SHAPES.flatMap((shape) => COLORS.map((color) => ({ shape, color }))))
    .slice(0, CLUSTERS);
  const variants = PATTERNS.flatMap((pattern) => MOTIFS.map((motif) => ({ pattern, motif })));
  return families.flatMap((family, f) =>
    rng
      .shuffle(variants)
      .slice(0, VARIANTS)
      .map((v, i): Part => ({ id: `p${f * VARIANTS + i}`, look: { ...family, ...v } as Look })),
  );
}

/**
 * Each team's eight parts: every pair of teams shares exactly two (known to be contested, and the
 * same amount for everyone), the rest are the team's own. Needs 2 to 4 teams.
 */
export function generateSchematics(
  teamIds: readonly string[],
  parts: readonly Part[],
  rng: Rng,
): Record<string, string[]> {
  const shared = SHARED_PER_PAIR * (teamIds.length - 1);
  if (shared > NEEDED) throw new Error(`Too many teams for ${NEEDED} parts each`);
  const pool = rng.shuffle(parts.map((p) => p.id));
  const take = (n: number) => pool.splice(0, n);
  const required: Record<string, string[]> = Object.fromEntries(teamIds.map((t) => [t, []]));
  for (let i = 0; i < teamIds.length; i++) {
    for (let j = i + 1; j < teamIds.length; j++) {
      const both = take(SHARED_PER_PAIR);
      required[teamIds[i]!]!.push(...both);
      required[teamIds[j]!]!.push(...both);
    }
  }
  for (const team of teamIds) required[team]!.push(...take(NEEDED - shared));
  return Object.fromEntries(Object.entries(required).map(([t, ids]) => [t, rng.shuffle(ids)]));
}
