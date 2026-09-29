import type { Cell, Dir } from './grid';

export interface Player {
  id: string;
  name: string;
  teamId: string;
}

export interface Team {
  id: string;
  name: string;
}

export type Move = Dir | 'stay';

export interface State {
  players: Player[];
  teams: Team[];
  /** One layout shared by every player's board. */
  grid: string[];
  pieces: Record<string, Cell>;
  targets: Record<string, Cell>;
  /** Round time each player reached their target. */
  home: Record<string, number>;
  /** 0-based turn number. */
  turn: number;
  phase: 'hint' | 'move';
  phaseEndsAt: number;
  /** This turn's hints: hints[to][from]. Never shown to anyone as such. */
  hints: Record<string, Record<string, Dir>>;
  /** What each player got this turn, shuffled at the reveal so senders stay anonymous. */
  received: Record<string, Dir[]>;
  /** This turn's moves, secret until they all happen at once. */
  moves: Record<string, Move>;
  teamDoneAt: Record<string, number>;
  over: boolean;
}

export interface Board {
  playerId: string;
  piece: Cell;
  /** Null on your own board: you never see your own target. */
  target: Cell | null;
  home: boolean;
}

export interface View {
  me: string;
  myTeam: string;
  players: Player[];
  teams: Team[];
  grid: string[];
  boards: Board[];
  turn: number;
  turnCap: number;
  phase: 'hint' | 'move';
  phaseEndsAt: number;
  /** The hints you've sent this turn, by recipient. */
  sent: Record<string, Dir>;
  /** Your hints this turn, shuffled; null until the reveal. */
  received: Dir[] | null;
  myMove: Move | null;
  /** Who has moved this turn (not how). */
  moved: string[];
  teamsDone: string[];
  over: boolean;
}

export type Action = { type: 'move'; dir: Move };
