import {
  createRng,
  type AnyPuzzleServerModule,
  type ClientMessage,
  type IceServerConfig,
  type ServerMessage,
  type VoicePeer,
} from '@split-signal/shared';
import { voicePeers } from './comms/voice';
import { newId, newSeatToken, newSeed } from './ids';
import { eligiblePuzzles, excludedPuzzles, pickPuzzles } from './match/catalog';
import { MatchEngine, type MatchTimings } from './match/match-engine';
import {
  addPlayer,
  applySettings,
  createRoom,
  moveToSeat,
  removePlayer,
  setLocked,
  startBlockers,
  teamRosters,
  toRoomView,
} from './rooms/lobby';
import type { Room, RoomPlayer } from './rooms/room';
import { generateRoomCode } from './rooms/room-codes';
import { MemoryRoomStore, type RoomStore } from './rooms/room-store';
import type { AccountService, Session } from './stats/accounts';
import { summarizeMatch } from './stats/record';

/** One client's socket, as the game server sees it. */
export interface Connection {
  send(message: ServerMessage): void;
}

export interface GameServerOptions {
  catalog: readonly AnyPuzzleServerModule[];
  store?: RoomStore;
  now?: () => number;
  timings?: Partial<MatchTimings>;
  /** How long a disconnected player's lobby seat is held. */
  lobbySeatHoldMs?: number;
  /** How long a room with nobody connected survives. */
  emptyRoomTtlMs?: number;
  /** STUN/TURN servers handed to clients for voice. */
  iceServers?: IceServerConfig[];
  /** Google sign-in and stats. Without it, everyone plays as a guest. */
  accounts?: AccountService;
  log?: (message: string, error?: unknown) => void;
}

export const DEFAULT_ICE_SERVERS: IceServerConfig[] = [{ urls: 'stun:stun.l.google.com:19302' }];

interface Binding {
  code: string;
  playerId: string;
}

/**
 * Routes client messages to rooms, lobbies, and matches. Owns the mapping between sockets and
 * players; all room data goes through the RoomStore.
 */
export class GameServer {
  private readonly catalog: readonly AnyPuzzleServerModule[];
  private readonly store: RoomStore;
  private readonly now: () => number;
  private readonly timings: Partial<MatchTimings> | undefined;
  private readonly lobbySeatHoldMs: number;
  private readonly emptyRoomTtlMs: number;
  private readonly log: (message: string, error?: unknown) => void;
  private readonly iceServers: IceServerConfig[];
  private readonly bindings = new Map<Connection, Binding>();
  private readonly sockets = new Map<string, Connection>();
  private readonly engines = new Map<string, MatchEngine>();
  /** Bumped each time a player (re)connects, so peers know to rebuild their voice connection. */
  private readonly epochs = new Map<string, number>();
  /** Who each connected player may exchange voice signaling with right now. */
  private readonly voiceAllowed = new Map<string, Set<string>>();
  /** The last comms.peers payload sent to each player, to send only changes. */
  private readonly voiceSent = new Map<string, string>();
  private readonly accounts: AccountService | null;
  /** Who is signed in on each connection. Independent of rooms: sign in anywhere, any time. */
  private readonly sessions = new Map<Connection, Session>();
  /** Connections that have gone, so a sign-in finishing late isn't attached to them. */
  private readonly gone = new WeakSet<Connection>();
  /** Finished matches already written to the stats database. */
  private readonly recorded = new WeakSet<MatchEngine>();
  private lastAccountSweep = 0;

  constructor(options: GameServerOptions) {
    this.catalog = options.catalog;
    this.store = options.store ?? new MemoryRoomStore();
    this.now = options.now ?? Date.now;
    this.timings = options.timings;
    this.lobbySeatHoldMs = options.lobbySeatHoldMs ?? 60_000;
    this.emptyRoomTtlMs = options.emptyRoomTtlMs ?? 10 * 60_000;
    this.iceServers = options.iceServers ?? DEFAULT_ICE_SERVERS;
    this.log = options.log ?? ((message, error) => console.log(message, error ?? ''));
    this.accounts = options.accounts ?? null;
  }

  /** A new socket: tell it what this server offers. */
  connect(conn: Connection): void {
    conn.send({ type: 'server.hello', googleClientId: this.accounts?.googleClientId ?? null });
  }

