import type { PuzzleManifest } from '@split-signal/shared';

export const manifest: PuzzleManifest = {
  id: 'radio-tune',
  name: 'Radio Tune',
  description:
    'The Sender knows the right settings and can only talk through short recorded clips. The ' +
    'Receiver hears each clip distorted: the closer their panel gets, the clearer it sounds.',
  teams: { min: 1, max: 3 },
  playersPerTeam: { min: 2, max: 2 },
  winCondition: 'race',
  timeLimitSeconds: 300,
  comms: { type: 'clips', maxSeconds: 5, direction: 'one-way', extraSignals: ['repeat'] },
};
