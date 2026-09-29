import type { PuzzleManifest } from '@split-signal/shared';

export const manifest: PuzzleManifest = {
  id: 'sliding-grid',
  name: 'Sliding Grid',
  description:
    'You can only see your own tiles. Get every tile onto its target, moving at the same time as ' +
    "teammates whose tiles you can't see. Arrow signals are all you get.",
  // The plan says 2-3 teams; 1 is allowed too so small groups (and solo testing) can play it.
  teams: { min: 1, max: 3 },
  playersPerTeam: { min: 2, max: 4 },
  winCondition: 'compare',
  timeLimitSeconds: 300,
  comms: { type: 'signals', signals: ['up', 'down', 'left', 'right'], cooldownMs: 750 },
};
