import type { AnyPuzzleServerModule, ClientMessage } from '@split-signal/shared';
import { describe, expect, it } from 'vitest';
import { GameServer } from './game-server';
import { AccountService, type IdTokenVerifier } from './stats/accounts';
import { StatsDb } from './stats/stats-db';
import { inbox, tapPuzzle } from './test/fixtures';

const TIMINGS = { introMs: 100, countdownMs: 100, scoreboardMs: 100, defaultRaceGraceMs: 0 };

// Test credentials look like JWTs; the stub reads the account id and name from the first part.
const credential = (sub: string, name: string) => `${sub}.${name}.sig`;
const verifier: IdTokenVerifier = {
  clientId: 'client-123',
  verify: async (token) => {
    const [sub, name] = token.split('.');
    if (sub === 'bad') throw new Error('bad token');
    return { sub: sub!, name: name! };
  },
};

function setup(withAccounts = true) {
  let now = 0;
  const accounts = withAccounts
    ? new AccountService(new StatsDb(':memory:'), verifier, () => now)
    : undefined;
  const server = new GameServer({
    catalog: [tapPuzzle() as AnyPuzzleServerModule],
    now: () => now,
    timings: TIMINGS,
    log: () => {},
    ...(accounts ? { accounts } : {}),
  });
  const client = () => {
    const box = inbox();
    const conn = { send: box.send };
    server.connect(conn);
    return { ...box, conn, send: (m: ClientMessage) => server.handle(conn, m) };
  };
  const run = (ms: number) => {
    for (let t = 0; t < ms; t += 10) {
      now += 10;
      server.tick();
      server.sweep();
    }
  };
  return { server, client, run };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('GameServer accounts', () => {
  it('says whether sign-in is available', () => {
    expect(setup().client().last('server.hello')).toEqual({
      type: 'server.hello',
      googleClientId: 'client-123',
    });
    const guestOnly = setup(false).client();
    expect(guestOnly.last('server.hello')?.googleClientId).toBeNull();
    guestOnly.send({ type: 'auth.google', credential: credential('g1', 'Ada') });
    expect(guestOnly.last('error')?.message).toMatch(/isn't set up/);
  });

  it('signs in, resumes on a new connection, and signs out', async () => {
    const { client } = setup();
    const tab = client();
    tab.send({ type: 'auth.google', credential: credential('g1', 'Ada') });
    await settle();
    const session = tab.last('auth.session')!;
    expect(session.user.name).toBe('Ada');

    const later = client();
    later.send({ type: 'auth.resume', token: session.token });
    expect(later.last('auth.session')?.user).toEqual(session.user);
    later.send({ type: 'auth.signOut' });
    expect(later.last('auth.signedOut')).toBeDefined();

    const again = client();
    again.send({ type: 'auth.resume', token: session.token });
    expect(again.last('auth.signedOut')?.reason).toMatch(/expired/);
  });

  it('reports a failed sign-in', async () => {
    const { client } = setup();
    const tab = client();
    tab.send({ type: 'auth.google', credential: credential('bad', 'x') });
    await settle();
    expect(tab.last('auth.signedOut')?.reason).toMatch(/failed/);
    tab.send({ type: 'stats.get' });
    expect(tab.last('error')?.message).toMatch(/Sign in/);
  });

  it('saves signed-in players after a match and lets guests claim theirs', async () => {
    const { client, run } = setup();
    const host = client();
    const guest = client();
    host.send({ type: 'auth.google', credential: credential('g1', 'Ada') });
    await settle();

    host.send({ type: 'room.create', name: 'Host' });
    const code = host.last('room.state')!.room.code;
    guest.send({ type: 'room.join', code, name: 'Guest' });
    host.send({ type: 'lobby.settings', settings: { rounds: 1 } });
    host.send({ type: 'lobby.seat', teamId: 'red' });
    guest.send({ type: 'lobby.seat', teamId: 'blue' });
    host.send({ type: 'lobby.lock', locked: true });
    host.send({ type: 'lobby.start' });
    run(200);
    host.send({ type: 'match.action', payload: { type: 'solve' } });
    run(200);
    expect(host.last('match.state')?.match.phase).toBe('finished');

    expect(host.last('results.saved')).toBeDefined();
    host.send({ type: 'stats.get' });
    expect(host.last('stats')?.stats).toMatchObject({
      matchesPlayed: 1,
      matchesWon: 1,
      roundsWon: 1,
    });
    expect(host.last('stats')?.stats.bests[0]).toMatchObject({
      puzzleId: 'tap',
      fastestMs: expect.any(Number),
    });

    const unsaved = guest.last('results.unsaved')!;
    expect(unsaved.expiresInMs).toBeGreaterThan(0);
    guest.send({ type: 'results.claim', claimToken: unsaved.claimToken });
    expect(guest.last('error')?.message).toMatch(/Sign in first/);
    guest.send({ type: 'auth.google', credential: credential('g2', 'Bo') });
    await settle();
    guest.send({ type: 'results.claim', claimToken: unsaved.claimToken });
    expect(guest.last('results.saved')).toBeDefined();
    guest.send({ type: 'stats.get' });
    expect(guest.last('stats')?.stats).toMatchObject({
      matchesPlayed: 1,
      matchesWon: 0,
      roundsWon: 0,
    });

    // Nothing is recorded twice when later state changes come through.
    run(1000);
    host.send({ type: 'stats.get' });
    expect(host.last('stats')?.stats.matchesPlayed).toBe(1);
  });

  it('deletes an account and signs it out everywhere', async () => {
    const { client } = setup();
    const tab = client();
    tab.send({ type: 'auth.google', credential: credential('g1', 'Ada') });
    await settle();
    const token = tab.last('auth.session')!.token;
    const other = client();
    other.send({ type: 'auth.resume', token });
    const stranger = client();
    stranger.send({ type: 'auth.google', credential: credential('g2', 'Bo') });
    await settle();

    tab.send({ type: 'account.delete' });
    expect(tab.last('auth.signedOut')?.reason).toMatch(/deleted/);
    expect(other.last('auth.signedOut')).toBeDefined();
    expect(stranger.last('auth.signedOut')).toBeUndefined();
    const again = client();
    again.send({ type: 'auth.resume', token });
    expect(again.last('auth.signedOut')).toBeDefined();
    tab.send({ type: 'account.delete' });
    expect(tab.last('error')?.message).toMatch(/Sign in/);
  });

  it('forgets who was signed in on a connection once it closes', async () => {
    const { server, client } = setup();
    const tab = client();
    tab.send({ type: 'auth.google', credential: credential('g1', 'Ada') });
    server.disconnect(tab.conn);
    await settle();
    tab.send({ type: 'stats.get' });
    expect(tab.last('error')?.message).toMatch(/Sign in/);
  });
});
