import type { PuzzleManifest } from '@split-signal/shared';

export const manifest: PuzzleManifest = {
  id: 'card-talk',
  name: 'Card Talk',
  description:
    'One board, every team in one voice room, all talking at once. Callers see which cards are ' +
    "their team's, which everyone wants, and which are traps. Grabbers click. Everyone hears you.",
  teams: { min: 2, max: 3 },
  playersPerTeam: { min: 2, max: 2 },
  winCondition: 'compare',
  goal: 'Most points: your cards 5, contested 10, wrong grabs -3',
  timeLimitSeconds: 120,
  instance: 'shared',
  comms: { type: 'voice', scope: 'all' },
};
