export type Role = 'seller' | 'bidder' | 'appraiser';

export interface Player {
  id: string;
  name: string;
  teamId: string;
  role: Role;
}

export interface Team {
  id: string;
  name: string;
}

export interface Bid {
  by: string;
  amount: number;
  at: number;
}

export interface Art {
  /** Drives the generated picture on the client. Says nothing about the value. */
  seed: number;
  title: string;
  artist: string;
  year: number;
}

export type Phase = 'waiting' | 'open' | 'sold' | 'unsold';

export interface State {
  players: Player[];
  teams: Team[];
  sellerTeam: string;
  value: number;
  art: Art;
  phase: Phase;
  openBy: number;
  openedAt: number | null;
  bids: Bid[];
  passed: string[];
  goingOnce: boolean;
  closedAt: number | null;
}

export interface Result {
  value: number;
  winner: string | null;
  price: number | null;
  /** Each team's gain this round. */
  gains: Record<string, number>;
}

export interface View {
  me: string;
  role: Role;
  players: Player[];
  teams: Team[];
  sellerTeam: string;
  art: Art;
  phase: Phase;
  openBy: number;
  openedAt: number | null;
  bids: Bid[];
  passed: string[];
  goingOnce: boolean;
  /** Only the Appraisers know, until the hammer falls. */
  value: number | null;
  result: Result | null;
}

export type Action =
  { type: 'open' } | { type: 'hammer' } | { type: 'bid'; raise: number } | { type: 'pass' };
