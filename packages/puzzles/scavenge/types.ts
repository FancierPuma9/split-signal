import type { Look } from '../lib/composite';

export interface Part {
  id: string;
  look: Look;
}

export type Outcome = 'got' | 'contested' | 'pass';

export interface Resolution {
  at: number;
  /** What each team's grab came to (part null: they passed). */
  results: Record<string, { part: string | null; outcome: Outcome }>;
}

export interface State {
  parts: Part[];
  /** Part ids still in the bin. */
  bin: string[];
  /** Each team's schematic: the 8 exact parts it needs. */
  required: Record<string, string[]>;
  trays: Record<string, string[]>;
  grabsLeft: Record<string, number>;
  roles: Record<string, 'reader' | 'grabber'>;
  teamOf: Record<string, string>;
  /** Each team's Grabber's current choice, private until the tick. */
  hover: Record<string, { part: string | null; committed: boolean }>;
  nextTickAt: number;
  last: Resolution | null;
  solvedAt: Record<string, number>;
}

export type Action = { type: 'hover'; partId: string | null } | { type: 'commit' };

interface Common {
  myTeam: string;
  teamNames: Record<string, string>;
  tray: Part[];
  /** Every team's tray (public), by team. */
  trays: Record<string, Part[]>;
  grabsLeft: Record<string, number>;
  nextTickAt: number;
  last: Resolution | null;
  /** Parts by id, for reading trays and resolutions. */
  catalog: Record<string, Part>;
}

export interface ReaderView extends Common {
  role: 'reader';
  schematic: Part[];
}

export interface GrabberView extends Common {
  role: 'grabber';
  bin: Part[];
  hover: { part: string | null; committed: boolean };
}

export interface RevealView extends Common {
  role: 'reveal';
  schematics: Record<string, Part[]>;
}

export type View = ReaderView | GrabberView | RevealView;
