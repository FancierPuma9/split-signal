import { CLAIM_WINDOW_MS } from '@split-signal/shared';
import { describe, expect, it } from 'vitest';
import { AccountService, type IdTokenVerifier } from './accounts';
import { summarizeMatch, type MatchRecord } from './record';
import { SESSION_TTL_MS, StatsDb } from './stats-db';

function clock(start = 1_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

const verifier: IdTokenVerifier = {
  clientId: 'client',
  // The test "token" is just the Google id and name.
  verify: async (token) => {
    const [sub, name] = token.split(':');
    if (!sub) throw new Error('bad token');
    return { sub, name: name ?? 'Player' };
  },
};

const match = (overrides: Partial<Parameters<typeof summarizeMatch>[0]> = {}): MatchRecord =>
  summarizeMatch({
    roomCode: 'BCDF',
    startedAt: 1000,
    endedAt: 9000,
    endedBy: 'completed',
    teams: [
      {
        id: 'red',
        players: [
          { id: 'p1', name: 'Ada' },
          { id: 'p2', name: 'Bo' },
        ],
      },
      { id: 'blue', players: [{ id: 'p3', name: 'Cy' }] },
    ],
    standings: [
      { teamId: 'red', score: 2, rank: 1 },
      { teamId: 'blue', score: 1, rank: 2 },
    ],
    history: [
      {
        round: 0,
        puzzleId: 'sliding-grid',
        puzzleName: 'Sliding Grid',
        winCondition: 'race',
        outcome: 'won',
        winnerTeamId: 'red',
        results: [
          { teamId: 'red', solved: true, elapsedMs: 42_000 },
          { teamId: 'blue', solved: false },
        ],
        points: { red: 1, blue: 0 },
      },
      {
        round: 1,
        puzzleId: 'padlock',
        puzzleName: 'Padlock',
        winCondition: 'compare',
        outcome: 'won',
        winnerTeamId: 'blue',
        results: [
          { teamId: 'red', solved: true, moves: 9, elapsedMs: 50_000 },
          { teamId: 'blue', solved: true, moves: 6, elapsedMs: 60_000 },
        ],
        points: { red: 0, blue: 1 },
      },
      {
        round: 2,
        puzzleId: 'ghost-ink',
        puzzleName: 'Ghost Ink',
        winCondition: 'compare',
        outcome: 'won',
        winnerTeamId: 'red',
        results: [
          { teamId: 'red', solved: true, points: 81.5, elapsedMs: 70_000 },
          { teamId: 'blue', solved: false, points: 40 },
        ],
        points: { red: 1, blue: 0 },
      },
    ],
    ...overrides,
  });

describe('summarizeMatch', () => {
  it('gives each player their team’s results, rounds won, and whether they won', () => {
    const record = match();
    const ada = record.players.find((p) => p.playerId === 'p1')!;
    expect(ada).toMatchObject({ teamId: 'red', won: true, roundsWon: 2 });
    expect(ada.results[0]).toEqual({
      round: 0,
      puzzleId: 'sliding-grid',
      puzzleName: 'Sliding Grid',
      winCondition: 'race',
      solved: true,
      elapsedMs: 42_000,
      wonRound: true,
    });
    expect(record.players.find((p) => p.playerId === 'p3')).toMatchObject({
      won: false,
      roundsWon: 1,
    });
    expect(record.rounds).toBe(3);
  });

  it('calls a draw nobody’s win', () => {
    const drawn = match({
      standings: [
        { teamId: 'red', score: 1, rank: 1 },
        { teamId: 'blue', score: 1, rank: 1 },
      ],
    });
    expect(drawn.players.every((p) => !p.won)).toBe(true);
  });
});

describe('StatsDb', () => {
  it('creates an account per Google id and keeps its name current', () => {
    const db = new StatsDb(':memory:');
    const a = db.upsertUser({ sub: 'g1', name: 'Ada' });
    const again = db.upsertUser({ sub: 'g1', name: 'Ada L.' });
    expect(again).toEqual({ id: a.id, name: 'Ada L.' });
    expect(db.upsertUser({ sub: 'g2', name: 'Bo' }).id).not.toBe(a.id);
  });

  it('keeps sessions until they lapse or are signed out', () => {
    const c = clock();
    const db = new StatsDb(':memory:', c.now);
    const user = db.upsertUser({ sub: 'g1', name: 'Ada' });
    const token = db.createSession(user.id);
    expect(db.sessionUser(token)).toEqual(user);
    expect(db.sessionUser('x'.repeat(43))).toBeNull();
    c.advance(SESSION_TTL_MS - 1000);
    expect(db.sessionUser(token)).toEqual(user); // using it extends it
    c.advance(SESSION_TTL_MS - 1000);
    expect(db.sessionUser(token)).toEqual(user);
    c.advance(SESSION_TTL_MS + 1);
    expect(db.sessionUser(token)).toBeNull();
    const other = db.createSession(user.id);
    db.deleteSession(other);
    expect(db.sessionUser(other)).toBeNull();
  });

  it('adds up matches, wins, rounds and personal bests', () => {
    const db = new StatsDb(':memory:');
    const user = db.upsertUser({ sub: 'g1', name: 'Ada' });
    const record = match();
    const ada = record.players.find((p) => p.playerId === 'p1')!;
    const id1 = db.saveMatch(record);
    expect(db.savePlayer(id1, user.id, ada)).toBe(true);
    // The same person in two seats of one match counts once.
    expect(
      db.savePlayer(
        id1,
        user.id,
        record.players.find((p) => p.playerId === 'p2')!,
      ),
    ).toBe(false);

    // A second match, lost, with a faster Sliding Grid.
    const second = match({
      standings: [
        { teamId: 'blue', score: 2, rank: 1 },
        { teamId: 'red', score: 1, rank: 2 },
      ],
    });
    const faster = second.players.find((p) => p.playerId === 'p1')!;
    faster.results[0] = { ...faster.results[0]!, elapsedMs: 30_000 };
    db.savePlayer(db.saveMatch(second), user.id, faster);

    const stats = db.stats(user.id);
    expect(stats).toMatchObject({ matchesPlayed: 2, matchesWon: 1, roundsWon: 4 });
    expect(stats.bests).toEqual([
      { puzzleId: 'ghost-ink', puzzleName: 'Ghost Ink', plays: 2, mostPoints: 81.5 },
      { puzzleId: 'padlock', puzzleName: 'Padlock', plays: 2, fewestMoves: 9 },
      { puzzleId: 'sliding-grid', puzzleName: 'Sliding Grid', plays: 2, fastestMs: 30_000 },
    ]);
  });

  it('starts empty for a new account', () => {
    const db = new StatsDb(':memory:');
    const user = db.upsertUser({ sub: 'g1', name: 'Ada' });
    expect(db.stats(user.id)).toEqual({ matchesPlayed: 0, matchesWon: 0, roundsWon: 0, bests: [] });
  });
});

describe('AccountService', () => {
  function service() {
    const c = clock();
    const db = new StatsDb(':memory:', c.now);
    return { accounts: new AccountService(db, verifier, c.now), db, c };
  }

  it('signs in with Google and resumes by session token', async () => {
    const { accounts } = service();
    const session = await accounts.signIn('g1:Ada');
    expect(session.user.name).toBe('Ada');
    expect(accounts.resume(session.token)).toEqual(session);
    accounts.signOut(session.token);
    expect(accounts.resume(session.token)).toBeNull();
    await expect(accounts.signIn(':')).rejects.toThrow();
  });

  it('saves signed-in players at once and holds guests’ results for claiming', async () => {
    const { accounts } = service();
    const ada = (await accounts.signIn('g1:Ada')).user;
    const outcome = accounts.recordMatch(match(), (id) => (id === 'p1' ? ada : null));
    expect(outcome.saved).toEqual(['p1']);
    expect(outcome.unsaved.map((u) => u.playerId)).toEqual(['p2', 'p3']);
    expect(accounts.stats(ada).matchesPlayed).toBe(1);

    const cy = (await accounts.signIn('g3:Cy')).user;
    const claim = outcome.unsaved.find((u) => u.playerId === 'p3')!;
    expect(accounts.claim(claim.claimToken, cy)).toBe(true);
    expect(accounts.stats(cy)).toMatchObject({ matchesPlayed: 1, matchesWon: 0, roundsWon: 1 });
    // A claim works once.
    expect(accounts.claim(claim.claimToken, cy)).toBe(false);
  });

  it('lets a claim lapse after the window', async () => {
    const { accounts, c } = service();
    const outcome = accounts.recordMatch(match(), () => null);
    c.advance(CLAIM_WINDOW_MS + 1);
    const bo = (await accounts.signIn('g2:Bo')).user;
    expect(accounts.claim(outcome.unsaved[0]!.claimToken, bo)).toBe(false);
    expect(accounts.stats(bo).matchesPlayed).toBe(0);
  });
});
