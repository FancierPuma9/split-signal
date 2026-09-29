import type { AnyPuzzleServerModule } from '@split-signal/shared';
import colorMix from './color-mix/server';
import elevators from './elevators/server';
import ghostInk from './ghost-ink/server';
import melodySort from './melody-sort/server';
import padlock from './padlock/server';
import pressTheButton from './press-the-button/server';
import pressTogether from './press-together/server';
import radioTune from './radio-tune/server';
import recipeCipher from './recipe-cipher/server';
import slidingGrid from './sliding-grid/server';
import splitKeyboard from './split-keyboard/server';

/**
 * The puzzle catalog that matches pick from. To add a puzzle, import its server module and list it
 * here. Client modules are discovered automatically from each folder's client.tsx (see client.ts).
 */
export const puzzles: readonly AnyPuzzleServerModule[] = [
  slidingGrid,
  padlock,
  colorMix,
  melodySort,
  splitKeyboard,
  elevators,
  recipeCipher,
  radioTune,
  ghostInk,
];

/** Development-only puzzles: never picked for real matches, but playable via --puzzle <id>. */
export const devPuzzles: readonly AnyPuzzleServerModule[] = [pressTheButton, pressTogether];

export function findPuzzle(id: string): AnyPuzzleServerModule | undefined {
  return [...puzzles, ...devPuzzles].find((p) => p.manifest.id === id);
}
