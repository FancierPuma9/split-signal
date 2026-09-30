import type { Look } from '../lib/composite';

/** Whose card it is: a team's own, on every team's list, or nobody's. */
export type Owner = { team: string } | 'contested' | 'neutral';

export interface Card {
  id: string;
  look: Look;
  owner: Owner;
}

export type ClaimResult = 'own' | 'contested' | 'neutral' | 'stolen';

export interface Claim {
  card: string;
  /** The team whose Grabber took it. */
  by: string;
  result: ClaimResult;
  /** A stolen card scores for its owner. */
  creditedTo: string | null;
  at: number;
}

export interface State {
  cards: Card[];
  roles: Record<string, 'caller' | 'grabber'>;
  teamOf: Record<string, string>;
  claims: Claim[];
  scores: Record<string, number>;
  /** When each team last scored, for breaking ties. */
  lastScoreAt: Record<string, number>;
  lastGrabAt: Record<string, number>;
}

export type Action = { type: 'grab'; cardId: string };

/** How a card looks to the Caller: whose it is, from their team's point of view. */
export type KeyMark = 'mine' | 'contested' | 'neutral' | { team: string };

export interface View {
  role: 'caller' | 'grabber' | 'reveal';
  myTeam: string;
  /** Every team's display name, by id. */
  teamNames: Record<string, string>;
  cards: Array<{ id: string; look: Look; key?: KeyMark }>;
  claims: Claim[];
  scores: Record<string, number>;
  /** Grabbers: when they may grab again (round time). */
  cooldownUntil: number | null;
}
