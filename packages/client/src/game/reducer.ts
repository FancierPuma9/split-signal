import type { CommsState, MatchView, RoomView, ServerMessage } from '@split-signal/shared';
import type { ConnectionStatus } from '../net/socket';

export interface Notice {
  id: number;
  text: string;
}

export interface GameState {
  connection: ConnectionStatus;
  /** The room we're in, once the server confirms it. */
  session: { code: string; playerId: string } | null;
  room: RoomView | null;
  match: { view: MatchView; receivedAt: number } | null;
  /** This player's puzzle view for the current round. */
  puzzleView: { round: number; value: unknown } | null;
  /** Signals received this round (including echoes of our own), oldest first. */
  signals: Array<{ from: string; signal: string; at: number }>;
  /** Clips delivered to us this round, oldest first. */
  clips: Array<{
    id: number;
    from: string;
    mime: string;
    data: string;
    params: unknown;
    at: number;
  }>;
  /** Engine-managed comms state for this round (who is live, budgets, clips in flight). */
  comms: CommsState & { receivedAt: number };
  notice: Notice | null;
}

const MAX_SIGNALS = 20;
const MAX_CLIPS = 8;
const NO_COMMS = { receivedAt: 0 };

export const initialGameState: GameState = {
  connection: 'closed',
  session: null,
  room: null,
  match: null,
  puzzleView: null,
  signals: [],
  clips: [],
  comms: NO_COMMS,
  notice: null,
};

export type GameEvent =
  | { type: 'server'; message: ServerMessage; at: number }
  | { type: 'connection'; status: ConnectionStatus }
  | { type: 'notice'; text: string; at: number }
  | { type: 'dismissNotice'; id: number };

export function gameReducer(state: GameState, event: GameEvent): GameState {
  switch (event.type) {
    case 'connection':
      return { ...state, connection: event.status };
    case 'notice':
      return { ...state, notice: { id: event.at, text: event.text } };
    case 'dismissNotice':
      return state.notice?.id === event.id ? { ...state, notice: null } : state;
    case 'server':
      return onServerMessage(state, event.message, event.at);
  }
}

function onServerMessage(state: GameState, message: ServerMessage, at: number): GameState {
  switch (message.type) {
    case 'room.joined':
      return { ...state, session: { code: message.code, playerId: message.playerId } };
    case 'room.state': {
      const inLobby = message.room.status === 'lobby';
      return {
        ...state,
        room: message.room,
        ...(inLobby ? { match: null, puzzleView: null } : {}),
      };
    }
    case 'room.closed':
      return {
        ...state,
        session: null,
        room: null,
        match: null,
        puzzleView: null,
        notice: { id: at, text: message.reason },
      };
    case 'room.rejoinFailed':
      return { ...state, notice: { id: at, text: message.reason } };
    case 'match.state': {
      const stillPlaying =
        state.match?.view.round === message.match.round && message.match.phase === 'playing';
      const sameRound = stillPlaying && state.puzzleView?.round === message.match.round;
      return {
        ...state,
        match: { view: message.match, receivedAt: at },
        puzzleView: sameRound ? state.puzzleView : null,
        signals: stillPlaying ? state.signals : [],
        clips: stillPlaying ? state.clips : [],
        comms: stillPlaying ? state.comms : NO_COMMS,
      };
    }
    case 'comms.state':
      return { ...state, comms: { ...message.state, receivedAt: at } };
    case 'comms.clip': {
      const { id, from, mime, data, params } = message;
      return {
        ...state,
        clips: [...state.clips.slice(-(MAX_CLIPS - 1)), { id, from, mime, data, params, at }],
      };
    }
    case 'comms.signal':
      return {
        ...state,
        signals: [
          ...state.signals.slice(-(MAX_SIGNALS - 1)),
          { from: message.from, signal: message.signal, at },
        ],
      };
    case 'match.view':
      return state.match
        ? { ...state, puzzleView: { round: state.match.view.round, value: message.view } }
        : state;
    case 'match.reject':
      return { ...state, notice: { id: at, text: message.reason } };
    // Voice messages go straight to the VoiceManager, draw batches to their subscribers.
    case 'comms.config':
    case 'comms.peers':
    case 'comms.rtc':
    case 'comms.draw':
      return state;
    case 'error':
      return { ...state, notice: { id: at, text: message.message } };
  }
}