  handle(conn: Connection, message: ClientMessage): void {
    const error = (text: string) => conn.send({ type: 'error', message: text });
    const binding = this.bindings.get(conn);

    if (
      message.type === 'auth.google' ||
      message.type === 'auth.resume' ||
      message.type === 'auth.signOut' ||
      message.type === 'account.delete' ||
      message.type === 'results.claim' ||
      message.type === 'stats.get'
    ) {
      return this.handleAccount(conn, message);
    }

    if (message.type === 'room.create' || message.type === 'room.join') {
      if (binding) return error('Leave your current room first');
      return message.type === 'room.create'
        ? this.createRoom(conn, message.name)
        : this.joinRoom(conn, message.code, message.name);
    }
    if (message.type === 'room.rejoin') {
      if (binding) this.detach(conn);
      return this.rejoinRoom(conn, message.code, message.seatToken);
    }

    const room = binding && this.store.get(binding.code);
    if (!binding || !room) return error('You are not in a room');
    const { playerId } = binding;
    const isHost = room.hostId === playerId;
    const hostOnly = () => error('Only the host can do that');

    switch (message.type) {
      case 'room.leave':
        return this.leaveRoom(conn, room, playerId);
      case 'lobby.settings':
        if (!isHost) return hostOnly();
        return this.update(room, applySettings(room, message.settings), error);
      case 'lobby.seat':
        return this.update(room, moveToSeat(room, playerId, message.teamId, message.seat), error);
      case 'lobby.lock':
        if (!isHost) return hostOnly();
        return this.update(room, setLocked(room, message.locked), error);
      case 'lobby.start':
        if (!isHost) return hostOnly();
        return this.startMatch(room, error);
      case 'match.action': {
        const engine = this.engines.get(room.code);
        if (!engine) return conn.send({ type: 'match.reject', reason: 'No match in progress' });
        return engine.handleAction(playerId, message.payload);
      }
      case 'comms.signal':
        return this.engines.get(room.code)?.handleSignal(playerId, message.signal, message.to);
      case 'comms.draw': {
        const { strokeId, points, done } = message;
        return this.engines.get(room.code)?.handleDraw(playerId, { strokeId, points, done });
      }
      case 'comms.clip': {
        const engine = this.engines.get(room.code);
        if (!engine) return conn.send({ type: 'match.reject', reason: 'No match in progress' });
        return engine.handleClip(playerId, message);
      }
      case 'comms.rtc':
        // Only relay between players the current comms rule lets talk to each other.
        if (!this.voiceAllowed.get(playerId)?.has(message.to)) return;
        return this.sockets
          .get(message.to)
          ?.send({ type: 'comms.rtc', from: playerId, data: message.data });
      case 'match.surrender': {
        const engine = this.engines.get(room.code);
        if (!engine) return error('No match in progress');
        const problem = engine.surrender();
        if (problem) return error(problem);
        room.status = 'ended';
        return this.update(room, null, error);
      }
      case 'match.playAgain': {
        if (!isHost) return hostOnly();
        const engine = this.engines.get(room.code);
        if (!engine?.finished || engine.state.endedBy !== 'completed') {
          return error('The match is not over');
        }
        room.status = 'lobby';
        room.match = undefined;
        const problems = startBlockers(room, this.eligibleFor(room).length);
        if (problems.length > 0) {
          room.status = 'in-match';
          room.match = engine.state;
          return error(`Can't play again: ${problems.join('. ')}`);
        }
        this.engines.delete(room.code);
        return this.startMatch(room, error);
      }
      case 'match.backToLobby': {
        if (!isHost) return hostOnly();
        const engine = this.engines.get(room.code);
        if (!engine?.finished || room.status !== 'in-match') return error('The match is not over');
        this.engines.delete(room.code);
        room.status = 'lobby';
        room.match = undefined;
        return this.update(room, null, error);
      }
    }
  }

  /** The socket closed. The player keeps their seat so they can rejoin. */
  disconnect(conn: Connection): void {
    this.gone.add(conn);
    this.sessions.delete(conn);
    const binding = this.bindings.get(conn);
    if (!binding) return;
    this.detach(conn);
    const room = this.store.get(binding.code);
    const player = room?.players.find((p) => p.id === binding.playerId);
    if (!room || !player) return;

    player.connected = false;
    player.disconnectedAt = this.now();
    if (!room.players.some((p) => p.connected)) room.emptySince = this.now();
    this.engines.get(room.code)?.playerDisconnected(player.id);
    if (room.status === 'ended' && !room.players.some((p) => p.connected)) {
      return this.closeRoom(room);
    }
    this.save(room);
  }

