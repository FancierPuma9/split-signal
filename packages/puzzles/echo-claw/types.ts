export interface Point {
  x: number;
  y: number;
}

/** The toy's current straight-line run: position at `since`, velocity in machine widths per ms. */
export interface Segment {
  x: number;
  y: number;
  vx: number;
  vy: number;
  since: number;
}

export interface State {
  spotter: string;
  operator: string;
  /** Seeds every bounce nudge and respawn, so each team's toy takes the same path. */
  pathSeed: string;
  toy: Segment;
  /** Where the toy is as of the last tick (for views). */
  toyAt: Point;
  respawns: number;
  bounces: number;
  claw: Point;
  /** The held direction, each -1, 0 or 1. */
  steer: { dx: number; dy: number };
  /** Round time the current drop started; null when the claw is free. */
  dropAt: number | null;
  /** Whether the current drop has closed yet. */
  closed: boolean;
  /** Round time up to which the claw's movement has been applied. */
  movedTo: number;
  /** Round times of successful grabs. */
  grabs: number[];
  lastDrop: { at: number; hit: boolean } | null;
}

interface Common {
  claw: Point;
  /** Drop progress: null when free, else ms since the drop started. */
  dropping: { at: number } | null;
  busyMs: number;
  dropMs: number;
  grabs: number;
  lastDrop: { at: number; hit: boolean } | null;
}

export interface SpotterView extends Common {
  role: 'spotter';
  toy: Point;
}

export interface OperatorView extends Common {
  role: 'operator';
}

export type View = SpotterView | OperatorView;

export type Action = { type: 'move'; dx: number; dy: number } | { type: 'drop' };
