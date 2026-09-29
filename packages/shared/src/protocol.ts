import { normalizeRoomCode, type LobbySettings, type RoomView } from './lobby';
import type { MatchView } from './match';

/**
 * WebSocket protocol. Every message is JSON with a dotted `type`:
 *   room.*   create / join / rejoin / leave
 *   lobby.*  settings, seats, lock teams, start
 *   match.*  match state, per-player views, actions, surrender, play again
 *   comms.*  discrete signals, voice topology and WebRTC signaling, clips (phase 6)
 */

export const WS_PATH = '/ws';
export const MAX_NAME_LENGTH = 24;

/** WebRTC signaling payloads, relayed by the server between permitted peers only. */
export type RtcPayload =
  | { kind: 'offer' | 'answer'; sdp: string }
  | {
      kind: 'ice';
      candidate: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null };
    };

export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export type ClientMessage =
  | { type: 'room.create'; name: string }
  | { type: 'room.join'; code: string; name: string }
  | { type: 'room.rejoin'; code: string; seatToken: string }
  | { type: 'room.leave' }
  | { type: 'lobby.settings'; settings: Partial<LobbySettings> }
  | { type: 'lobby.seat'; teamId: string | null; seat?: number }
  | { type: 'lobby.lock'; locked: boolean }
  | { type: 'lobby.start' }
  | { type: 'match.action'; payload: unknown }
  | { type: 'match.surrender' }
  | { type: 'match.playAgain' }
  | { type: 'match.backToLobby' }
  /** A discrete signal to teammates. The server drops anything the puzzle doesn't allow. */
  | { type: 'comms.signal'; signal: string }
  /** WebRTC signaling for a voice connection to `to`. Dropped unless `to` is a current peer. */
  | { type: 'comms.rtc'; to: string; data: RtcPayload }
  /** A recorded clip (base64 audio), for puzzles with a clips comms rule. */
  | { type: 'comms.clip'; mime: string; data: string; durationMs: number };

export type ServerMessage =
  /** Sent to a player when they enter a room. Store seatToken to rejoin later. */
  | { type: 'room.joined'; code: string; playerId: string; name: string; seatToken: string }
  | { type: 'room.state'; room: RoomView }
  /**
   * You are no longer in this room. 'replaced' means the same seat was claimed from another tab,
   * so the stored seat token is still good.
   */
  | { type: 'room.closed'; cause: 'left' | 'replaced' | 'closed'; reason: string }
  | { type: 'room.rejoinFailed'; code: string; reason: string }
  | { type: 'match.state'; match: MatchView }
  | { type: 'match.view'; view: unknown }
  | { type: 'match.reject'; reason: string }
  /** A signal from a teammate (or an echo of your own, so the UI can confirm it went out). */
  | { type: 'comms.signal'; from: string; signal: string }
  /** Sent on joining: how to reach peers through NATs. */
  | { type: 'comms.config'; iceServers: IceServerConfig[] }
  /**
   * The exact set of players you should have voice connections with right now. Open connections
   * to new peers, close any not listed. A changed epoch means that peer reconnected: start over.
   */
  | { type: 'comms.peers'; peers: Array<{ id: string; epoch: number }> }
  | { type: 'comms.rtc'; from: string; data: RtcPayload }
  /** A clip for you, with parameters the puzzle's client applies (e.g. distortion). */
  | { type: 'comms.clip'; id: number; from: string; mime: string; data: string; params: unknown }
  | { type: 'error'; message: string };

/** Default minimum gap between one player's signals when the puzzle doesn't set cooldownMs. */
export const DEFAULT_SIGNAL_COOLDOWN_MS = 750;
/** Minimum gap between one player's clips. */
export const CLIP_COOLDOWN_MS = 3000;
/** Largest clip accepted, as base64 characters (roughly 190 KB of audio). */
export const MAX_CLIP_BASE64 = 256_000;

type Rec = Record<string, unknown>;

function isRecord(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH).trim();
  return name || null;
}

function parseCode(value: unknown): string | null {
  return typeof value === 'string' ? normalizeRoomCode(value) : null;
}

