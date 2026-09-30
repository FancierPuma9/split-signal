import {
  findRule,
  normalizeRoomCode,
  type ClientMessage,
  type DrawBatch,
  type LobbySettings,
  type ServerMessage,
} from '@split-signal/shared';

export type DrawListener = (from: string, batch: DrawBatch, at: number) => void;
import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { GameSocket } from '../net/socket';
import { ClipRecorder, blobToBase64 } from '../voice/clip-recorder';
import { watchMicLevel } from '../voice/mic-level';
import { ReplayBuffer } from '../voice/replay';
import { VoiceManager } from '../voice/voice-manager';
import { gameReducer, initialGameState, type GameState } from './reducer';
import { storage } from './storage';

/** The room code in the URL (/BCDF), if any. */
export function codeFromUrl(): string | null {
  return normalizeRoomCode(location.pathname.replace(/^\/+/, ''));
}

function setUrlCode(code: string | null): void {
  const path = code ? `/${code}` : '/';
  if (location.pathname !== path) history.replaceState(null, '', path);
}

/** Round time elapsed (ms) as the server counts it, from the latest match state. */
function roundElapsed(match: GameState['match']): number {
  if (!match) return 0;
  const { view, receivedAt } = match;
  if (view.phaseTotalMs === null || view.phaseRemainingMs === null) return 0;
  const running = view.phase === 'playing' && !view.paused;
  const remaining = running
    ? view.phaseRemainingMs - (performance.now() - receivedAt)
    : view.phaseRemainingMs;
  return Math.max(0, view.phaseTotalMs - Math.max(0, remaining));
}

