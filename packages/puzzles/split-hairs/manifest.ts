import type { PuzzleManifest } from '@split-signal/shared';

/** How long ink stays visible. Persistent ink (0) is a legitimate easy mode. */
export const FADE_MS = 1000;

export const manifest: PuzzleManifest = {
  id: 'split-hairs',
  name: 'Split Hairs',
  description:
    'The Drawer sees a picture, the Guesser sees a list of words that all mean nearly the same ' +
    'thing. Fading ink is the only way to say which one. Wrong guesses lock you out.',
  teams: { min: 1, max: 3 },
  // One Drawer; a third player joins the Guesser and shares their lockouts.
  playersPerTeam: { min: 2, max: 3 },
  winCondition: 'race',
  timeLimitSeconds: 120,
  comms: { type: 'draw', fadeMs: FADE_MS, from: 'role' },
};
