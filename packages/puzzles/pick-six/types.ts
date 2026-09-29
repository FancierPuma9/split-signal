import type { Picks, TurnScore } from './scoring';

export interface Player {
  id: string;
  name: string;
  teamId: string;
}

export interface Team {
  id: string;
  name: string;
}

export interface Turn extends TurnScore {
  picks: Picks;
}

export interface State {
  players: Player[];
  teams: Team[];
  /** 0-based; equals TURNS once the game is over. */
  turn: number;
  phase: 'pick' | 'reveal';
  /** Round time the current phase ends. */
  phaseEndsAt: number;
  /** This turn's picks so far. Secret until the reveal. */
  picks: Record<string, number>;
  history: Turn[];
  totals: Record<string, number>;
  over: boolean;
}

export interface View {
  players: Player[];
  teams: Team[];
  myTeam: string;
  turn: number;
  turns: number;
  phase: 'pick' | 'reveal';
  phaseEndsAt: number;
  myPick: number | null;
  /** Who has picked this turn (not what). */
  picked: string[];
  last: Turn | null;
  totals: Record<string, number>;
  over: boolean;
}

export type Action = { type: 'pick'; n: number };
