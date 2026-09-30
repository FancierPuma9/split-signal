import type { PuzzleManifest } from '@split-signal/shared';
import { SOUNDS } from './stages';

export const manifest: PuzzleManifest = {
  id: 'dictionary',
  name: 'Dictionary',
  description:
    'The Sender sees the answer but has no mic: only sound buttons (BOOM, DING, CLAP…). The ' +
    'Receiver works the controls and can talk back. Each stage cleared unlocks more sounds.',
  teams: { min: 1, max: 3 },
  playersPerTeam: { min: 2, max: 2 },
  winCondition: 'compare',
  goal: 'Most stages cleared wins (ties: whoever got there first)',
  timeLimitSeconds: 240,
  pointsUnit: ' stages',
  comms: [
    { type: 'signals', signals: [...SOUNDS], cooldownMs: 250, buttons: 'puzzle' },
    { type: 'voice-oneway', scope: 'team' },
  ],
  commsLabel: 'Sender: sound buttons only · Receiver: voice, one way',
};
