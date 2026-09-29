import type { PuzzleManifest } from '@split-signal/shared';

export const manifest: PuzzleManifest = {
  id: 'padlock',
  name: 'Padlock',
  description:
    'A combination lock where each of you turns your own dials. After each turn you hear one ' +
    'sound: a chime if any dial just turned landed on its number. Work out which.',
  teams: { min: 1, max: 3 },
  // Two dials per player: 2 players get 4 dials, 3 players get 6.
  playersPerTeam: { min: 2, max: 3 },
  winCondition: 'compare',
  timeLimitSeconds: 300,
  comms: { type: 'voice', scope: 'team' },
};
