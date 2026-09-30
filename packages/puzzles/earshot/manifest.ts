import type { PuzzleManifest } from '@split-signal/shared';

export const manifest: PuzzleManifest = {
  id: 'earshot',
  name: 'Earshot',
  description:
    'Ghosts drift through the maze on their own; all they control is how loud they talk, which ' +
    'sets how far away they can be heard. Hunters see no ghosts, only their flashlight beam: find ' +
    'yours by ear. Enemy hunters hear your ghost too.',
  teams: { min: 2, max: 3 },
  playersPerTeam: { min: 2, max: 2 },
  winCondition: 'compare',
  goal: 'Most points: catch your ghost +5, an enemy ghost +3',
  timeLimitSeconds: 120,
  instance: 'shared',
  comms: { type: 'voice', scope: 'all', reportLevel: true },
  commsLabel: 'Ghosts talk; hunters hear them only when close enough',
};
