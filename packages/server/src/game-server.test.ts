import type { AnyPuzzleServerModule, ClientMessage } from '@split-signal/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { GameServer } from './game-server';
import { inbox, tapPuzzle } from './test/fixtures';

const TIMINGS = { introMs: 100, countdownMs: 100, scoreboardMs: 100, defaultRaceGraceMs: 0 };

let now = 0;
let server: GameServer;

beforeEach(() => {
  now = 0;
  server = new GameServer({
    catalog: [tapPuzzle() as AnyPuzzleServerModule],
    now: () => now,
    timings: TIMINGS,
    log: () => {},
  });
});

function client() {
  const box = inbox();
  const conn = { send: box.send };
  const send = (message: ClientMessage) => server.handle(conn, message);
  return {
    ...box,
    conn,
    send,
    get id() {
      return box.last('room.joined')?.playerId ?? '';
    },
    get token() {
      return box.last('room.joined')?.seatToken ?? '';
    },
    get room() {
      return box.last('room.state')?.room;
    },
    get error() {
      return box.last('error')?.message;
    },
  };
}

function run(ms: number) {
  for (let t = 0; t < ms; t += 10) {
    now += 10;
    server.tick();
    server.sweep();
  }
}

/** Host + guest in a locked 1v1 lobby. */
function lobby() {
  const host = client();
  host.send({ type: 'room.create', name: 'Host' });
  const code = host.room!.code;
  const guest = client();
  guest.send({ type: 'room.join', code, name: 'Guest' });
  host.send({ type: 'lobby.seat', teamId: 'red' });
  guest.send({ type: 'lobby.seat', teamId: 'blue' });
  host.send({ type: 'lobby.lock', locked: true });
  return { host, guest, code };
}

describe('GameServer rooms and lobby', () => {
  it('creates a room and makes the creator host', () => {
    const host = client();
    host.send({ type: 'room.create', name: 'Ada' });
    expect(host.last('room.joined')).toMatchObject({ code: expect.stringMatching(/^[A-Z]{4}$/) });
    expect(host.room).toMatchObject({
      hostId: host.id,
      status: 'lobby',
      players: [{ name: 'Ada' }],
    });
  });

  it('joins by code and broadcasts the roster', () => {
    const host = client();
    host.send({ type: 'room.create', name: 'Ada' });
    const guest = client();
    guest.send({ type: 'room.join', code: host.room!.code, name: 'Ada' });
    expect(host.room?.players.map((p) => p.name)).toEqual(['Ada', 'Ada (2)']);
    expect(guest.room?.players).toHaveLength(2);
  });

  it('reports unknown codes and refuses a second room per connection', () => {
    const a = client();
    a.send({ type: 'room.join', code: 'ZZZZ', name: 'A' });
    expect(a.error).toMatch(/No room with code ZZZZ/);
    a.send({ type: 'room.create', name: 'A' });
    a.send({ type: 'room.create', name: 'A' });
    expect(a.error).toMatch(/Leave your current room/);
  });

  it('enforces host-only actions', () => {
    const { guest } = lobby();
    guest.send({ type: 'lobby.settings', settings: { rounds: 2 } });
    expect(guest.error).toMatch(/Only the host/);
    guest.send({ type: 'lobby.start' });
    expect(guest.error).toMatch(/Only the host/);
  });

  it('shows start blockers until the lobby is ready', () => {
    const host = client();
    host.send({ type: 'room.create', name: 'Host' });
    expect(host.room?.startBlockers.length).toBeGreaterThan(0);
    host.send({ type: 'lobby.start' });
    expect(host.error).toMatch(/needs a seat/);
    const { host: ready } = lobby();
    expect(ready.room?.startBlockers).toEqual([]);
    expect(ready.room?.eligiblePuzzles).toBe(1);
  });

  it('holds a disconnected lobby seat, then frees it and hands off host', () => {
    const host = client();
    host.send({ type: 'room.create', name: 'Host' });
    const guest = client();
    guest.send({ type: 'room.join', code: host.room!.code, name: 'Guest' });
    server.disconnect(host.conn);
    expect(guest.room?.players[0]).toMatchObject({ name: 'Host', connected: false });
    run(59_000);
    expect(guest.room?.players).toHaveLength(2);
    run(2_000);
    expect(guest.room?.players.map((p) => p.name)).toEqual(['Guest']);
    expect(guest.room?.hostId).toBe(guest.id);
  });

  it('restores a seat on rejoin and replaces the old tab', () => {
    const { host, code } = lobby();
    const tab = client();
    tab.send({ type: 'room.rejoin', code, seatToken: host.token });
    expect(tab.id).toBe(host.id);
    expect(host.last('room.closed')?.reason).toMatch(/another tab/);
    tab.send({ type: 'room.rejoin', code, seatToken: 'wrong' });
    expect(tab.last('room.rejoinFailed')?.reason).toMatch(/given up/);
  });

  it('closes rooms nobody has been in for ten minutes', () => {
    const { host, guest, code } = lobby();
    server.disconnect(host.conn);
    server.disconnect(guest.conn);
    run(10 * 60_000);
    const back = client();
    back.send({ type: 'room.rejoin', code, seatToken: host.token });
    expect(back.last('room.rejoinFailed')?.reason).toMatch(/no longer exists/);
  });

  it('removes a player who leaves the lobby', () => {
    const host = client();
    host.send({ type: 'room.create', name: 'Host' });
    const guest = client();
    guest.send({ type: 'room.join', code: host.room!.code, name: 'Guest' });
    guest.send({ type: 'room.leave' });
    expect(guest.last('room.closed')).toBeDefined();
    expect(host.room?.players.map((p) => p.name)).toEqual(['Host']);
  });
});

