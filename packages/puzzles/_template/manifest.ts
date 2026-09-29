import type { PuzzleManifest } from '@split-signal/shared';

export const manifest: PuzzleManifest = {
  // Must match your folder name.
  id: 'my-puzzle',
  name: 'Guess the Number',
  description: 'One player knows a number from 1 to 20. Everyone else has to guess it.',
  teams: { min: 1, max: 3 },
  playersPerTeam: { min: 2, max: 4 },
  winCondition: 'compare',
  timeLimitSeconds: 90,
  comms: { type: 'voice', scope: 'team' },
};
