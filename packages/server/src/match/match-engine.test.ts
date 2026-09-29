import type { AnyPuzzleServerModule, ServerMessage } from '@split-signal/shared';
import { describe, expect, it } from 'vitest';
import { inbox, tapPuzzle } from '../test/fixtures';
import { MatchEngine, type MatchTeam } from './match-engine';

const TIMINGS = { introMs: 100, countdownMs: 100, scoreboardMs: 100, defaultRaceGraceMs: 50 };

const teams: MatchTeam[] = [
  { id: 'red', name: 'Red', players: [{ id: 'r1', name: 'R1', seat: 0 }] },
  { id: 'blue', name: 'Blue', players: [{ id: 'b1', name: 'B1', seat: 0 }] },
];

function setup(puzzles: AnyPuzzleServerModule[]) {
  let now = 0;
  const boxes = new Map([
    ['r1', inbox()],
    ['b1', inbox()],
  ]);
  const engine = new MatchEngine(
    { seed: 'seed', puzzles, teams, timings: TIMINGS, now: () => now },
    { send: (id: string, m: ServerMessage) => boxes.get(id)?.send(m) },
  );
  const run = (ms: number) => {
    for (let t = 0; t < ms; t += 10) {
      now += 10;
      engine.tick();
    }
  };
  const act = (playerId: string, type: 'tap' | 'solve') => engine.handleAction(playerId, { type });
  const red = boxes.get('r1')!;
  const blue = boxes.get('b1')!;
  return { engine, run, act, red, blue, advanceClock: (ms: number) => (now += ms) };
}

const race = tapPuzzle() as AnyPuzzleServerModule;
const compare = tapPuzzle({ id: 'tap-compare', winCondition: 'compare' }) as AnyPuzzleServerModule;

