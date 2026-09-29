/** Engine limits for rooms. The host picks settings within these. */
export const LOBBY_LIMITS = {
  maxPlayers: 12,
  maxTeams: 3,
  maxPlayersPerTeam: 4,
  minRounds: 1,
  maxRounds: 10,
} as const;

export interface LobbySettings {
  teamCount: number;
  maxPlayersPerTeam: number;
  rounds: number;
}

export const DEFAULT_LOBBY_SETTINGS: LobbySettings = {
  teamCount: 2,
  maxPlayersPerTeam: 2,
  rounds: 5,
};

/** Fixed team identities, in order. The room uses the first `teamCount`. */
export const TEAM_PRESETS = [
  { id: 'red', name: 'Red' },
  { id: 'blue', name: 'Blue' },
  { id: 'green', name: 'Green' },
] as const;

/** Consonants only (no accidental words), without Y. */
export const ROOM_CODE_ALPHABET = 'BCDFGHJKLMNPQRSTVWXZ';
export const ROOM_CODE_LENGTH = 4;

/** Uppercases and strips whitespace. Returns null if it can't be a room code. */
export function normalizeRoomCode(input: string): string | null {
  const code = input.replace(/\s+/g, '').toUpperCase();
  if (code.length !== ROOM_CODE_LENGTH) return null;
  for (const ch of code) if (!ROOM_CODE_ALPHABET.includes(ch)) return null;
  return code;
}

export type RoomStatus = 'lobby' | 'in-match' | 'ended';

/** What every player in a room sees about it. Never includes seat tokens. */
export interface RoomView {
  code: string;
  hostId: string;
  status: RoomStatus;
  locked: boolean;
  players: Array<{ id: string; name: string; connected: boolean }>;
  teams: Array<{ id: string; name: string; seats: Array<string | null> }>;
  settings: LobbySettings;
  /** How many catalog puzzles fit the current team setup. */
  eligiblePuzzles: number;
  /** Why the host can't start yet; empty when ready. */
  startBlockers: string[];
}
