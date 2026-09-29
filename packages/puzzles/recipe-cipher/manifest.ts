import type { PuzzleManifest } from '@split-signal/shared';

export const manifest: PuzzleManifest = {
  id: 'recipe-cipher',
  name: 'Recipe Cipher',
  description:
    'A recipe written in glyphs nobody can read alone. One of you holds the instructions, the ' +
    'other the key. Decode it by describing symbols, then prep and cook the dish.',
  teams: { min: 1, max: 3 },
  // 2 players: glyphs + prep, key + stove. 3 players: glyphs, key + prep, stove.
  playersPerTeam: { min: 2, max: 3 },
  winCondition: 'race',
  timeLimitSeconds: 420,
  comms: { type: 'voice', scope: 'team' },
};
