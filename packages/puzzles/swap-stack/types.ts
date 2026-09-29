import type { Material, Piece } from './tower';

export interface State {
  sorter: string;
  builders: string[];
  /** Each Builder's columns, bottom piece first. */
  columns: Piece[][][];
  /** Pieces still to come; the first two are the queue the Sorter can swap. */
  remaining: Piece[];
  placed: number;
  total: number;
  phase: 'sort' | 'build';
  phaseEndsAt: number;
  /** The Sorter's last decision, for the Builder's "swapped!" cue. */
  lastSort: { piece: number; swapped: boolean } | null;
  lastFall: { builder: number; column: number; count: number; piece: number } | null;
  done: boolean;
}

/** A piece as the Builder sees it: just wood. */
export interface PlainPiece {
  id: number;
}

/** A piece as the Sorter sees it. */
export interface TruePiece {
  id: number;
  material: Material;
  load: number;
  strength: number;
}

interface Common {
  phase: 'sort' | 'build';
  phaseEndsAt: number;
  placed: number;
  total: number;
  /** Which Builder places the next piece. */
  activeBuilder: number;
  lastSort: { piece: number; swapped: boolean } | null;
  lastFall: { builder: number; column: number; count: number; piece: number } | null;
  done: boolean;
}

export interface BuilderView extends Common {
  role: 'builder';
  /** Which Builder you are (0 or 1). */
  me: number;
  columns: PlainPiece[][][];
  queue: PlainPiece[];
}

export interface SorterView extends Common {
  role: 'sorter';
  columns: TruePiece[][][];
  queue: Array<{ id: number; material: Material }>;
}

export type View = BuilderView | SorterView;

export type Action = { type: 'swap' } | { type: 'keep' } | { type: 'place'; column: number };
