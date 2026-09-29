import type { AnyPuzzleServerModule, ClientMessage, ServerMessage } from '@split-signal/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { startServer, type RunningServer } from './app';
import { tapPuzzle } from './test/fixtures';

let server: RunningServer;

beforeAll(async () => {
  server = await startServer({
    port: 0,
    catalog: [tapPuzzle() as AnyPuzzleServerModule],
    clientDist: 'does-not-exist',
    timings: { introMs: 50, countdownMs: 50, scoreboardMs: 50, defaultRaceGraceMs: 0 },
  });
});

afterAll(() => server.close());

/** A real WebSocket client that can wait for a matching message. */
async function connect() {
  const socket = new WebSocket(`ws://127.0.0.1:${server.port}/ws`);
  const received: ServerMessage[] = [];
  const waiters: Array<{ test: (m: ServerMessage) => boolean; done: (m: ServerMessage) => void }> =
    [];
  socket.on('message', (data) => {
    const message = JSON.parse(String(data)) as ServerMessage;
    received.push(message);
    for (const w of [...waiters]) {
      if (w.test(message)) {
        waiters.splice(waiters.indexOf(w), 1);
        w.done(message);
      }
    }
  });
  await new Promise((resolve, reject) => socket.once('open', resolve).once('error', reject));
  return {
    send: (message: ClientMessage) => socket.send(JSON.stringify(message)),
    raw: (text: string) => socket.send(text),
    close: () => socket.close(),
    waitFor<T extends ServerMessage['type']>(
      type: T,
      where: (m: Extract<ServerMessage, { type: T }>) => boolean = () => true,
    ): Promise<Extract<ServerMessage, { type: T }>> {
      const test = (m: ServerMessage) =>
        m.type === type && where(m as Extract<ServerMessage, { type: T }>);
      const existing = received.find(test);
      if (existing) return Promise.resolve(existing as Extract<ServerMessage, { type: T }>);
      return new Promise((done, fail) => {
        const timer = setTimeout(() => fail(new Error(`timed out waiting for ${type}`)), 3000);
        waiters.push({
          test,
          done: (m) => {
            clearTimeout(timer);
            done(m as Extract<ServerMessage, { type: T }>);
          },
        });
      });
    },
  };
}

describe('server over WebSockets', () => {
  it('rejects malformed messages', async () => {
    const c = await connect();
    c.raw('{nope');
    expect((await c.waitFor('error')).message).toBe('Malformed message');
    c.close();
  });

  it('runs a room from creation to a finished round', async () => {
    const host = await connect();
    host.send({ type: 'room.create', name: 'Host' });
    const { code } = await host.waitFor('room.joined');

    const guest = await connect();
    guest.send({ type: 'room.join', code, name: 'Guest' });
    await host.waitFor('room.state', (m) => m.room.players.length === 2);

    host.send({ type: 'lobby.settings', settings: { rounds: 1 } });
    host.send({ type: 'lobby.seat', teamId: 'red' });
    guest.send({ type: 'lobby.seat', teamId: 'blue' });
    await host.waitFor('room.state', (m) => m.room.teams.every((t) => t.seats[0] !== null));
    host.send({ type: 'lobby.lock', locked: true });
    await host.waitFor('room.state', (m) => m.room.startBlockers.length === 0);
    host.send({ type: 'lobby.start' });

    await guest.waitFor('match.state', (m) => m.match.phase === 'playing');
    await guest.waitFor('match.view');
    guest.send({ type: 'match.action', payload: { type: 'solve' } });

    const done = await host.waitFor('match.state', (m) => m.match.phase === 'finished');
    expect(done.match.standings?.[0]).toEqual({ teamId: 'blue', score: 1, rank: 1 });
    host.close();
    guest.close();
  });
});
