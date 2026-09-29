/** Length of one note in playback, including the gap after it. Shared by server and client. */
export const NOTE_MS = 450;

export interface Tile {
  id: string;
  /** Abstract symbol shown to arrangers, unrelated to pitch. */
  symbol: string;
  /** MIDI note number. Never sent to arrangers. */
  pitch: number;
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
      /** Pitches of the target melody, to synthesize on this device only. */
      target: number[];
      /** Bumped each time the target is replayed; play it when this changes. */
      targetPlays: number;
      maxTargetPlays: number;
      /** The arranger's latest playback, as pitches. */
      playback: { id: number; pitches: number[] } | null;
      solved: boolean;
    }
  | {
      role: 'arranger';
      /** The arrangement, as opaque tiles. No pitch information at all. */
      slots: Array<{ id: string; symbol: string; mine: boolean }>;
      plays: number;
      playLockedUntil: number;
      solved: boolean;
    };

export type Action = { type: 'swap'; a: number; b: number } | { type: 'play' } | { type: 'replay' };
