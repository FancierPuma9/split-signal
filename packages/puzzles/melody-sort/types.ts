/** Length of one note in playback, including the gap after it. Shared by server and client. */
export const NOTE_MS = 600;

/**
 * The notes: six sound effects from lib/sounds, as unlike each other as possible so the
 * Listener can tell them apart and name them ("the boom, then the honk"). Every melody plays each
 * one once. Indexes into this list are the only thing the server knows about sound.
 */
export const SOUNDS = ['BOOM', 'DING', 'BUZZ', 'CLAP', 'ZAP', 'HONK'] as const;

export interface Tile {
  id: string;
  /** Abstract symbol shown to arrangers, unrelated to the sound. */
  symbol: string;
  /** Index into SOUNDS. Never sent to arrangers. */
  sound: number;
  /** The arranger who can move this tile. */
  owner: string;
}

export interface State {
  tiles: Tile[];
  /** The melody, as tile ids in the right order. */
  answer: string[];
  /** Current arrangement: tile id per slot. */
  slots: string[];
  listener: string;
  targetPlays: number;
  /** The arrangement as last played, for the listener to hear. */
  lastPlay: { id: number; tileIds: string[] } | null;
  plays: number;
  /** Round time before which the arrangement can't be played again. */
  playLockedUntil: number;
  solved: boolean;
}

export type View =
  | {
      role: 'listener';
      /** The target melody as sound indexes, to synthesize on this device only. */
      target: number[];
      /** Bumped each time the target is replayed; play it when this changes. */
      targetPlays: number;
      /** The arranger's latest playback, as sound indexes. */
      playback: { id: number; sounds: number[] } | null;
      solved: boolean;
    }
  | {
      role: 'arranger';
      /** The arrangement, as opaque tiles. No sound information at all. */
      slots: Array<{ id: string; symbol: string; mine: boolean }>;
      plays: number;
      playLockedUntil: number;
      solved: boolean;
    };

export type Action = { type: 'swap'; a: number; b: number } | { type: 'play' } | { type: 'replay' };
