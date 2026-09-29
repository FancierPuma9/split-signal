import type { PuzzleManifest } from '@split-signal/shared';

/** Everything either player says arrives this late. */
export const DELAY_MS = 5000;

export const manifest: PuzzleManifest = {
  id: 'echo-claw',
  name: 'Echo Claw',
  description:
    'A claw machine. The Spotter can see the toy, the Operator drives the claw. You can talk, ' +
    'but every word arrives five seconds late, so say where the toy will be, not where it is.',
  teams: { min: 1, max: 3 },
  playersPerTeam: { min: 2, max: 2 },
  winCondition: 'compare',
  goal: 'Most grabs wins (ties go to whoever got their last one first)',
  timeLimitSeconds: 75,
  comms: { type: 'delayed-clips', maxSeconds: 5, delayMs: DELAY_MS },
};
