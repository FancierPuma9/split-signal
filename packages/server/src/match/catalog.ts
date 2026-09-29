import type { AnyPuzzleServerModule, Rng } from '@split-signal/shared';

const fits = (n: number, range: { min: number; max: number }) => n >= range.min && n <= range.max;

/** Puzzles that support this many teams with these team sizes. */
export function eligiblePuzzles(
  catalog: readonly AnyPuzzleServerModule[],
  teamSizes: readonly number[],
): AnyPuzzleServerModule[] {
  if (teamSizes.length === 0) return [];
  return catalog.filter(
    ({ manifest }) =>
      fits(teamSizes.length, manifest.teams) &&
      teamSizes.every((size) => fits(size, manifest.playersPerTeam)),
  );
}

/**
 * Seeded selection of `rounds` puzzles. Each puzzle appears once before any repeats; if the
 * catalog is smaller than the round count it is reshuffled, avoiding back-to-back repeats.
 */
export function pickPuzzles(
  eligible: readonly AnyPuzzleServerModule[],
  rounds: number,
  rng: Rng,
): AnyPuzzleServerModule[] {
  if (eligible.length === 0) return [];
  const picked: AnyPuzzleServerModule[] = [];
  while (picked.length < rounds) {
    const batch = rng.shuffle(eligible);
    if (batch.length > 1 && batch[0] === picked.at(-1)) {
      [batch[0], batch[1]] = [batch[1] as AnyPuzzleServerModule, batch[0] as AnyPuzzleServerModule];
    }
    picked.push(...batch.slice(0, rounds - picked.length));
  }
  return picked;
}
