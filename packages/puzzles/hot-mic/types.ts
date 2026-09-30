export type HazardKind = 'hurdle' | 'beam' | 'pitLeft' | 'pitRight';
export type Move = 'jump' | 'duck' | 'stepLeft' | 'stepRight';

export interface Hazard {
  at: number;
  kind: HazardKind;
}

export interface Runner {
  lane: Hazard[];
  pos: number;
  /** Last 'run' input (round time); running while it's recent. */
  lastRunAt: number | null;
  /** Whether the runner is moving, as of the last tick (drives the mic). */
  moving: boolean;
  lastMove: { move: Move; at: number } | null;
  stunnedUntil: number | null;
  /** Hazards already passed (cleared or hit), by position. */
  passed: number[];
  hits: number;
  finishedAt: number | null;
}

export interface State {
  runners: Record<string, Runner>;
  /** Whose lane each player watches (the next seat round). */
  watches: Record<string, string>;
}

export type Action = { type: 'run' } | { type: 'stop' } | { type: Move };

export interface LaneView {
  pos: number;
  moving: boolean;
  /** Round time the stun wears off, if stunned. */
  stunnedUntil: number | null;
  finished: boolean;
  hits: number;
}

export interface View {
  length: number;
  me: LaneView;
  /** The lane you watch: its runner, and the hazards just ahead of them. */
  watched: LaneView & { name: string; hazards: Hazard[] };
  /** How many of the team have crossed the line. */
  finished: number;
  total: number;
  /** Reveal only: your own lane's hazards. */
  myHazards?: Hazard[];
}
