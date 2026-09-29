import type { PuzzleManifest } from '@split-signal/shared';

export const manifest: PuzzleManifest = {
  id: 'color-mix',
  name: 'Color Mix',
  description:
    'One of you sees only the target color; the rest see only the current mix. Everyone has ' +
    'their own sliders, and the mix is all of them combined. Match it and hold it.',
  teams: { min: 1, max: 3 },
  // 2 players each get red, green and blue (0-127, summed); 3 players get one channel each.
  playersPerTeam: { min: 2, max: 3 },
  winCondition: 'race',
  timeLimitSeconds: 180,
  comms: { type: 'voice', scope: 'team' },
};
