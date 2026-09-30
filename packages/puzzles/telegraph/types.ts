export interface State {
  size: number;
  /** Cells on the board (index = row * size + col), sorted. */
  region: number[];
  /** The Sender's pattern: the cells to fill. */
  target: number[];
  sender: string;
  /** Receivers and the cells each may fill (with two, the board is split down the middle). */
  owners: Record<string, number[]>;
  filled: number[];
  /** The Receivers' last wrong submission, which the Sender gets to see. */
  lastSubmit: { cells: number[]; at: number } | null;
  wrongSubmits: number;
  lockedUntil: number | null;
  solvedAt: number | null;
}

export type Action = { type: 'toggle'; cell: number } | { type: 'submit' };

interface Board {
  size: number;
  region: number[];
}

export interface SenderView extends Board {
  role: 'sender';
  target: number[];
  /** Which Receiver owns which cells (three players). */
  halves: number[][] | null;
  /** Their last wrong submission, with the cells that were wrong. */
  lastSubmit: { cells: number[]; wrong: number[] } | null;
  wrongSubmits: number;
  lockedUntil: number | null;
  solved: boolean;
}

export interface ReceiverView extends Board {
  role: 'receiver';
  /** Cells this Receiver may fill. */
  mine: number[];
  filled: number[];
  wrongSubmits: number;
  lockedUntil: number | null;
  solved: boolean;
}

export interface RevealView extends Board {
  role: 'reveal';
  target: number[];
  filled: number[];
  wrongSubmits: number;
}

export type View = SenderView | ReceiverView | RevealView;