describe('GameServer voice', () => {
  const peerIds = (c: ReturnType<typeof client>) =>
    c.last('comms.peers')?.peers.map((p) => p.id) ?? [];

  it('sends ICE config on join and connects everyone in the lobby', () => {
    const { host, guest } = lobby();
    expect(host.last('comms.config')?.iceServers.length).toBeGreaterThan(0);
    expect(peerIds(host)).toEqual([guest.id]);
    expect(peerIds(guest)).toEqual([host.id]);
  });

  it('follows the comms rule through a round and opens up at the end', () => {
    // One team of two playing a puzzle whose comms rule is 'none'.
    const host = client();
    host.send({ type: 'room.create', name: 'Host' });
    const guest = client();
    guest.send({ type: 'room.join', code: host.room!.code, name: 'Guest' });
    host.send({ type: 'lobby.settings', settings: { teamCount: 1, rounds: 1 } });
    host.send({ type: 'lobby.seat', teamId: 'red' });
    guest.send({ type: 'lobby.seat', teamId: 'red' });
    host.send({ type: 'lobby.lock', locked: true });
    host.send({ type: 'lobby.start' });

    expect(peerIds(host)).toEqual([guest.id]); // intro: your team can plan
    run(200);
    expect(peerIds(host)).toEqual([]); // playing a 'none' puzzle: silence
    expect(peerIds(guest)).toEqual([]);
    guest.send({ type: 'match.action', payload: { type: 'solve' } });
    expect(peerIds(host)).toEqual([guest.id]); // scoreboard
    run(100);
    expect(host.last('match.state')?.match.phase).toBe('finished');
    expect(peerIds(host)).toEqual([guest.id]);
  });

  it('relays signaling only between current peers', () => {
    const { host, guest } = lobby();
    const offer = { kind: 'offer' as const, sdp: 'v=0' };
    host.send({ type: 'comms.rtc', to: guest.id, data: offer });
    expect(guest.last('comms.rtc')).toEqual({ type: 'comms.rtc', from: host.id, data: offer });

    host.send({ type: 'lobby.start' });
    guest.clear();
    host.send({ type: 'comms.rtc', to: guest.id, data: offer });
    expect(guest.last('comms.rtc')).toBeUndefined();
  });

  it('bumps the epoch when a player reconnects so peers rebuild', () => {
    const { host, guest, code } = lobby();
    const before = host.last('comms.peers')?.peers[0]?.epoch ?? 0;
    server.disconnect(guest.conn);
    expect(peerIds(host)).toEqual([]);
    const back = client();
    back.send({ type: 'room.rejoin', code, seatToken: guest.token });
    expect(host.last('comms.peers')?.peers).toEqual([{ id: guest.id, epoch: before + 1 }]);
    expect(peerIds(back)).toEqual([host.id]);
  });
});

