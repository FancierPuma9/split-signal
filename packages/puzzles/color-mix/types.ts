import type { Rgb } from './color';

export type Channel = 'r' | 'g' | 'b';

export const CHANNELS: readonly Channel[] = ['r', 'g', 'b'];

export interface State {
  target: Rgb;
  /** Each player's slider settings. Channels they don't control stay 0. */
  sliders: Record<string, Rgb>;
  /** Which channels each player controls. */
  controls: Record<string, Channel[]>;
  /** Top of each slider's range. */
  max: number;
  /** The player who sees the target; everyone else sees the mix. */
  targetViewer: string;
  /** Round time when the mix first came within tolerance, while it stays there. */
  matchSince: number | null;
  solved: boolean;
}

export interface View {
  role: 'target' | 'mix';
  /** The target color for the target viewer, the current mix for everyone else. */
  swatch: Rgb;
  controls: Channel[];
  /** This player's own slider values. */
  sliders: Rgb;
  max: number;
  /** Round time the colors started matching, if they currently do. */
  holdingSince: number | null;
  holdMs: number;
  solved: boolean;
}

export type Action = { type: 'set'; channel: Channel; value: number };
