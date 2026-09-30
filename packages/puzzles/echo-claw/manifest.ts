import type { PuzzleManifest } from '@split-signal/shared';

export const manifest: PuzzleManifest = {
  id: 'echo-claw',
  name: 'Echo Claw',
  description:
    'A claw machine. The Spotter can see the toy, the Operator drives the claw but can only see ' +
    'the claw. Talk them onto it: call out grid squares like "C4", and where the toy is heading.',
  teams: { min: 1, max: 3 },
  playersPerTeam: { min: 2, max: 2 },
  winCondition: 'compare',
  goal: 'Most grabs wins (ties go to whoever got their last one first)',
  timeLimitSeconds: 75,
  comms: { type: 'voice', scope: 'team' },
};
