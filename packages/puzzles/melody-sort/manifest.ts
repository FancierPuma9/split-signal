import type { PuzzleManifest } from '@split-signal/shared';

export const manifest: PuzzleManifest = {
  id: 'melody-sort',
  name: 'Melody Sort',
  description:
    'The Listener hears six sounds in a secret order. The Arranger sorts them into that order, ' +
    'but can never hear a thing: only the Listener hears the target and every playback.',
  teams: { min: 1, max: 3 },
  // 3 players: two arrangers, each owning half the tiles.
  playersPerTeam: { min: 2, max: 3 },
  winCondition: 'race',
  timeLimitSeconds: 240,
  comms: { type: 'voice', scope: 'team' },
};
