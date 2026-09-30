import type {
  AccountStats,
  AccountUser,
  CommsState,
  MatchView,
  PuzzleAsset,
  RoomView,
  ServerMessage,
} from '@split-signal/shared';
import type { ConnectionStatus } from '../net/socket';

export interface Notice {
  id: number;
  text: string;
}

/** What happened to your results from the match that just finished. */
export type ResultsSave =
  | { status: 'saved' }
  /** expiresAt is a performance.now() time. */
  | { status: 'unsaved'; claimToken: string; expiresAt: number };

export interface AccountState {
  /** Null when this server has no Google sign-in. */
  googleClientId: string | null;
  user: AccountUser | null;
  stats: AccountStats | null;
  results: ResultsSave | null;
}

export interface GameState {
  connection: ConnectionStatus;
  /** The room we're in, once the server confirms it. */
  session: { code: string; playerId: string } | null;
  room: RoomView | null;
  match: { view: MatchView; receivedAt: number } | null;
  /** This player's puzzle view for the current round. */
  puzzleView: { round: number; value: unknown } | null;
  /** The puzzle's end-of-round view, shown under the scoreboard. */
  reveal: { round: number; value: unknown } | null;
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
  /** Files the puzzle sent for this round (e.g. audio built for this player), by id. */
  assets: { round: number; files: Record<string, PuzzleAsset> };
  account: AccountState;
  notice: Notice | null;
}

const MAX_SIGNALS = 20;
const MAX_CLIPS = 8;
const NO_COMMS = { receivedAt: 0 };
const NO_ASSETS = { round: -1, files: {} };
const NOT_IN_ROOM = { session: null, room: null, match: null, puzzleView: null, reveal: null };

export const initialGameState: GameState = {
  connection: 'closed',
  session: null,
  room: null,
  match: null,
  puzzleView: null,
  reveal: null,
  signals: [],
  clips: [],
  comms: NO_COMMS,
  assets: NO_ASSETS,
  account: { googleClientId: null, user: null, stats: null, results: null },
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
        ...(inLobby
          ? {
              match: null,
              puzzleView: null,
              reveal: null,
              account: { ...state.account, results: null },
            }
          : {}),
      };
    }
    case 'room.closed':
      return { ...state, ...NOT_IN_ROOM, notice: { id: at, text: message.reason } };
    case 'room.rejoinFailed':
      // Failing to get back into the room on screen (say the server restarted) means it's gone.
      return {
        ...state,
        ...(state.session?.code === message.code ? NOT_IN_ROOM : {}),
        notice: { id: at, text: message.reason },
      };
    case 'match.state': {
      const stillPlaying =
        state.match?.view.round === message.match.round && message.match.phase === 'playing';
      const sameRound = stillPlaying && state.puzzleView?.round === message.match.round;
      const keepReveal =
        message.match.phase === 'scoreboard' && state.reveal?.round === message.match.round;
      return {
        ...state,
        match: { view: message.match, receivedAt: at },
        puzzleView: sameRound ? state.puzzleView : null,
        reveal: keepReveal ? state.reveal : null,
        signals: stillPlaying ? state.signals : [],
        clips: stillPlaying ? state.clips : [],
        comms: stillPlaying ? state.comms : NO_COMMS,
        // Assets can arrive just before the round's first match.state, so keep them by round.
        assets: state.assets.round === message.match.round ? state.assets : NO_ASSETS,
        // Results messages follow the final match.state; a new match clears them.
        account:
          message.match.phase === 'finished' || !state.account.results
            ? state.account
            : { ...state.account, results: null },
      };
    }
    case 'server.hello':
      return { ...state, account: { ...state.account, googleClientId: message.googleClientId } };
    case 'auth.session':
      return { ...state, account: { ...state.account, user: message.user } };
    case 'auth.signedOut':
      return {
        ...state,
        account: { ...state.account, user: null, stats: null },
        ...(message.reason ? { notice: { id: at, text: message.reason } } : {}),
      };
    case 'results.saved':
      return { ...state, account: { ...state.account, results: { status: 'saved' } } };
    case 'results.unsaved':
      return {
        ...state,
        account: {
          ...state.account,
          results: {
            status: 'unsaved',
            claimToken: message.claimToken,
            expiresAt: at + message.expiresInMs,
          },
        },
      };
    case 'stats':
      return { ...state, account: { ...state.account, stats: message.stats } };
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
    case 'match.reveal':
      return { ...state, reveal: { round: message.round, value: message.view } };
    case 'match.asset': {
      const { round, id, mime, data } = message;
      const files = state.assets.round === round ? state.assets.files : {};
      return { ...state, assets: { round, files: { ...files, [id]: { mime, data } } } };
    }
    case 'match.reject':
      return { ...state, notice: { id: at, text: message.reason } };
    // Voice messages go straight to the VoiceManager, draw batches to their subscribers.
    case 'comms.config':
    case 'comms.peers':
    case 'comms.rtc':
    case 'comms.draw':
    case 'comms.replay':
      return state;
    case 'error':
      return { ...state, notice: { id: at, text: message.message } };
  }
}
