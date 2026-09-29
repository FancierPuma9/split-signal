import type { PuzzleManifest } from '@split-signal/shared';

export const manifest: PuzzleManifest = {
  id: 'elevators',
  name: 'Elevators',
  description:
    'Clear the lobby. Each turn you secretly send an elevator to a floor. No talking at all: ' +
    'watch what your partner does and figure out their plan.',
  teams: { min: 1, max: 3 },
  // One elevator per player.
  playersPerTeam: { min: 2, max: 3 },
  winCondition: 'compare',
  timeLimitSeconds: 240,
  comms: { type: 'none' },
};
