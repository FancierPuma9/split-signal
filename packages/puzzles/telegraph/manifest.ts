import type { PuzzleManifest } from '@split-signal/shared';

export const manifest: PuzzleManifest = {
  id: 'telegraph',
  name: 'Telegraph',
  description:
    'You both see the same odd-shaped board. The Sender sees which cells to fill; the Receiver ' +
    "fills them. The Sender's only channel is one button: a tone lasts as long as it's held.",
  teams: { min: 1, max: 3 },
  // Three players: one Sender, two Receivers with half the board each.
  playersPerTeam: { min: 2, max: 3 },
  winCondition: 'race',
  goal: 'Fastest exact match wins; each wrong submit adds 8s',
  timeLimitSeconds: 180,
  // Wrong submits add time, so a later clean solve can still win.
  raceGraceMs: 30_000,
  comms: { type: 'signals', signals: ['down', 'up'], cooldownMs: 0, buttons: 'puzzle' },
  commsLabel: 'One button: the Sender holds it, the Receiver hears a tone',
};
