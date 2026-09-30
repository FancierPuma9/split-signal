import type { AnyPuzzleServerModule } from '@split-signal/shared';
import airtime from './airtime/server';
import badAdvice from './bad-advice/server';
import cardTalk from './card-talk/server';
import colorMix from './color-mix/server';
import colorSweep from './color-sweep/server';
import dictionary from './dictionary/server';
import earshot from './earshot/server';
import echoClaw from './echo-claw/server';
import elevators from './elevators/server';
import ghostInk from './ghost-ink/server';
import goingOnce from './going-once/server';
import hotMic from './hot-mic/server';
import melodySort from './melody-sort/server';
import overdraft from './overdraft/server';
import padlock from './padlock/server';
import passItOn from './pass-it-on/server';
import passItOnReversed from './pass-it-on-reversed/server';
import patchwork from './patchwork/server';
import pickSix from './pick-six/server';
import pressTheButton from './press-the-button/server';
import pressTogether from './press-together/server';
import radioTune from './radio-tune/server';
import recipeCipher from './recipe-cipher/server';
import scavenge from './scavenge/server';
import slidingGrid from './sliding-grid/server';
import splitHairs from './split-hairs/server';
import splitKeyboard from './split-keyboard/server';
import swapStack from './swap-stack/server';
import telegraph from './telegraph/server';
import walkie from './walkie/server';
import yappinMaze from './yappin-maze/server';

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
  walkie,
  patchwork,
  passItOn,
  passItOnReversed,
  telegraph,
  dictionary,
  overdraft,
  cardTalk,
  yappinMaze,
  hotMic,
  earshot,
  scavenge,
];

/** Development-only puzzles: never picked for real matches, but playable via --puzzle <id>. */
export const devPuzzles: readonly AnyPuzzleServerModule[] = [pressTheButton, pressTogether];

export function findPuzzle(id: string): AnyPuzzleServerModule | undefined {
  return [...puzzles, ...devPuzzles].find((p) => p.manifest.id === id);
}
