import type { PuzzleManifest } from '@split-signal/shared';
import { TOTAL_MS } from './gradient';

export const manifest: PuzzleManifest = {
  id: 'color-sweep',
  name: 'Color Sweep',
  description:
    'A swatch sweeps back and forth through a gradient, five times. The Locker has one press to ' +
    'stop it on a colour only the Spotter can see, and every message takes two to eight seconds ' +
    'to arrive, in no particular order.',
  teams: { min: 1, max: 3 },
  playersPerTeam: { min: 2, max: 2 },
  winCondition: 'compare',
  goal: 'The closest lock wins (ties go to the earlier lock). No lock, no points.',
  timeLimitSeconds: TOTAL_MS / 1000,
  comms: { type: 'delayed-clips', maxSeconds: 5, delayRangeMs: [2000, 8000] },
};
