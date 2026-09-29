import type { Rgb } from './gradient';

export interface State {
  spotter: string;
  locker: string;
  /** Five evenly spaced colours; the sweep runs through them. */
  stops: Rgb[];
  /** Where along the gradient (0..1) the target colour is. */
  target: number;
  /** Round time and gradient position of the lock, once it happens. */
  lock: { at: number; t: number } | null;
}

export interface Result {
  target: number;
  lockT: number | null;
  /** 100 × (1 - distance along the gradient); 0 without a lock. */
  points: number;
}

interface Common {
  stops: Rgb[];
  sweepMs: number;
  sweeps: number;
  lock: { at: number; t: number } | null;
}

export interface LockerView extends Common {
  role: 'locker';
  /** Set once the team has locked. */
  result: Result | null;
}

export interface SpotterView extends Common {
  role: 'spotter';
  target: number;
  result: Result | null;
}

export interface RevealView {
  role: 'reveal';
  stops: Rgb[];
  result: Result;
}

export type View = LockerView | SpotterView | RevealView;

export type Action = { type: 'lock' };
