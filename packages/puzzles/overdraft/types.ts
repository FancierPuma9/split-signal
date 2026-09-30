import type { Look } from '../lib/composite';

export interface Item {
  id: string;
  look: Look;
}

export interface State {
  /** Each player's board of 8 items. */
  boards: Record<string, Item[]>;
  /** The items that should be picked, across all boards. */
  correct: string[];
  /** Who knows about each correct item (never its owner). */
  holders: Record<string, string>;
  /** How many correct items the team has in total. */
  quota: number;
  picks: Record<string, string[]>;
  /** When each player submitted. */
  submitted: Record<string, number>;
}

export type Action = { type: 'toggle'; itemId: string } | { type: 'submit' };

export interface View {
  board: Item[];
  picked: string[];
  /** Answers this player holds for teammates: whose board, and what it looks like. */
  holding: Array<{ owner: string; look: Look }>;
  submitted: boolean;
  /** Teammates who have submitted (by id). */
  teammatesDone: string[];
  /** Reveal only. */
  result?: {
    correct: string[];
    quota: number;
    points: number;
    tally: { correct: number; missed: number; surplus: number };
    boards: Record<string, Item[]>;
    picks: Record<string, string[]>;
  };
}
