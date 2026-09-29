import type { AnyPuzzleServerModule } from '@split-signal/shared';
import airtime from './airtime/server';
import badAdvice from './bad-advice/server';
import colorMix from './color-mix/server';
import colorSweep from './color-sweep/server';
import echoClaw from './echo-claw/server';
import elevators from './elevators/server';
import ghostInk from './ghost-ink/server';
import goingOnce from './going-once/server';
import melodySort from './melody-sort/server';
import padlock from './padlock/server';
import pickSix from './pick-six/server';
import pressTheButton from './press-the-button/server';
import pressTogether from './press-together/server';
import radioTune from './radio-tune/server';
import recipeCipher from './recipe-cipher/server';
import slidingGrid from './sliding-grid/server';
import splitHairs from './split-hairs/server';
import splitKeyboard from './split-keyboard/server';
import swapStack from './swap-stack/server';

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
  splitHairs,
  echoClaw,
  colorSweep,
  airtime,
  pickSix,
  badAdvice,
  swapStack,
  goingOnce,
];

/** Development-only puzzles: never picked for real matches, but playable via --puzzle <id>. */
export const devPuzzles: readonly AnyPuzzleServerModule[] = [pressTheButton, pressTogether];

export function findPuzzle(id: string): AnyPuzzleServerModule | undefined {
  return [...puzzles, ...devPuzzles].find((p) => p.manifest.id === id);
}