/** Connection, game state, and actions for the whole app. */
export function useGame() {
  const [state, dispatch] = useReducer(gameReducer, initialGameState);
  // The room we are in or trying to get back into; survives socket reconnects.
  const target = useRef<string | null>(codeFromUrl());
  // The seat token this tab holds, or last asked to rejoin with.
  const heldToken = useRef<string | null>(null);
  // Owned by the effect rather than the module, so hot reloads and StrictMode's double mount get a
  // fresh socket instead of a stale one.
  const socketRef = useRef<GameSocket | null>(null);
  const [voice] = useState(() => new VoiceManager());
  const voiceState = useSyncExternalStore(voice.subscribe, voice.getSnapshot);
  const [recorder] = useState(() => new ClipRecorder());
  const [recording, setRecording] = useState(false);
  // Draw batches arrive ~20 times a second; they go to subscribers, not through React state.
  const [drawListeners] = useState(() => new Set<DrawListener>());
  // A guest's results waiting to be claimed; sent as soon as they sign in.
  const pendingClaim = useRef<{ token: string; expiresAt: number } | null>(null);
  // voice-replay: what teammates said this round, while such a round runs.
  const replay = useRef<ReplayBuffer | null>(null);
  // The latest match state, for round timing outside React renders.
  const matchRef = useRef<GameState['match']>(null);
  const [micLevel, setMicLevel] = useState<number | null>(null);

  useEffect(() => {
    const socket = new GameSocket();
    socketRef.current = socket;
    voice.setTransport((to, data) => socket.send({ type: 'comms.rtc', to, data }));
    const onMessage = (message: ServerMessage) => {
      switch (message.type) {
        case 'room.joined':
          target.current = message.code;
          heldToken.current = message.seatToken;
          voice.setSelf(message.playerId);
          storage.claimSeat(message.code, { token: message.seatToken, name: message.name });
          setUrlCode(message.code);
          // The mic is requested once, on first join, not per round.
          void voice.requestMic();
          break;
        case 'room.closed':
          if (target.current) {
            // A 'replaced' seat lives on in another tab, which shares the saved token.
            if (message.cause === 'replaced') storage.releaseSeat(target.current);
            else if (heldToken.current) storage.forgetSeat(target.current, heldToken.current);
          }
          target.current = null;
          heldToken.current = null;
          setUrlCode(null);
          voice.setSelf(null);
          voice.closeAll();
          break;
        case 'room.rejoinFailed':
          if (heldToken.current) storage.forgetSeat(message.code, heldToken.current);
          target.current = null;
          heldToken.current = null;
          break;
        case 'comms.config':
          voice.setIceServers(message.iceServers);
          return;
        case 'auth.session': {
          storage.setSessionToken(message.token);
          const claim = pendingClaim.current;
          if (claim && claim.expiresAt > performance.now()) {
            socket.send({ type: 'results.claim', claimToken: claim.token });
          }
          break;
        }
        case 'auth.signedOut':
          storage.setSessionToken(null);
          break;
        case 'results.unsaved':
          pendingClaim.current = {
            token: message.claimToken,
            expiresAt: performance.now() + message.expiresInMs,
          };
          break;
        case 'results.saved':
          pendingClaim.current = null;
          break;
        case 'comms.peers':
          voice.setPeers(message.peers);
          return;
        case 'comms.rtc':
          void voice.handleSignal(message.from, message.data);
          return;
        case 'comms.draw': {
          const at = performance.now();
          for (const listener of drawListeners) listener(message.from, message.batch, at);
          return;
        }
        case 'comms.replay': {
          const { id, from, windowStartMs, windowEndMs } = message;
          const played = replay.current?.replay(
            from,
            windowStartMs,
            windowEndMs,
            voice.volumeOf(from),
          );
          if (!played) {
            socket.send({ type: 'match.action', payload: { type: '__replayMissed', id } });
          }
          return;
        }
      }
      dispatch({ type: 'server', message, at: performance.now() });
    };

    const offMessage = socket.onMessage(onMessage);
    const offStatus = socket.onStatus((status) => {
      dispatch({ type: 'connection', status });
      // A new socket means a new epoch on the server; old voice connections are stale.
      if (status === 'closed') voice.closeAll();
      // Signed in on an earlier connection (or in another tab): sign back in.
      const sessionToken = storage.sessionToken();
      if (status === 'open' && sessionToken)
        socket.send({ type: 'auth.resume', token: sessionToken });
      // The tab holding a seat reclaims it whenever the socket (re)opens: reloads, network drops.
      const code = target.current;
      const token = code && storage.activeToken(code);
      if (status === 'open' && code && token) {
        heldToken.current = token;
        socket.send({ type: 'room.rejoin', code, seatToken: token });
      }
    });
    socket.connect();
    return () => {
      offMessage();
      offStatus();
      socket.close();
      voice.closeAll();
      voice.setTransport(null);
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [voice, drawListeners]);

  useEffect(() => {
    matchRef.current = state.match;
  }, [state.match]);

  const view = state.match?.view;
  const playing = view?.phase === 'playing';
  const comms = view?.puzzle.manifest.comms;
  const reportLevel = playing && comms !== undefined && findRule(comms, 'voice')?.reportLevel;
  const replayRule = playing && comms !== undefined ? findRule(comms, 'voice-replay') : undefined;
  const micOn = voiceState.mic === 'on' || voiceState.mic === 'muted';
  const round = view?.round;

  // voice with reportLevel: tell the puzzle how loud we are, about ten times a second.
  useEffect(() => {
    const mic = reportLevel && micOn ? voice.getMicStream() : null;
    if (!mic) return;
    const stop = watchMicLevel(mic, (db) => {
      setMicLevel(db);
      socketRef.current?.send({ type: 'match.action', payload: { type: '__micLevel', db } });
    });
    return () => {
      stop();
      setMicLevel(null);
    };
  }, [reportLevel, micOn, voice]);

  // voice-replay: buffer what each teammate says, for this round only.
  useEffect(() => {
    if (!replayRule) return;
    const buffer = new ReplayBuffer(replayRule.vad, replayRule.bufferSeconds, () =>
      roundElapsed(matchRef.current),
    );
    replay.current = buffer;
    const off = voice.onRemoteStream((peerId, stream) => {
      if (stream) buffer.attach(peerId, stream);
      else buffer.detach(peerId);
    });
    return () => {
      off();
      buffer.dispose();
      if (replay.current === buffer) replay.current = null;
    };
    // A new round gets a fresh buffer; the rule object itself is stable for the round.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayRule?.type, round, voice]);

  const noticeId = state.notice?.id;
  useEffect(() => {
    if (noticeId === undefined) return;
    const timer = setTimeout(() => dispatch({ type: 'dismissNotice', id: noticeId }), 3500);
    return () => clearTimeout(timer);
  }, [noticeId]);

  const send = useCallback((message: ClientMessage) => {
    const socket = socketRef.current;
    if (socket?.status !== 'open') {
      dispatch({ type: 'notice', text: 'Not connected to the server', at: performance.now() });
      return;
    }
    socket.send(message);
  }, []);

  const actions = useMemo(
    () => ({
      create: (name: string) => {
        storage.setName(name);
        send({ type: 'room.create', name });
      },
      join: (code: string, name: string) => {
        storage.setName(name);
        send({ type: 'room.join', code, name });
      },
      /** Take back a seat saved in this browser (e.g. after closing the tab). */
      rejoin: (code: string, token: string) => {
        heldToken.current = token;
        send({ type: 'room.rejoin', code, seatToken: token });
      },
      leave: () => send({ type: 'room.leave' }),
      settings: (settings: Partial<LobbySettings>) => send({ type: 'lobby.settings', settings }),
      sit: (teamId: string | null, seat?: number) =>
        send(
          seat === undefined
            ? { type: 'lobby.seat', teamId }
            : { type: 'lobby.seat', teamId, seat },
        ),
      lock: (locked: boolean) => send({ type: 'lobby.lock', locked }),
      start: () => send({ type: 'lobby.start' }),
      act: (payload: unknown) => send({ type: 'match.action', payload }),
      signal: (signal: string, to?: string) =>
        send(
          to === undefined
            ? { type: 'comms.signal', signal }
            : { type: 'comms.signal', signal, to },
        ),
      /** Pen samples for the draw rule. Silently dropped if the socket isn't open. */
      draw: (batch: DrawBatch) => socketRef.current?.send({ type: 'comms.draw', ...batch }),
      subscribeDraw: (listener: DrawListener) => {
        drawListeners.add(listener);
        return () => {
          drawListeners.delete(listener);
        };
      },
      /** A credential from Google's sign-in button. */
      signInWithGoogle: (credential: string) => send({ type: 'auth.google', credential }),
      signOut: () => {
        storage.setSessionToken(null);
        send({ type: 'auth.signOut' });
      },
      loadStats: () => send({ type: 'stats.get' }),
      /** Permanently deletes the signed-in account and its stats. */
      deleteAccount: () => send({ type: 'account.delete' }),
      surrender: () => send({ type: 'match.surrender' }),
      playAgain: () => send({ type: 'match.playAgain' }),
      backToLobby: () => send({ type: 'match.backToLobby' }),
      setMuted: (muted: boolean) => voice.setMuted(muted),
      enableMic: () => void voice.requestMic(),
      /** Records a clip (until stopClip or maxSeconds) and uploads it. */
      recordClip: async (maxSeconds: number) => {
        const notice = (text: string) => dispatch({ type: 'notice', text, at: performance.now() });
        const mic = voice.getMicStream();
        if (!mic) {
          notice('Allow microphone access to record clips');
          void voice.requestMic();
          return;
        }
        setRecording(true);
        try {
          const { blob, durationMs } = await recorder.record(mic, maxSeconds * 1000);
          send({
            type: 'comms.clip',
            mime: blob.type,
            data: await blobToBase64(blob),
            durationMs: Math.round(durationMs),
          });
        } catch (error) {
          notice(error instanceof Error ? error.message : 'Recording failed');
        } finally {
          setRecording(false);
        }
      },
      stopClip: () => recorder.stop(),
    }),
    [send, voice, recorder, drawListeners],
  );

  return { state, voice: voiceState, recording, micLevel, actions };
}

export type GameActions = ReturnType<typeof useGame>['actions'];
