import type { PuzzleManifest } from '@split-signal/shared';

export const HINT_MS = 10_000;
export const MOVE_MS = 8000;
export const TURN_CAP = 30;

export const manifest: PuzzleManifest = {
  id: 'bad-advice',
  name: 'Bad Advice',
  description:
    'You can see everyone else’s target but not your own. Every turn, everyone sends everyone ' +
    'else a direction. Your partner wants you home; the others want you lost. Hints arrive ' +
    'anonymous and shuffled, so read the crowd, not the messengers.',
  teams: { min: 2, max: 3 },
  playersPerTeam: { min: 2, max: 2 },
  winCondition: 'race',
  goal: `First team with both players home wins. After ${TURN_CAP} turns, the team closest to home wins.`,
  timeLimitSeconds: (TURN_CAP * (HINT_MS + MOVE_MS)) / 1000 + 30,
  comms: {
    type: 'signals',
    signals: ['up', 'down', 'left', 'right'],
    cooldownMs: 0,
    // Hints go to the puzzle, never straight to anyone: senders must stay anonymous.
    relay: false,
  },
  instance: 'shared',
};
