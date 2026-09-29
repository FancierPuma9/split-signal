import type { MatchView, RoomView, ServerMessage } from '@split-signal/shared';
import { describe, expect, it } from 'vitest';
import { gameReducer, initialGameState, type GameState } from './reducer';

const room = (status: RoomView['status']): RoomView => ({
  code: 'BCDF',
  hostId: 'p1',
  status,
  locked: false,
  players: [],
  teams: [],
  settings: { teamCount: 2, maxPlayersPerTeam: 2, rounds: 5 },
  eligiblePuzzles: 1,
  startBlockers: [],
});

const match = (round: number, phase: MatchView['phase']) =>
  ({ round, phase, teams: [], history: [] }) as unknown as MatchView;

const apply = (state: GameState, ...messages: ServerMessage[]) =>
  messages.reduce((s, message, i) => gameReducer(s, { type: 'server', message, at: i }), state);

describe('gameReducer', () => {
  it('tracks the session and room', () => {
    const s = apply(
      initialGameState,
      { type: 'room.joined', code: 'BCDF', playerId: 'p1', name: 'Ada', seatToken: 't' },
      { type: 'room.state', room: room('lobby') },
    );
    expect(s.session).toEqual({ code: 'BCDF', playerId: 'p1' });
    expect(s.room?.code).toBe('BCDF');
  });

  it('keeps the puzzle view within a round and drops it when the round changes', () => {
    let s = apply(
      initialGameState,
      { type: 'match.state', match: match(0, 'playing') },
      { type: 'match.view', view: { a: 1 } },
      { type: 'match.state', match: match(0, 'playing') },
    );
    expect(s.puzzleView).toEqual({ round: 0, value: { a: 1 } });
    s = apply(s, { type: 'match.state', match: match(0, 'scoreboard') });
    expect(s.puzzleView).toBeNull();
    s = apply(s, { type: 'match.state', match: match(1, 'playing') });
    expect(s.puzzleView).toBeNull();
  });

  it('keeps the reveal through the scoreboard and drops it when the next round starts', () => {
    let s = apply(
      initialGameState,
      { type: 'match.state', match: match(0, 'scoreboard') },
      { type: 'match.reveal', round: 0, view: { answer: 42 } },
      { type: 'match.state', match: match(0, 'scoreboard') },
    );
    expect(s.reveal).toEqual({ round: 0, value: { answer: 42 } });
    s = apply(s, { type: 'match.state', match: match(1, 'intro') });
    expect(s.reveal).toBeNull();
  });

  it('collects signals during a round and clears them when it ends', () => {
    let s = apply(
      initialGameState,
      { type: 'match.state', match: match(0, 'playing') },
      { type: 'comms.signal', from: 'p2', signal: 'up' },
      { type: 'match.state', match: match(0, 'playing') },
      { type: 'comms.signal', from: 'p1', signal: 'left' },
    );
    expect(s.signals.map((x) => x.signal)).toEqual(['up', 'left']);
    s = apply(s, { type: 'match.state', match: match(0, 'scoreboard') });
    expect(s.signals).toEqual([]);
  });

  it('keeps only the most recent signals', () => {
    const messages = Array.from({ length: 30 }, (_, i) => ({
      type: 'comms.signal' as const,
      from: 'p2',
      signal: `s${i}`,
    }));
    const s = apply(
      initialGameState,
      { type: 'match.state', match: match(0, 'playing') },
      ...messages,
    );
    expect(s.signals).toHaveLength(20);
    expect(s.signals.at(-1)?.signal).toBe('s29');
  });

  it('clears the match when the room returns to the lobby', () => {
    const s = apply(
      initialGameState,
      { type: 'match.state', match: match(0, 'finished') },
      { type: 'room.state', room: room('lobby') },
    );
    expect(s.match).toBeNull();
  });

  it('forgets everything when the room closes, with a notice', () => {
    const s = apply(
      initialGameState,
      { type: 'room.joined', code: 'BCDF', playerId: 'p1', name: 'Ada', seatToken: 't' },
      { type: 'room.state', room: room('in-match') },
      { type: 'match.state', match: match(0, 'playing') },
      { type: 'room.closed', cause: 'closed', reason: 'The room was closed' },
    );
    expect(s).toMatchObject({ session: null, room: null, match: null });
    expect(s.notice?.text).toBe('The room was closed');
  });

  it('drops the room on screen when rejoining it fails', () => {
    const s = apply(
      initialGameState,
      { type: 'room.joined', code: 'BCDF', playerId: 'p1', name: 'Ada', seatToken: 't' },
      { type: 'room.state', room: room('in-match') },
      { type: 'match.state', match: match(0, 'finished') },
      { type: 'room.rejoinFailed', code: 'BCDF', reason: 'That room no longer exists' },
    );
    expect(s).toMatchObject({ session: null, room: null, match: null });
    expect(s.notice?.text).toBe('That room no longer exists');
  });

  it('tracks sign-in, stats, and what happened to your results', () => {
    let s = apply(
      initialGameState,
      { type: 'server.hello', googleClientId: 'client-1' },
      { type: 'auth.session', token: 't'.repeat(43), user: { id: '1', name: 'Ada' } },
    );
    expect(s.account).toMatchObject({ googleClientId: 'client-1', user: { name: 'Ada' } });
    s = apply(
      s,
      { type: 'match.state', match: match(0, 'finished') },
      { type: 'results.unsaved', claimToken: 'c'.repeat(32), expiresInMs: 60_000 },
    );
    expect(s.account.results).toMatchObject({ status: 'unsaved', claimToken: 'c'.repeat(32) });
    s = apply(s, { type: 'results.saved' }, { type: 'match.state', match: match(0, 'finished') });
    expect(s.account.results).toEqual({ status: 'saved' });
    // A new match clears it.
    s = apply(s, { type: 'match.state', match: match(0, 'intro') });
    expect(s.account.results).toBeNull();
    s = apply(s, {
      type: 'stats',
      stats: { matchesPlayed: 1, matchesWon: 0, roundsWon: 2, bests: [] },
    });
    expect(s.account.stats?.roundsWon).toBe(2);
    s = apply(s, { type: 'auth.signedOut', reason: 'Your sign-in expired. Sign in again.' });
    expect(s.account).toMatchObject({ user: null, stats: null, googleClientId: 'client-1' });
    expect(s.notice?.text).toMatch(/expired/);
  });

  it('shows rejections and errors as notices that can be dismissed', () => {
    const s = apply(initialGameState, { type: 'match.reject', reason: 'Nope' });
    expect(s.notice?.text).toBe('Nope');
    expect(gameReducer(s, { type: 'dismissNotice', id: s.notice!.id }).notice).toBeNull();
    expect(gameReducer(s, { type: 'dismissNotice', id: 999 }).notice).not.toBeNull();
  });
});