  /** Advances every running match. Call every TICK_INTERVAL_MS. */
  tick(): void {
    for (const [code, engine] of this.engines) {
      try {
        engine.tick();
      } catch (error) {
        this.log(`[room ${code}] match tick failed`, error);
      }
    }
  }

  /** Frees expired lobby seats and removes abandoned rooms. Call every second or so. */
  sweep(): void {
    const now = this.now();
    if (this.accounts && now - this.lastAccountSweep >= 60_000) {
      this.lastAccountSweep = now;
      this.accounts.sweep();
    }
    for (const room of this.store.list()) {
      if (room.emptySince !== null && now - room.emptySince >= this.emptyRoomTtlMs) {
        this.closeRoom(room);
        continue;
      }
      const inLobby = room.status === 'lobby' || this.engines.get(room.code)?.finished;
      if (!inLobby) continue;
      const expired = room.players.filter(
        (p) =>
          !p.connected &&
          p.disconnectedAt !== null &&
          now - p.disconnectedAt >= this.lobbySeatHoldMs,
      );
      if (expired.length === 0) continue;
      for (const player of expired) removePlayer(room, player.id);
      if (room.players.length === 0) this.closeRoom(room);
      else this.save(room);
    }
  }

  private createRoom(conn: Connection, name: string): void {
    const code = generateRoomCode((c) => this.store.get(c) !== undefined);
    const host = this.newPlayer(name);
    const room = createRoom(code, host, this.now());
    this.log(`[room ${code}] created by ${name}`);
    this.enter(conn, room, host);
  }

  private joinRoom(conn: Connection, code: string, name: string): void {
    const room = this.store.get(code);
    if (!room) return conn.send({ type: 'error', message: `No room with code ${code}` });
    const player = this.newPlayer(name);
    const problem = addPlayer(room, player);
    if (problem) return conn.send({ type: 'error', message: problem });
    this.enter(conn, room, room.players.at(-1) ?? player);
  }

  private rejoinRoom(conn: Connection, code: string, seatToken: string): void {
    const room = this.store.get(code);
    const player = room?.players.find((p) => p.seatToken === seatToken);
    if (!room || !player) {
      return conn.send({
        type: 'room.rejoinFailed',
        code,
        reason: room ? 'Your seat was given up' : 'That room no longer exists',
      });
    }
    const previous = this.sockets.get(player.id);
    if (previous && previous !== conn) {
      this.detach(previous);
      previous.send({
        type: 'room.closed',
        cause: 'replaced',
        reason: 'You joined from another tab',
      });
    }
    player.connected = true;
    player.disconnectedAt = null;
    this.enter(conn, room, player);
    // Re-sends the match state and this player's view, and resumes if nobody else is missing.
    this.engines.get(room.code)?.playerReconnected(player.id);
  }

  private enter(conn: Connection, room: Room, player: RoomPlayer): void {
    this.bindings.set(conn, { code: room.code, playerId: player.id });
    this.sockets.set(player.id, conn);
    this.epochs.set(player.id, (this.epochs.get(player.id) ?? 0) + 1);
    room.emptySince = null;
    conn.send({
      type: 'room.joined',
      code: room.code,
      playerId: player.id,
      name: player.name,
      seatToken: player.seatToken,
    });
    conn.send({ type: 'comms.config', iceServers: this.iceServers });
    this.save(room);
  }

  private leaveRoom(conn: Connection, room: Room, playerId: string): void {
    this.detach(conn);
    conn.send({ type: 'room.closed', cause: 'left', reason: 'You left the room' });
    const engine = this.engines.get(room.code);
    if (engine && !engine.finished && engine.hasPlayer(playerId)) {
      // Leaving mid-match counts as a disconnect: the match waits, and others can surrender.
      const player = room.players.find((p) => p.id === playerId);
      if (player) {
        player.connected = false;
        player.disconnectedAt = this.now();
      }
      engine.playerDisconnected(playerId);
    } else {
      removePlayer(room, playerId);
    }
    if (!room.players.some((p) => p.connected)) {
      if (room.players.length === 0 || room.status === 'ended') return this.closeRoom(room);
      room.emptySince = this.now();
    }
    this.save(room);
  }