function parseSettings(value: unknown): Partial<LobbySettings> | null {
  if (!isRecord(value)) return null;
  const out: Partial<LobbySettings> = {};
  for (const key of ['teamCount', 'maxPlayersPerTeam', 'rounds'] as const) {
    if (value[key] === undefined) continue;
    if (!Number.isInteger(value[key])) return null;
    out[key] = value[key] as number;
  }
  return out;
}

const MAX_SDP_LENGTH = 20_000;
const MAX_CANDIDATE_LENGTH = 2_000;

function parseRtcPayload(value: unknown): RtcPayload | null {
  if (!isRecord(value)) return null;
  if (value.kind === 'offer' || value.kind === 'answer') {
    return typeof value.sdp === 'string' && value.sdp.length <= MAX_SDP_LENGTH
      ? { kind: value.kind, sdp: value.sdp }
      : null;
  }
  if (value.kind === 'ice' && isRecord(value.candidate)) {
    const { candidate, sdpMid, sdpMLineIndex } = value.candidate;
    if (typeof candidate !== 'string' || candidate.length > MAX_CANDIDATE_LENGTH) return null;
    if (sdpMid !== undefined && sdpMid !== null && typeof sdpMid !== 'string') return null;
    if (sdpMLineIndex !== undefined && sdpMLineIndex !== null && !Number.isInteger(sdpMLineIndex)) {
      return null;
    }
    return {
      kind: 'ice',
      candidate: {
        candidate,
        sdpMid: (sdpMid as string | null | undefined) ?? null,
        sdpMLineIndex: (sdpMLineIndex as number | null | undefined) ?? null,
      },
    };
  }
  return null;
}

/** Parses and validates an incoming client message. Returns null for anything malformed. */
export function parseClientMessage(raw: string): ClientMessage | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(data)) return null;

  switch (data.type) {
    case 'room.create': {
      const name = parseName(data.name);
      return name ? { type: 'room.create', name } : null;
    }
    case 'room.join': {
      const name = parseName(data.name);
      const code = parseCode(data.code);
      return name && code ? { type: 'room.join', code, name } : null;
    }
    case 'room.rejoin': {
      const code = parseCode(data.code);
      const token = data.seatToken;
      if (!code || typeof token !== 'string' || token.length === 0 || token.length > 64) {
        return null;
      }
      return { type: 'room.rejoin', code, seatToken: token };
    }
    case 'lobby.settings': {
      const settings = parseSettings(data.settings);
      return settings ? { type: 'lobby.settings', settings } : null;
    }
    case 'lobby.seat': {
      const teamId = data.teamId;
      if (teamId !== null && typeof teamId !== 'string') return null;
      if (data.seat !== undefined && !Number.isInteger(data.seat)) return null;
      return data.seat === undefined
        ? { type: 'lobby.seat', teamId }
        : { type: 'lobby.seat', teamId, seat: data.seat as number };
    }
    case 'lobby.lock':
      return typeof data.locked === 'boolean' ? { type: 'lobby.lock', locked: data.locked } : null;
    case 'match.action':
      return 'payload' in data ? { type: 'match.action', payload: data.payload } : null;
    case 'comms.signal':
      return typeof data.signal === 'string' && data.signal.length > 0 && data.signal.length <= 32
        ? { type: 'comms.signal', signal: data.signal }
        : null;
    case 'comms.rtc': {
      const payload = parseRtcPayload(data.data);
      return typeof data.to === 'string' && data.to.length <= 64 && payload
        ? { type: 'comms.rtc', to: data.to, data: payload }
        : null;
    }
    case 'comms.clip': {
      const { mime, data: audio, durationMs } = data;
      if (typeof mime !== 'string' || !/^audio\/[\w.+-]+(;[\w=.,\s-]*)?$/.test(mime)) return null;
      if (typeof audio !== 'string' || audio.length === 0 || audio.length > MAX_CLIP_BASE64) {
        return null;
      }
      if (!/^[A-Za-z0-9+/]+={0,2}$/.test(audio)) return null;
      if (typeof durationMs !== 'number' || !(durationMs > 0)) return null;
      return { type: 'comms.clip', mime, data: audio, durationMs };
    }
    case 'room.leave':
    case 'lobby.start':
    case 'match.surrender':
    case 'match.playAgain':
    case 'match.backToLobby':
      return { type: data.type };
    default:
      return null;
  }
}
