import type { Dir, Maze } from './maze';

/** A turn taken at a junction: which way, and when (round time). */
export interface Turn {
  cell: number;
  dir: Dir;
  at: number;
}

export interface Window {
  windowStartMs: number;
  windowEndMs: number;
}

export interface State {
  mazes: Record<string, Maze>;
  pos: Record<string, number>;
  partnerOf: Record<string, string>;
  /** Junctions where arriving triggers a replay, per player. */
  replayCells: Record<string, number[]>;
  /** Replay junctions already used. */
  replayed: Record<string, number[]>;
  turns: Record<string, Turn[]>;
  /** The replay each player's client has been asked for, with fallbacks if it misses. */
  replay: Record<string, ({ id: number; from: string; left: Window[] } & Window) | null>;
  replayCounter: number;
  lastReplayAt: Record<string, number>;
  exitedAt: Record<string, number>;
}

export type Action = { type: 'move'; dir: Dir } | { type: '__replayMissed'; id: number };

/** A maze with the cells you can't see blanked out. */
export interface FoggedMaze {
  size: number;
  cells: Array<number | null>;
  exit: number | null;
}

export interface View {
  me: { maze: FoggedMaze; pos: number; exited: boolean };
  partner: { maze: Maze; pos: number; path: number[]; exited: boolean };
  out: number;
  /** Reveal only: your own maze in full. */
  mine?: { maze: Maze; path: number[] };
}
