import type { Dir, Maze } from '../lib/maze';

export interface Ghost {
  player: string;
  pos: number;
  /** Where it came from, so the drift doesn't turn back unless it must. */
  prev: number | null;
  nextStepAt: number;
  /** Latest mic loudness (dBFS) and when it came. */
  db: number;
  heardAt: number | null;
  /** Audible radius in tiles, smoothed. */
  radius: number;
  mutedUntil: number | null;
}

export interface Hunter {
  player: string;
  pos: number;
  facing: Dir;
  light: boolean;
  battery: number;
  lastStepAt: number | null;
  lastCatchAt: number | null;
}

export interface Catch {
  by: string;
  ghostTeam: string;
  own: boolean;
  at: number;
}

export interface State {
  maze: Maze;
  /** By team. */
  ghosts: Record<string, Ghost>;
  hunters: Record<string, Hunter>;
  teamOf: Record<string, string>;
  scores: Record<string, number>;
  lastScoreAt: Record<string, number>;
  catches: Catch[];
}

export type Action =
  | { type: 'move'; dir: Dir }
  | { type: 'flashlight' }
  | { type: 'catch' }
  | { type: '__micLevel'; db: number };

export interface HunterMark {
  team: string;
  pos: number;
  facing: Dir;
  light: boolean;
}

export interface GhostMark {
  team: string;
  pos: number;
  muted: boolean;
}

interface Common {
  myTeam: string;
  teamNames: Record<string, string>;
  scores: Record<string, number>;
  catches: Catch[];
}

export interface GhostView extends Common {
  role: 'ghost';
  maze: Maze;
  me: { pos: number; radius: number; mutedUntil: number | null };
  ghosts: GhostMark[];
  hunters: HunterMark[];
}

export interface HunterView extends Common {
  role: 'hunter';
  /** Walls near you only (null: can't see). */
  maze: { size: number; cells: Array<number | null> };
  me: { pos: number; facing: Dir; light: boolean; battery: number; catchReadyAt: number };
  hunters: HunterMark[];
  /** Tiles your flashlight lights. */
  lit: number[];
  /** Ghosts in your light, the only ones you ever see. */
  seen: GhostMark[];
}

export interface RevealView extends Common {
  role: 'reveal';
  maze: Maze;
  ghosts: GhostMark[];
  hunters: HunterMark[];
}

export type View = GhostView | HunterView | RevealView;
