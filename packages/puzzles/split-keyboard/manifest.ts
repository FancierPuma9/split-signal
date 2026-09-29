import type { PuzzleManifest } from '@split-signal/shared';

export const manifest: PuzzleManifest = {
  id: 'split-keyboard',
  name: 'Split Keyboard',
  description:
    'Type the phrase together. Each of you owns a scattered handful of keys, and only the owner ' +
    'can press one. No talking: a nudge is all you get.',
  teams: { min: 1, max: 3 },
  playersPerTeam: { min: 2, max: 3 },
  winCondition: 'race',
  timeLimitSeconds: 180,
  comms: { type: 'signals', signals: ['nudge'], cooldownMs: 1000 },
};