  private startMatch(room: Room, error: (text: string) => void): void {
    const eligible = this.eligibleFor(room);
    const problems = startBlockers(room, eligible.length);
    if (problems.length > 0) return error(problems.join('. '));

    const seed = newSeed();
    const puzzles = pickPuzzles(eligible, room.settings.rounds, createRng(seed).fork('puzzles'));
    const names = new Map(room.players.map((p) => [p.id, p.name]));
    const teams = teamRosters(room).map(({ team, playerIds }) => ({
      id: team.id,
      name: team.name,
      players: playerIds.map((id, seat) => ({ id, name: names.get(id) ?? '?', seat })),
    }));

    const startedAt = this.now();
    const engine: MatchEngine = new MatchEngine(
      { seed, puzzles, teams, timings: this.timings, now: this.now },
      {
        send: (playerId, message) => this.sockets.get(playerId)?.send(message),
        onError: (err, context) => this.log(`[room ${room.code}] ${context} threw`, err),
        onStateChange: () => {
          const current = this.store.get(room.code);
          if (current) this.syncVoice(current);
          if (engine.finished) this.recordMatch(room.code, engine, teams, startedAt);
        },
      },
    );
    this.engines.set(room.code, engine);
    room.status = 'in-match';
    room.match = engine.state;
    this.save(room);
    this.log(`[room ${room.code}] match started: ${puzzles.map((p) => p.manifest.id).join(', ')}`);
    engine.start();
  }

  private handleAccount(
    conn: Connection,
    message: Extract<
      ClientMessage,
      {
        type:
          | 'auth.google'
          | 'auth.resume'
          | 'auth.signOut'
          | 'account.delete'
          | 'results.claim'
          | 'stats.get';
      }
    >,
  ): void {
    const error = (text: string) => conn.send({ type: 'error', message: text });
    const accounts = this.accounts;
    if (!accounts) return error("Sign-in isn't set up on this server");
    const session = this.sessions.get(conn);

    switch (message.type) {
      case 'auth.google':
        accounts.signIn(message.credential).then(
          (signedIn) => {
            if (this.gone.has(conn)) return;
            this.sessions.set(conn, signedIn);
            conn.send({ type: 'auth.session', token: signedIn.token, user: signedIn.user });
          },
          (err: unknown) => {
            this.log('Google sign-in failed', err);
            conn.send({ type: 'auth.signedOut', reason: 'Google sign-in failed. Try again.' });
          },
        );
        return;
      case 'auth.resume': {
        const resumed = accounts.resume(message.token);
        if (!resumed) {
          this.sessions.delete(conn);
          return conn.send({
            type: 'auth.signedOut',
            reason: 'Your sign-in expired. Sign in again.',
          });
        }
        this.sessions.set(conn, resumed);
        return conn.send({ type: 'auth.session', token: resumed.token, user: resumed.user });
      }
      case 'auth.signOut':
        if (session) accounts.signOut(session.token);
        this.sessions.delete(conn);
        return conn.send({ type: 'auth.signedOut' });
      case 'account.delete': {
        if (!session) return error('Sign in first');
        accounts.deleteAccount(session.user);
        // Sign the account out everywhere it's open.
        for (const [other, s] of [...this.sessions]) {
          if (s.user.id !== session.user.id) continue;
          this.sessions.delete(other);
          other.send(
            other === conn
              ? { type: 'auth.signedOut', reason: 'Your account and stats were deleted' }
              : { type: 'auth.signedOut' },
          );
        }
        return;
      }
      case 'results.claim':
        if (!session) return error('Sign in first');
        return accounts.claim(message.claimToken, session.user)
          ? conn.send({ type: 'results.saved' })
          : error('Those results can no longer be saved');
      case 'stats.get':
        if (!session) return error('Sign in to see your stats');
        return conn.send({ type: 'stats', stats: accounts.stats(session.user) });
    }
  }

