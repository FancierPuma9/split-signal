import type { PuzzleManifest } from '@split-signal/shared';

/** How long ink stays visible. 0 means it never fades (an easy mode worth trying once). */
export const FADE_MS = 1000;

export const manifest: PuzzleManifest = {
  id: 'ghost-ink',
  name: 'Ghost Ink',
  description:
    'One of you sees a scene, the rest have to rebuild it. The only way to explain is ink that ' +
    'fades a second after it is drawn.',
  teams: { min: 1, max: 3 },
  // One Drawer; with three players, two Placers split the palette between them.
  playersPerTeam: { min: 2, max: 3 },
  winCondition: 'compare',
  timeLimitSeconds: 90,
  comms: { type: 'draw', fadeMs: FADE_MS, from: 'role' },
};
