import type { PuzzleManifest } from '@split-signal/shared';

export const manifest: PuzzleManifest = {
  id: 'patchwork',
  name: 'Patchwork',
  description:
    'A spoken sentence is chopped up and split between you: each of you hears only your pieces, ' +
    'with noise over the rest. Talk it through and type the sentence together.',
  teams: { min: 1, max: 3 },
  playersPerTeam: { min: 2, max: 2 },
  winCondition: 'compare',
  goal: 'Closest sentence wins (ties: first to submit)',
  timeLimitSeconds: 90,
  pointsUnit: '% right',
  comms: { type: 'voice', scope: 'team' },
};
