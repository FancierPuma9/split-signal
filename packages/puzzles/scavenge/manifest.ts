import type { PuzzleManifest } from '@split-signal/shared';

export const manifest: PuzzleManifest = {
  id: 'scavenge',
  name: 'Scavenge',
  description:
    'One shared bin of look-alike parts; every team is building something different. Readers see ' +
    'the exact parts; Grabbers see the bin. Every 5 seconds all grabs land at once, and a part two ' +
    'teams grab stays in the bin.',
  // With two teams a scarce bin would decide it by luck; with three, shadowing one team hands it
  // to the third.
  teams: { min: 3, max: 4 },
  playersPerTeam: { min: 2, max: 2 },
  winCondition: 'race',
  goal: 'First team with all 8 parts wins (otherwise: most parts, then grabs left)',
  timeLimitSeconds: 180,
  instance: 'shared',
  pointsUnit: ' parts',
  comms: { type: 'voice', scope: 'team' },
};
