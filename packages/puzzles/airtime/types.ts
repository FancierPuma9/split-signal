import type { Building, Pos, Room } from './building';

export interface State {
  navigator: string;
  walker: string;
  building: Building;
  pos: Pos;
  /** Objectives finished, in order. */
  done: number;
  lastMoveAt: number;
  solvedAt: number | null;
}

export interface NavigatorView {
  role: 'navigator';
  floors: string[][];
  rooms: Room[];
  objectives: Array<Pos & { label: string; icon: string; done: boolean }>;
  current: number;
  entrance: Pos;
  /** Null in hard mode. */
  walker: Pos | null;
  solved: boolean;
}

export interface WalkerView {
  role: 'walker';
  floor: number;
  floors: number;
  /** The tiles around the Walker, (2r+1) rows of (2r+1) characters, the Walker in the middle. */
  around: string[];
  /** Objectives in sight, relative to the Walker. */
  things: Array<{ dx: number; dy: number; icon: string; current: boolean }>;
  room: string | null;
  objectives: Array<{ label: string; done: boolean }>;
  current: number;
  canInteract: boolean;
  stairs: 'up' | 'down' | null;
  solved: boolean;
}

export type View = NavigatorView | WalkerView;

export type Dir = 'n' | 's' | 'e' | 'w' | 'up' | 'down';

export type Action = { type: 'move'; dir: Dir } | { type: 'interact' };
