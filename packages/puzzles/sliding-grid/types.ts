export type Dir = 'up' | 'down' | 'left' | 'right';

export const DIRECTIONS: readonly Dir[] = ['up', 'down', 'left', 'right'];

export interface Cell {
  x: number;
  y: number;
}

export interface Tile {
  id: string;
  owner: string;
  /** A, B, C... unique per owner. */
  label: string;
  pos: Cell;
  target: Cell;
}

export type Plan = { tileId: string; dir: Dir } | 'pass';

export interface State {
  size: number;
  tiles: Tile[];
  /** Turns resolved so far; this is the score (fewest wins). */
  turns: number;
  /** Round time when the current turn opened. */
  turnStartedAt: number;
  /** Each player's choice for the current turn. Hidden from teammates. */
  plans: Record<string, Plan>;
  /** What happened on the last resolved turn. */
  last: { turn: number; moved: string[]; bumped: string[] } | null;
  solved: boolean;
}

export interface TileView {
  id: string;
  label: string;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
}

export interface View {
  size: number;
  /** Only this player's own tiles. Everyone else's are invisible. */
  tiles: TileView[];
  /** Seat color index for this player's tiles. */
  colorIndex: number;
  turns: number;
  turnStartedAt: number;
  turnMs: number;
  myPlan: Plan | null;
  /** How many teammates have locked in a choice this turn. */
  teammatesReady: number;
  teammates: number;
  /** This player's tiles that moved or bumped into something last turn. */
  last: { turn: number; moved: string[]; bumped: string[] } | null;
  solved: boolean;
}

export type Action = { type: 'move'; tileId: string; dir: Dir } | { type: 'pass' };
