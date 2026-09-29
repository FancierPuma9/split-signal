export interface Point {
  x: number;
  y: number;
}

export interface State {
  drawer: string;
  /** Each Placer's share of the palette (everything, with one Placer). */
  owners: Record<string, string[]>;
  /** Where each object in the scene belongs. Only these count. */
  target: Record<string, Point>;
  placed: Record<string, Point>;
  /** Placers who have submitted. The team is done when all of them have. */
  ready: string[];
  submittedAt: number | null;
}

/** Shown to everyone once the team has submitted. */
export interface Result {
  target: Record<string, Point>;
  /** 0-1 per scene object; 0 for objects never placed. */
  accuracy: Record<string, number>;
  /** Mean accuracy as a percentage, the number teams are compared on. */
  score: number;
}

interface Common {
  canDraw: boolean;
  placed: Record<string, Point>;
  placers: number;
  ready: number;
  result: Result | null;
}

export interface DrawerView extends Common {
  role: 'drawer';
  target: Record<string, Point>;
}

export interface PlacerView extends Common {
  role: 'placer';
  /** Objects this Placer can place. */
  mine: string[];
  submitted: boolean;
}

export type View = DrawerView | PlacerView;

export type Action =
  | { type: 'place'; objectId: string; x: number; y: number }
  | { type: 'move'; objectId: string; x: number; y: number }
  | { type: 'remove'; objectId: string }
  | { type: 'submit' };
