import type { PuzzleManifest } from '@split-signal/shared';

export const manifest: PuzzleManifest = {
  id: 'yappin-maze',
  name: 'YappinMaze',
  description:
    "You each walk your own maze, seeing only a little of it, while you watch your partner's with " +
    'its way out drawn in. Talk each other through. The game keeps what you say, and uses it later.',
  teams: { min: 1, max: 3 },
  playersPerTeam: { min: 2, max: 2 },
  winCondition: 'race',
  goal: 'First team with both players out wins',
  timeLimitSeconds: 240,
  comms: {
    type: 'voice-replay',
    scope: 'team',
    vad: { thresholdDb: -40, minUtteranceMs: 250, silenceMs: 400 },
    bufferSeconds: 60,
  },
};
