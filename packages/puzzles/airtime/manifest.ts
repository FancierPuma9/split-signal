import type { PuzzleManifest } from '@split-signal/shared';

/** Seconds of push-to-talk each player gets for the whole round. */
export const BUDGET_SECONDS = 30;
/**
 * Whether the Navigator's map shows where the Walker is. Hiding it (so the Walker has to describe
 * their surroundings and the Navigator dead-reckons) is the hard mode worth playtesting.
 */
export const NAVIGATOR_SEES_WALKER = true;

export const manifest: PuzzleManifest = {
  id: 'airtime',
  name: 'Airtime',
  description:
    'The Navigator has the map; the Walker is inside, seeing one step around them. Guide them ' +
    'through the objectives and back out, with thirty seconds of talk each for the whole round.',
  teams: { min: 1, max: 3 },
  playersPerTeam: { min: 2, max: 2 },
  winCondition: 'race',
  goal: 'First team back out wins. If nobody makes it, the most progress wins.',
  timeLimitSeconds: 180,
  comms: { type: 'budget-clips', maxSeconds: 5, budgetSeconds: BUDGET_SECONDS },
};
