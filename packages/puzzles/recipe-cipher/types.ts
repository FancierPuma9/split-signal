export type Heat = 'off' | 'low' | 'med' | 'high';

export const HEATS: readonly Heat[] = ['off', 'low', 'med', 'high'];

/** A procedurally drawn glyph: one SVG path plus a few dots, in a 30x30 box. */
export interface Glyph {
  id: string;
  d: string;
  dots: Array<[number, number]>;
}

export interface Item {
  id: string;
  ingredient: string;
  method: string;
}

export type CookStep =
  | { kind: 'heat'; level: Exclude<Heat, 'off'> }
  | { kind: 'add'; ingredient: string; method: string }
  | { kind: 'stir' }
  | { kind: 'plate' };

export interface Roles {
  glyphs: string;
  key: string;
  prep: string;
  cook: string;
}

export interface State {
  glyphs: Glyph[];
  /** The decoding key: which letter each glyph stands for. */
  letterOf: Record<string, string>;
  /** The written recipe: each line is glyph ids, with ' ' between words. */
  lines: string[][];
  /** What the cook actually has to do, in order. */
  steps: CookStep[];
  progress: number;
  heat: Heat;
  pan: Item[];
  tray: Item[];
  pantry: string[];
  nextItem: number;
  prepLockedUntil: number;
  /** Smoke from a wrong step: the stove is unusable until then. */
  stoveLockedUntil: number;
  mistakes: number;
  roles: Roles;
  solved: boolean;
}

export interface StoveView {
  heat: Heat;
  pan: Item[];
  tray: Item[];
  lockedUntil: number;
}

export interface PrepView {
  pantry: Array<{ ingredient: string; methods: string[] }>;
  tray: Item[];
  trayLimit: number;
  lockedUntil: number;
}

export interface View {
  /** Written recipe, as glyph ids. Only the glyph holder gets this. */
  lines: string[][] | null;
  /** Glyph shapes by id, for drawing lines or the key. */
  glyphs: Glyph[];
  /** The decoding key. Only the key holder gets this. */
  key: Array<{ glyph: string; letter: string }> | null;
  stove: StoveView | null;
  prep: PrepView | null;
  progress: number;
  totalSteps: number;
  mistakes: number;
  roles: Array<'glyphs' | 'key' | 'prep' | 'cook'>;
  solved: boolean;
}

export type Action =
  | { type: 'prep'; ingredient: string; method: string }
  | { type: 'discard'; itemId: string }
  | { type: 'heat'; level: Heat }
  | { type: 'add'; itemId: string }
  | { type: 'stir' }
  | { type: 'plate' };
