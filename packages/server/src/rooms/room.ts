import type { LobbySettings, RoomStatus } from '@split-signal/shared';
import type { MatchState } from '../match/match-engine';

export interface RoomPlayer {
  id: string;
  name: string;
  seatToken: string;
  connected: boolean;
  /** When they dropped, for the lobby seat hold. */
  disconnectedAt: number | null;
  userId?: string;
}

export interface RoomTeam {
  id: string;
  name: string;
  /** One entry per seat; null is an empty seat. */
  seats: Array<string | null>;
}

/** A room as plain data, so any RoomStore implementation can hold it. */
export interface Room {
  code: string;
  hostId: string;
  players: RoomPlayer[];
  teams: RoomTeam[];
  settings: LobbySettings;
  locked: boolean;
  status: RoomStatus;
  match?: MatchState;
  createdAt: number;
  /** When the last connected player left; drives garbage collection. */
  emptySince: number | null;
}
