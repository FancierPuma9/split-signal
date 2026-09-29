import type { PuzzleManifest } from '@split-signal/shared';

export const PIECES = 24;
/** The Sorter's time to swap or keep, before each piece. */
export const SORT_MS = 5000;
/** The Builder's time to place it. */
export const BUILD_MS = 8000;

export const manifest: PuzzleManifest = {
  id: 'swap-stack',
  name: 'Swap Stack',
  description:
    'Build the tallest tower. The Builder sees every piece as plain wood; the Sorter sees the ' +
    'real materials and what will break, but can only swap the next two pieces. Whether they ' +
    'swapped is the only message there is.',
  teams: { min: 1, max: 3 },
  // One Sorter; with three players, two Builders take turns on their own sets of columns.
  playersPerTeam: { min: 2, max: 3 },
  winCondition: 'compare',
  goal: 'The tallest surviving column wins (ties go to more pieces standing)',
  timeLimitSeconds: (PIECES * (SORT_MS + BUILD_MS)) / 1000 + 20,
  comms: { type: 'none' },
};
