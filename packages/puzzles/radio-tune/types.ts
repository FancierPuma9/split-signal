export const KNOB_MAX = 9;

export interface Panel {
  /** Knob: how narrow the band sounds. */
  band: number;
  /** Knob: how far the pitch drifts (and in which direction). */
  tuning: number;
  /** Switch: static noise when wrong. */
  filter: boolean;
  /** Switch: choppy stutter when wrong. */
  squelch: boolean;
}

export type Knob = 'band' | 'tuning';
export type Switch = 'filter' | 'squelch';

/**
 * How the receiver's client distorts a clip. Each control drives its own layer, so a careful ear
 * can eventually tell them apart. All zero means a clean signal.
 */
export interface Distortion {
  /** 0..1 static noise level. */
  noise: number;
  /** Pitch shift in semitones, signed. */
  pitch: number;
  /** 0..1 how narrow the bandpass is. */
  narrow: number;
  /** 0..1 stutter depth. */
  chop: number;
}

export interface State {
  target: Panel;
  panel: Panel;
  sender: string;
  receiver: string;
  /** Round time the panel started matching, while it stays matched. */
  matchedSince: number | null;
  solved: boolean;
}

export type View =
  | { role: 'sender'; target: Panel; solved: boolean }
  | { role: 'receiver'; panel: Panel; solved: boolean };

export type Action =
  { type: 'knob'; control: Knob; value: number } | { type: 'switch'; control: Switch; on: boolean };
