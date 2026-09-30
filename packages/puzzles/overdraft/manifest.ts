import type { PuzzleManifest } from '@split-signal/shared';

export const SENDS = 12;
export const SEND_SECONDS = 2;

export const manifest: PuzzleManifest = {
  id: 'overdraft',
  name: 'Overdraft',
  description:
    'Pick the right items on your board, but only your teammates know which they are. Every clip ' +
    'goes to both of them, the team has 12 for the whole round, and each is cut off at 2 seconds.',
  teams: { min: 1, max: 3 },
  playersPerTeam: { min: 3, max: 3 },
  winCondition: 'compare',
  goal: 'Most points: +1 per right pick, -1 per miss, -1 per extra pick',
  timeLimitSeconds: 180,
  comms: {
    type: 'budget-clips',
    maxSeconds: SEND_SECONDS,
    budgetSends: SENDS,
    budgetScope: 'team',
  },
};