  /**
   * Writes a finished match to the stats database once: signed-in players' results straight
   * away, guests' held for them to claim by signing in.
   */
  private recordMatch(
    code: string,
    engine: MatchEngine,
    teams: ReadonlyArray<{ id: string; players: ReadonlyArray<{ id: string; name: string }> }>,
    startedAt: number,
  ): void {
    if (!this.accounts || this.recorded.has(engine)) return;
    this.recorded.add(engine);
    try {
      const record = summarizeMatch({
        roomCode: code,
        startedAt,
        endedAt: this.now(),
        history: engine.state.history,
        standings: engine.state.standings,
        endedBy: engine.state.endedBy,
        teams,
      });
      const outcome = this.accounts.recordMatch(record, (playerId) => {
        const conn = this.sockets.get(playerId);
        return (conn && this.sessions.get(conn)?.user) ?? null;
      });
      for (const playerId of outcome.saved) {
        this.sockets.get(playerId)?.send({ type: 'results.saved' });
      }
      for (const { playerId, claimToken, expiresInMs } of outcome.unsaved) {
        this.sockets.get(playerId)?.send({ type: 'results.unsaved', claimToken, expiresInMs });
      }
    } catch (error) {
      this.log(`[room ${code}] saving results failed`, error);
    }
  }

  private eligibleFor(room: Room): AnyPuzzleServerModule[] {
    return eligiblePuzzles(
      this.catalog,
      teamRosters(room).map((r) => r.playerIds.length),
    );
  }

  private update(room: Room, problem: string | null, error: (text: string) => void): void {
    if (problem) return error(problem);
    this.save(room);
  }

  /** Stores the room and sends every connected player the new room state. */
  private save(room: Room): void {
    this.store.set(room);
    const message: ServerMessage = {
      type: 'room.state',
      room: toRoomView(
        room,
        this.eligibleFor(room).length,
        excludedPuzzles(
          this.catalog,
          teamRosters(room).map((r) => r.playerIds.length),
        ),
      ),
    };
    for (const player of room.players) {
      if (player.connected) this.sockets.get(player.id)?.send(message);
    }
    this.syncVoice(room);
  }

  /** Recomputes who can hear whom and tells each player whose peer list changed. */
  private syncVoice(room: Room): void {
    const connected = new Set(room.players.filter((p) => p.connected).map((p) => p.id));
    const engine = room.status === 'lobby' ? undefined : this.engines.get(room.code);
    const voice = engine?.voiceState();
    const peers = voicePeers({
      playerIds: [...connected],
      match: engine && {
        phase: room.status === 'ended' ? 'finished' : engine.state.phase,
        comms: engine.manifest.comms,
        teams: engine.rosters.map((t) => ({
          id: t.id,
          playerIds: t.playerIds.filter((id) => connected.has(id)),
        })),
        voiceOpen: voice?.open ?? true,
        activeByTeam: voice?.activeByTeam ?? {},
        gates: voice?.gates ?? {},
      },
    });

    for (const [playerId, links] of peers) {
      this.voiceAllowed.set(playerId, new Set(links.map((l) => l.id)));
      const payload: VoicePeer[] = links.map((l) => ({
        id: l.id,
        epoch: this.epochs.get(l.id) ?? 0,
        ...(l.send === false ? { send: false } : {}),
        ...(l.hear === false ? { hear: false } : {}),
        // Rounded so small volume changes don't flood clients with peer lists.
        ...(l.gain !== undefined ? { gain: Math.round(l.gain * 20) / 20 } : {}),
      }));
      const json = JSON.stringify(payload);
      if (this.voiceSent.get(playerId) === json) continue;
      this.voiceSent.set(playerId, json);
      this.sockets.get(playerId)?.send({ type: 'comms.peers', peers: payload });
    }
  }

  private closeRoom(room: Room): void {
    for (const player of room.players) {
      const conn = this.sockets.get(player.id);
      if (!conn) continue;
      this.detach(conn);
      conn.send({ type: 'room.closed', cause: 'closed', reason: 'The room was closed' });
    }
    this.engines.delete(room.code);
    this.store.delete(room.code);
    this.log(`[room ${room.code}] closed`);
  }

  private detach(conn: Connection): void {
    const binding = this.bindings.get(conn);
    if (!binding) return;
    this.bindings.delete(conn);
    if (this.sockets.get(binding.playerId) === conn) {
      this.sockets.delete(binding.playerId);
      this.voiceAllowed.delete(binding.playerId);
      this.voiceSent.delete(binding.playerId);
    }
  }

  private newPlayer(name: string): RoomPlayer {
    return {
      id: newId('p'),
      name,
      seatToken: newSeatToken(),
      connected: true,
      disconnectedAt: null,
    };
  }
}
