import type { PuzzleManifest } from '@split-signal/shared';

export const manifest: PuzzleManifest = {
  id: 'color-mix',
  name: 'Color Mix',
  description:
    'One of you sees only the target color; the rest see only the current mix. Red, green and ' +
    'blue are split between you, so nobody can mix it alone. Match it and hold it.',
  teams: { min: 1, max: 3 },
  // 2 players: one gets one color, the other two. 3 players: one color each.
  playersPerTeam: { min: 2, max: 3 },
  winCondition: 'race',
  timeLimitSeconds: 180,
  comms: { type: 'voice', scope: 'team' },
};
