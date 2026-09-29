import type { PuzzleManifest } from '@split-signal/shared';

export const manifest: PuzzleManifest = {
  id: 'walkie',
  name: 'Walkie',
  description:
    'Two rooms, one each. Every switch in yours works a gate in theirs. Only one of you is live ' +
    'at a time, able to see, move and talk; the other sees black and listens. Control swaps ' +
    'without warning, mid-sentence if it likes.',
  teams: { min: 1, max: 3 },
  playersPerTeam: { min: 2, max: 2 },
  winCondition: 'race',
  goal: 'First team with both players on their exits wins',
  timeLimitSeconds: 240,
  // Unannounced swaps. Adding warningMs: 3000 is the easy mode.
  comms: { type: 'voice-alternating', swapIntervalMs: [15_000, 40_000] },
};
