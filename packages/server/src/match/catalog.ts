import {
  LOBBY_LIMITS,
  type AnyPuzzleServerModule,
  type PuzzleManifest,
  type PuzzleOption,
  type Rng,
} from '@split-signal/shared';

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

/** "3 teams", "2-3 teams", or "3+ teams" when the range reaches the lobby's limit. */
const span = (range: { min: number; max: number }, noun: string, limit: number) =>
  range.min === range.max
    ? `${range.min} ${noun}`
    : range.max >= limit
      ? `${range.min}+ ${noun}`
      : `${range.min}-${range.max} ${noun}`;

/** Why a puzzle can't be played with these team sizes, or null if it can. */
function misfit(manifest: PuzzleManifest, teamSizes: readonly number[]): string | null {
  if (!fits(teamSizes.length, manifest.teams)) {
    return `needs ${span(manifest.teams, 'teams', LOBBY_LIMITS.maxTeams)}`;
  }
  if (!teamSizes.every((size) => fits(size, manifest.playersPerTeam))) {
    const range = manifest.playersPerTeam;
    return `needs ${span(range, 'players per team', LOBBY_LIMITS.maxPlayersPerTeam)}`;
  }
  return null;
}

/** The whole catalog for the lobby's picker, each marked with whether it fits and why not. */
export function puzzleOptions(
  catalog: readonly AnyPuzzleServerModule[],
  teamSizes: readonly number[],
): PuzzleOption[] {
  return catalog.map(({ manifest }) => {
    const reason = teamSizes.length === 0 ? 'needs teams' : misfit(manifest, teamSizes);
    const base = { id: manifest.id, name: manifest.name, description: manifest.description };
    return reason === null ? { ...base, fits: true } : { ...base, fits: false, reason };
  });
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
