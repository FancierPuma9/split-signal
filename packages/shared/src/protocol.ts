import type { AccountStats, AccountUser } from './account';
import { normalizeRoomCode, type LobbySettings, type RoomView } from './lobby';
import type { MatchView } from './match';
import type { CommsState, DrawBatch, ReplayRequest } from './puzzle';

/**
 * WebSocket protocol. Every message is JSON with a dotted `type`:
 *   room.*   create / join / rejoin / leave
 *   lobby.*  settings, seats, lock teams, start
 *   match.*  match state, per-player views, actions, surrender, play again
 *   comms.*  discrete signals, voice topology and WebRTC signaling, clips (phase 6)
 *   auth.*, results.*, stats.*  optional Google sign-in and stats (phase 7)
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
  /**
   * A discrete signal: to teammates, or to one player with `to` (shared instances). The server
   * drops anything the puzzle doesn't allow.
   */
  | { type: 'comms.signal'; signal: string; to?: string }
  /** WebRTC signaling for a voice connection to `to`. Dropped unless `to` is a current peer. */
  | { type: 'comms.rtc'; to: string; data: RtcPayload }
  /** A recorded clip (base64 audio), for puzzles with a clip comms rule. */
  | { type: 'comms.clip'; mime: string; data: string; durationMs: number }
  /** Pen samples for the draw rule, sent about every 50 ms while drawing. */
  | ({ type: 'comms.draw' } & DrawBatch)
  /** Sign in with a Google ID token (from Google's sign-in button). */
  | { type: 'auth.google'; credential: string }
  /** Sign back in on a new connection with a session token from auth.session. */
  | { type: 'auth.resume'; token: string }
  | { type: 'auth.signOut' }
  /** Permanently delete the signed-in account, its sessions and its stats. */
  | { type: 'account.delete' }
  /** Save a finished match's results (from results.unsaved) to the signed-in account. */
  | { type: 'results.claim'; claimToken: string }
  | { type: 'stats.get' };

export type ServerMessage =
  /** Sent on connecting. googleClientId is null when sign-in isn't set up on this server. */
  | { type: 'server.hello'; googleClientId: string | null }
  /** Signed in. Keep the token to sign back in on reconnect (auth.resume). */
  | { type: 'auth.session'; token: string; user: AccountUser }
  | { type: 'auth.signedOut'; reason?: string }
  /** Your results from the match that just ended were saved to your account. */
  | { type: 'results.saved' }
  /** You played as a guest: sign in within expiresInMs and claim them with this token. */
  | { type: 'results.unsaved'; claimToken: string; expiresInMs: number }
  | { type: 'stats'; stats: AccountStats }
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
  /** After a round ends: the puzzle's reveal() view for you, shown under the scoreboard. */
  | { type: 'match.reveal'; round: number; view: unknown }
  /** A file the puzzle built for you this round (e.g. audio), sent once per id. data is base64. */
  | { type: 'match.asset'; round: number; id: string; mime: string; data: string }
  | { type: 'match.reject'; reason: string }
  /** A signal from a teammate (or an echo of your own, so the UI can confirm it went out). */
  | { type: 'comms.signal'; from: string; signal: string }
  /** Sent on joining: how to reach peers through NATs. */
  | { type: 'comms.config'; iceServers: IceServerConfig[] }
  /**
   * The exact set of players you should have voice connections with right now. Open connections
   * to new peers, close any not listed. A changed epoch means that peer reconnected: start over.
   * send/hear (default true) switch your mic to that peer and their audio on or off without
   * reconnecting, for one-way-at-a-time voice.
   */
  | { type: 'comms.peers'; peers: VoicePeer[] }
  | { type: 'comms.rtc'; from: string; data: RtcPayload }
  /** A clip for you, with parameters the puzzle's client applies (e.g. distortion). */
  | { type: 'comms.clip'; id: number; from: string; mime: string; data: string; params: unknown }
  /** A teammate's pen samples, under the draw rule. */
  | { type: 'comms.draw'; from: string; batch: DrawBatch }
  /** Engine-managed comms state for you this round (who is live, budgets, clips in flight). */
  | { type: 'comms.state'; state: CommsState }
  /**
   * voice-replay: play back something a teammate said inside this window of round time, from your
   * own buffer of their voice. Answer with a __replayMissed action if nothing fits.
   */
  | ({ type: 'comms.replay' } & ReplayRequest)
  | { type: 'error'; message: string };

export interface VoicePeer {
  id: string;
  epoch: number;
  send?: boolean;
  hear?: boolean;
  /** Volume (0-1) to play this peer at, when the puzzle shapes it (e.g. by distance). */
  gain?: number;
}

/** Default minimum gap between one player's signals when the puzzle doesn't set cooldownMs. */
export const DEFAULT_SIGNAL_COOLDOWN_MS = 750;
/** Minimum gap between one player's clips. */
export const CLIP_COOLDOWN_MS = 2000;
/** Largest clip accepted, as base64 characters (roughly 190 KB of audio). */
export const MAX_CLIP_BASE64 = 256_000;
/** Draw stream limits: points per batch and batches per second per player. */
export const MAX_DRAW_POINTS = 64;
export const MAX_DRAW_BATCHES_PER_SECOND = 25;

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
const isToken = (v: unknown): v is string =>
  typeof v === 'string' && v.length >= 16 && v.length <= 128 && /^[\w-]+$/.test(v);

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
    case 'comms.signal': {
      if (typeof data.signal !== 'string' || data.signal.length === 0 || data.signal.length > 32) {
        return null;
      }
      if (data.to === undefined) return { type: 'comms.signal', signal: data.signal };
      return typeof data.to === 'string' && data.to.length > 0 && data.to.length <= 64
        ? { type: 'comms.signal', signal: data.signal, to: data.to }
        : null;
    }
    case 'comms.draw': {
      const { strokeId, points, done } = data;
      if (typeof strokeId !== 'string' || strokeId.length === 0 || strokeId.length > 32)
        return null;
      if (typeof done !== 'boolean' || !Array.isArray(points)) return null;
      if (points.length > MAX_DRAW_POINTS) return null;
      const clean: DrawBatch['points'] = [];
      for (const p of points) {
        if (!isRecord(p)) return null;
        const { x, y, dt } = p;
        if (typeof x !== 'number' || typeof y !== 'number' || typeof dt !== 'number') return null;
        if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1 && dt >= 0 && dt <= 1000)) return null;
        clean.push({ x, y, dt });
      }
      return { type: 'comms.draw', strokeId, points: clean, done };
    }
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
    case 'auth.google': {
      const credential = data.credential;
      // Google ID tokens are a few kilobytes of base64url JWT.
      const jwt = /^[\w-]+\.[\w-]+\.[\w-]+$/;
      return typeof credential === 'string' && credential.length <= 8192 && jwt.test(credential)
        ? { type: 'auth.google', credential }
        : null;
    }
    case 'auth.resume':
      return isToken(data.token) ? { type: 'auth.resume', token: data.token } : null;
    case 'results.claim':
      return isToken(data.claimToken)
        ? { type: 'results.claim', claimToken: data.claimToken }
        : null;
    case 'auth.signOut':
    case 'account.delete':
    case 'stats.get':
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