describe('GameServer matches', () => {
  it('starts a match and refuses new joiners', () => {
    const { host, guest, code } = lobby();
    host.send({ type: 'lobby.start' });
    expect(host.room?.status).toBe('in-match');
    expect(guest.last('match.state')?.match).toMatchObject({ phase: 'intro', totalRounds: 5 });
    const late = client();
    late.send({ type: 'room.join', code, name: 'Late' });
    expect(late.error).toMatch(/already started/);
  });

  it('plays rounds end to end', () => {
    const { host, guest } = lobby();
    host.send({ type: 'lobby.settings', settings: { rounds: 1 } });
    expect(host.error).toMatch(/Unlock/);
    host.send({ type: 'lobby.lock', locked: false });
    host.send({ type: 'lobby.settings', settings: { rounds: 1 } });
    host.send({ type: 'lobby.lock', locked: true });
    host.send({ type: 'lobby.start' });
    run(200);
    expect(guest.last('match.view')).toBeDefined();
    guest.send({ type: 'match.action', payload: { type: 'solve' } });
    expect(host.last('match.state')?.match.history[0]).toMatchObject({ winnerTeamId: 'blue' });
    run(100);
    expect(host.last('match.state')?.match).toMatchObject({
      phase: 'finished',
      endedBy: 'completed',
    });
  });

  it('pauses on disconnect and resumes on rejoin with the current view', () => {
    const { host, guest, code } = lobby();
    host.send({ type: 'lobby.start' });
    run(200);
    server.disconnect(guest.conn);
    expect(host.last('match.state')?.match.paused?.waitingFor).toEqual([guest.id]);
    run(60_000);
    const back = client();
    back.send({ type: 'room.rejoin', code, seatToken: guest.token });
    expect(back.last('match.state')?.match).toMatchObject({ phase: 'playing', paused: null });
    expect(back.last('match.view')).toBeDefined();
    expect(host.last('match.state')?.match.paused).toBeNull();
  });

  it('surrender ends the match and closes the room once everyone leaves', () => {
    const { host, guest, code } = lobby();
    host.send({ type: 'lobby.start' });
    host.send({ type: 'match.surrender' });
    expect(host.error).toMatch(/only surrender while waiting/);
    server.disconnect(guest.conn);
    host.send({ type: 'match.surrender' });
    expect(host.last('match.state')?.match.endedBy).toBe('surrender');
    expect(host.room?.status).toBe('ended');
    host.send({ type: 'room.leave' });
    const back = client();
    back.send({ type: 'room.rejoin', code, seatToken: guest.token });
    expect(back.last('room.rejoinFailed')?.reason).toMatch(/no longer exists/);
  });

  it('can play again or go back to the lobby after a match', () => {
    const { host, guest } = lobby();
    host.send({ type: 'lobby.lock', locked: false });
    host.send({ type: 'lobby.settings', settings: { rounds: 1 } });
    host.send({ type: 'lobby.lock', locked: true });
    host.send({ type: 'lobby.start' });
    host.send({ type: 'match.playAgain' });
    expect(host.error).toMatch(/not over/);
    run(200 + 10_000 + 100);
    expect(guest.last('match.state')?.match.phase).toBe('finished');

    guest.send({ type: 'match.playAgain' });
    expect(guest.error).toMatch(/Only the host/);
    host.send({ type: 'match.playAgain' });
    expect(guest.last('match.state')?.match).toMatchObject({ phase: 'intro', history: [] });

    run(200 + 10_000 + 100);
    host.send({ type: 'match.backToLobby' });
    expect(guest.room).toMatchObject({ status: 'lobby', locked: true });
  });
});
