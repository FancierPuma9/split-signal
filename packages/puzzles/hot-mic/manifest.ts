import type { PuzzleManifest } from '@split-signal/shared';

export const manifest: PuzzleManifest = {
  id: 'hot-mic',
  name: 'Hot Mic',
  description:
    "Run your lane without seeing its hazards; you see your partner's. Your mic only works while " +
    'you stand still, and you only hear while you stand still. Hitting a hazard costs 5 seconds.',
  teams: { min: 1, max: 3 },
  // Three players run in a ring: each watches the next player's lane.
  playersPerTeam: { min: 2, max: 3 },
  winCondition: 'race',
  goal: 'First team with everyone over the line wins',
  timeLimitSeconds: 180,
  comms: { type: 'voice-gated', scope: 'team', debounceMs: 300 },
  commsLabel: 'Voice, but only while you and your partner both stand still',
};
