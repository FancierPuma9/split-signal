import type { Cell, Room, Wire } from './level';

export interface State {
  /** Player ids, in room order. */
  players: [string, string];
  rooms: [Room, Room];
  /** wires[r]: where room r's switches lead (gates in the other room). */
  wires: [Record<string, Wire>, Record<string, Wire>];
  /** Which switches are on, per room. */
  on: [Record<string, boolean>, Record<string, boolean>];
  pos: [Cell, Cell];
  solvedAt: number | null;
}

export interface LiveView {
  role: 'live';
  rows: string[];
  gates: Array<Cell & { id: string; open: boolean }>;
  switches: Array<Cell & { id: string; color: string; symbol: string; on: boolean }>;
  exit: Cell;
  me: Cell;
  solved: boolean;
}

/** Everything the inactive player gets: nothing. */
export interface ListeningView {
  role: 'listening';
}

export type View = LiveView | ListeningView;

export type Action = { type: 'move'; dir: 'n' | 's' | 'e' | 'w' } | { type: 'flip' };
