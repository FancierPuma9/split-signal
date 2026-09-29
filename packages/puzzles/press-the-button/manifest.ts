import type { PuzzleManifest } from '@split-signal/shared';

export const manifest: PuzzleManifest = {
  id: 'press-the-button',
  name: 'Press the Button',
  description: 'Everyone presses their own button. That is the whole puzzle.',
  teams: { min: 1, max: 3 },
  playersPerTeam: { min: 1, max: 4 },
  winCondition: 'race',
  timeLimitSeconds: 60,
  comms: { type: 'none' },
};
