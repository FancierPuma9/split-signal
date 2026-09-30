import type { ClipSlice } from '@split-signal/shared';

export interface State {
  sentenceId: string;
  /** The answer. Never in a view until the reveal. */
  truth: string;
  /** Which slices of the clip each half gets (sample ranges), never sent to anyone. */
  slices: ClipSlice[];
  /** Seeds the masking noise, so every team hears identical halves. */
  noiseSeed: string;
  durationMs: number;
  /** The team's shared guess. */
  text: string;
  /** Where each player's caret is in the text. */
  cursors: Record<string, number>;
  submittedBy: string | null;
  submittedAt: number | null;
}

export type Action =
  | { type: 'edit'; op: 'insert'; index: number; text: string }
  | { type: 'edit'; op: 'delete'; index: number; count: number }
  | { type: 'cursor'; index: number }
  | { type: 'submit' };

/** One word of the answer-vs-guess comparison. */
export type DiffToken =
  | { kind: 'same'; word: string }
  | { kind: 'wrong'; truth: string; guess: string }
  | { kind: 'missing'; truth: string }
  | { kind: 'extra'; guess: string };

export interface View {
  /** The asset holding this player's half of the clip. */
  clip: string;
  durationMs: number;
  text: string;
  maxLength: number;
  /** The partner's caret, if they have one. */
  partnerCursor: number | null;
  partnerName: string | null;
  submitted: boolean;
  /** Reveal only. */
  result?: { truth: string; guess: string; points: number; diff: DiffToken[] };
}