describe('MatchEngine', () => {
  it('walks through intro, countdown, playing, scoreboard, and results', () => {
    const { engine, run, act, red } = setup([race, race]);
    engine.start();
    expect(red.last('match.state')?.match).toMatchObject({
      phase: 'intro',
      round: 0,
      totalRounds: 2,
    });
    run(100);
    expect(engine.state.phase).toBe('countdown');
    run(100);
    expect(engine.state.phase).toBe('playing');
    expect(red.last('match.view')?.view).toMatchObject({ solved: false });

    act('r1', 'solve');
    run(50);
    expect(engine.state.phase).toBe('scoreboard');
    expect(engine.state.history[0]).toMatchObject({ outcome: 'won', winnerTeamId: 'red' });
    expect(engine.state.scores).toEqual({ red: 1, blue: 0 });

    run(100);
    expect(engine.state).toMatchObject({ phase: 'intro', round: 1 });
    run(200);
    run(10_000); // nobody solves
    expect(engine.state.history[1]).toMatchObject({ outcome: 'unsolved' });
    run(100);
    expect(engine.state.phase).toBe('finished');
    expect(red.last('match.state')?.match).toMatchObject({
      endedBy: 'completed',
      standings: [
        { teamId: 'red', score: 1, rank: 1 },
        { teamId: 'blue', score: 0, rank: 2 },
      ],
    });
  });

  it('gives every team the same puzzle, and a fresh one each round', () => {
    const { engine, run, red, blue } = setup([race, race]);
    engine.start();
    run(200);
    const redView = red.last('match.view')?.view as { seedValue: number };
    expect(blue.last('match.view')?.view).toEqual(redView);
    run(10_000 + 100 + 200);
    expect((red.last('match.view')?.view as { seedValue: number }).seedValue).not.toBe(
      redView.seedValue,
    );
  });

  it('race: other teams get a grace window and the fastest solve wins', () => {
    const { engine, run, act } = setup([race]);
    engine.start();
    run(200);
    act('r1', 'solve');
    run(20);
    expect(engine.state.phase).toBe('playing');
    act('b1', 'solve');
    expect(engine.state.phase).toBe('scoreboard');
    expect(engine.state.history[0]).toMatchObject({ outcome: 'won', winnerTeamId: 'red' });
  });

  it('race: simultaneous solves are a tie with no point', () => {
    const { engine, run, act } = setup([race]);
    engine.start();
    run(200);
    act('r1', 'solve');
    act('b1', 'solve');
    expect(engine.state.history[0]).toMatchObject({ outcome: 'tie', winnerTeamId: null });
    expect(engine.state.scores).toEqual({ red: 0, blue: 0 });
  });

  it('compare: keeps playing until everyone solves, fewest moves wins', () => {
    const { engine, run, act } = setup([compare]);
    engine.start();
    run(200);
    act('r1', 'tap');
    act('r1', 'tap');
    act('r1', 'solve');
    run(5000);
    expect(engine.state.phase).toBe('playing');
    act('r1', 'tap');
    act('b1', 'tap');
    act('b1', 'solve');
    expect(engine.state.history[0]).toMatchObject({ outcome: 'won', winnerTeamId: 'blue' });
    expect(engine.state.history[0]?.results).toEqual([
      { teamId: 'red', solved: true, moves: 2, elapsedMs: 0 },
      { teamId: 'blue', solved: true, moves: 1, elapsedMs: 5000 },
    ]);
  });

  it('compare: at timeout, a solved team beats an unsolved one', () => {
    const { engine, run, act } = setup([compare]);
    engine.start();
    run(200);
    act('b1', 'solve');
    run(10_000);
    expect(engine.state.history[0]).toMatchObject({ outcome: 'won', winnerTeamId: 'blue' });
  });

  it('rejects actions outside the playing phase and after solving', () => {
    const { engine, run, act, red } = setup([compare]);
    engine.start();
    act('r1', 'tap');
    expect(red.last('match.reject')?.reason).toMatch(/not running/);
    run(200);
    act('r1', 'solve');
    act('r1', 'tap');
    expect(red.last('match.reject')?.reason).toMatch(/already solved/);
    engine.handleAction('stranger', { type: 'tap' });
  });

  it('pauses every timer while a player is disconnected', () => {
    const { engine, run, act, red, blue } = setup([race]);
    engine.start();
    run(200);
    run(1000);
    engine.playerDisconnected('b1');
    expect(red.last('match.state')?.match.paused).toEqual({ waitingFor: ['b1'] });
    const remaining = engine.view().phaseRemainingMs;
    run(60_000);
    expect(engine.state.phase).toBe('playing');
    expect(engine.view().phaseRemainingMs).toBe(remaining);
    act('r1', 'solve');
    expect(red.last('match.reject')?.reason).toMatch(/paused/);

    blue.clear();
    engine.playerReconnected('b1');
    expect(blue.last('match.state')?.match.paused).toBeNull();
    expect(blue.last('match.view')).toBeDefined();
    run(100);
    expect(engine.view().phaseRemainingMs).toBe((remaining ?? 0) - 100);
  });

  it('relays allowed signals to the team only, with a cooldown', () => {
    const signals = tapPuzzle({
      comms: { type: 'signals', signals: ['up', 'down'], cooldownMs: 500 },
    }) as AnyPuzzleServerModule;
    const { engine, run, red, blue } = setup([signals]);
    engine.start();
    engine.handleSignal('r1', 'up');
    expect(red.all('comms.signal')).toHaveLength(0); // not playing yet
    run(200);

    engine.handleSignal('r1', 'up');
    expect(red.last('comms.signal')).toEqual({ type: 'comms.signal', from: 'r1', signal: 'up' });
    expect(blue.all('comms.signal')).toHaveLength(0);
    expect(red.last('match.view')?.view).toMatchObject({ signals: ['up'] });

    engine.handleSignal('r1', 'down'); // cooling down
    engine.handleSignal('r1', 'left'); // not allowed
    run(500);
    engine.handleSignal('r1', 'down');
    expect(red.all('comms.signal').map((m) => m.signal)).toEqual(['up', 'down']);
  });

  it('drops signals when the puzzle allows none', () => {
    const { engine, run, red } = setup([race]);
    engine.start();
    run(200);
    engine.handleSignal('r1', 'up');
    expect(red.all('comms.signal')).toHaveLength(0);
  });

  it('routes clips through the puzzle, with cooldown, length limit, and repeat', () => {
    const base = tapPuzzle({
      comms: { type: 'clips', maxSeconds: 5, direction: 'one-way', extraSignals: ['repeat'] },
    });
    const clipPuzzle = {
      ...base,
      // Everyone else on the team hears it, tagged with the current move count.
      onClip: (
        state: { moves: number },
        from: string,
        ctx: { players: readonly { id: string }[] },
      ) => ({
        deliveries: ctx.players
          .filter((p) => p.id !== from)
          .map((p) => ({ to: p.id, params: state.moves })),
      }),
    } as unknown as AnyPuzzleServerModule;
    let now = 0;
    const a = inbox();
    const b = inbox();
    const boxes = new Map([
      ['a', a],
      ['b', b],
    ]);
    const engine = new MatchEngine(
      {
        seed: 's',
        puzzles: [clipPuzzle],
        teams: [
          {
            id: 'red',
            name: 'Red',
            players: [
              { id: 'a', name: 'A', seat: 0 },
              { id: 'b', name: 'B', seat: 1 },
            ],
          },
        ],
        timings: TIMINGS,
        now: () => now,
      },
      { send: (id: string, m: ServerMessage) => boxes.get(id)?.send(m) },
    );
    engine.start();
    now = 100;
    engine.tick(); // countdown
    now = 200;
    engine.tick(); // playing
    expect(engine.state.phase).toBe('playing');

    const clip = { mime: 'audio/webm', data: 'AAAA', durationMs: 2000 };
    engine.handleClip('a', clip);
    expect(b.last('comms.clip')).toMatchObject({ from: 'a', data: 'AAAA', params: 0 });
    expect(a.all('comms.clip')).toHaveLength(0);

    engine.handleClip('a', clip);
    expect(a.last('match.reject')?.reason).toMatch(/Wait/);
    now += 3000;
    engine.handleClip('a', { ...clip, durationMs: 9000 });
    expect(a.last('match.reject')?.reason).toMatch(/at most 5 seconds/);

    // 'repeat' re-sends the latest clip to the asker with parameters from the current state.
    engine.handleAction('b', { type: 'tap' });
    engine.handleSignal('b', 'repeat');
    expect(b.all('comms.clip')).toHaveLength(2);
    expect(b.last('comms.clip')).toMatchObject({ from: 'a', params: 1 });
  });

  it('allows surrender only while waiting, ending the match as it stands', () => {
    const { engine, run, act, red } = setup([race, race, race]);
    engine.start();
    run(200);
    act('r1', 'solve');
    run(50);
    expect(engine.surrender()).toMatch(/only surrender while waiting/);
    engine.playerDisconnected('b1');
    expect(engine.surrender()).toBeNull();
    expect(red.last('match.state')?.match).toMatchObject({
      phase: 'finished',
      endedBy: 'surrender',
      paused: null,
      standings: [{ teamId: 'red', score: 1, rank: 1 }, { teamId: 'blue' }],
    });
    expect(engine.surrender()).toMatch(/already over/);
  });
});
