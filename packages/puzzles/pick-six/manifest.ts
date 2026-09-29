import type { PuzzleManifest } from '@split-signal/shared';

export const TURNS = 10;
/** How long everyone has to pick each turn. */
export const PICK_MS = 8000;
/** How long the reveal stays up before the next turn. */
export const REVEAL_MS = 3000;

export const manifest: PuzzleManifest = {
  id: 'pick-six',
  name: 'Pick Six',
  description:
    'Everyone secretly picks 1 to 6. Picks score face value, but the low numbers hunt the high ' +
    'ones: 1 beats 6, 2 beats 5, 3 beats 4. Teammates who pick the same number only score it ' +
    'once. No talking: all you have is what everyone picked last turn.',
  teams: { min: 2, max: 3 },
  playersPerTeam: { min: 2, max: 2 },
  winCondition: 'compare',
  goal: `The highest team total after ${TURNS} turns wins`,
  timeLimitSeconds: Math.ceil((TURNS * (PICK_MS + REVEAL_MS)) / 1000) + 10,
  comms: { type: 'none' },
  instance: 'shared',
};
