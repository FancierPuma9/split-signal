import { findPuzzle } from '@split-signal/puzzles';
import type {
  AnyPuzzleServerModule,
  CommsRule,
  PuzzleServerModule,
  ServerMessage,
} from '@split-signal/shared';
import { describe, expect, it } from 'vitest';
import { inbox } from '../test/fixtures';
import { MatchEngine, type MatchTeam } from './match-engine';

const TIMINGS = { introMs: 100, countdownMs: 100, scoreboardMs: 100, defaultRaceGraceMs: 0 };

const teams: MatchTeam[] = [
  {
    id: 'red',
    name: 'Red',
    players: [
      { id: 'r1', name: 'R1', seat: 0 },
      { id: 'r2', name: 'R2', seat: 1 },
    ],
  },
  {
    id: 'blue',
    name: 'Blue',
    players: [
      { id: 'b1', name: 'B1', seat: 0 },
      { id: 'b2', name: 'B2', seat: 1 },
    ],
  },
];

function setup(puzzles: AnyPuzzleServerModule[]) {
  let now = 0;
  const boxes = new Map(['r1', 'r2', 'b1', 'b2'].map((id) => [id, inbox()]));
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
  engine.start();
  run(200); // into the playing phase
  return { engine, run, box: (id: string) => boxes.get(id)! };
}

describe('MatchEngine: shared instances', () => {
  const pressTogether = findPuzzle('press-together')!;

  it('runs one instance for the room and ends the round when a team finishes', () => {
    const { engine, box, run } = setup([pressTogether, pressTogether]);
    expect(box('r1').last('match.view')?.view).toMatchObject({ myTeam: 'red' });
    expect(box('b2').last('match.view')?.view).toMatchObject({ myTeam: 'blue' });

    engine.handleAction('b1', { type: 'press' });
    engine.handleAction('r1', { type: 'press' });
    // Everyone sees everyone's progress in the shared instance.
    expect(box('r2').last('match.view')?.view).toMatchObject({
      teams: [
        { id: 'red', pressed: 1 },
        { id: 'blue', pressed: 1 },
      ],
    });
    run(500);
    engine.handleAction('b2', { type: 'press' });
    expect(engine.state.phase).toBe('scoreboard');
    expect(engine.state.history[0]).toMatchObject({
      outcome: 'won',
      winnerTeamId: 'blue',
      results: [
        { teamId: 'red', solved: false },
        { teamId: 'blue', solved: true },
      ],
    });
    // A fresh instance next round.
    run(300);
    expect(box('r1').last('match.view')?.view).toMatchObject({ iPressed: false });
  });
});

interface SignalState {
  log: Array<{ from: string; signal: string; to?: string }>;
  round: number;
}

function signalPuzzle(comms: CommsRule): AnyPuzzleServerModule {
  const module: PuzzleServerModule<SignalState, SignalState, unknown> = {
    manifest: {
      id: 'signal-test',
      name: 'Signals',
      description: 'Test.',
      teams: { min: 1, max: 3 },
      playersPerTeam: { min: 1, max: 4 },
      winCondition: 'race',
      timeLimitSeconds: 60,
      comms,
      instance: 'shared',
    },
    init: ({ roundIndex }) => ({ log: [], round: roundIndex }),
    view: (state) => state,
    apply: () => ({ reject: 'no' }),
    onSignal: (state, from, signal, _ctx, to) => ({
      ...state,
      log: [...state.log, { from, signal, ...(to ? { to } : {}) }],
    }),
    isSolved: () => false,
    score: () => ({ teams: {} }),
  };
  return module as AnyPuzzleServerModule;
}

describe('MatchEngine: targeted signals', () => {
  it('relays a targeted signal only to its target (and the sender)', () => {
    const { engine, box } = setup([
      signalPuzzle({ type: 'signals', signals: ['up'], cooldownMs: 0 }),
    ]);
    engine.handleSignal('r1', 'up', 'b2');
    expect(box('b2').last('comms.signal')).toEqual({
      type: 'comms.signal',
      from: 'r1',
      signal: 'up',
    });
    expect(box('r1').all('comms.signal')).toHaveLength(1);
    expect(box('r2').all('comms.signal')).toHaveLength(0);
    expect(box('b1').all('comms.signal')).toHaveLength(0);
    expect(box('r1').last('match.view')?.view).toMatchObject({
      log: [{ from: 'r1', signal: 'up', to: 'b2' }],
    });
  });

  it('never relays signals the puzzle consumes itself, keeping senders anonymous', () => {
    const { engine, box } = setup([
      signalPuzzle({ type: 'signals', signals: ['up'], cooldownMs: 0, relay: false }),
    ]);
    engine.handleSignal('r1', 'up', 'b2');
    for (const id of ['r1', 'r2', 'b1', 'b2']) expect(box(id).all('comms.signal')).toHaveLength(0);
    expect(box('b2').last('match.view')?.view).toMatchObject({ log: [{ to: 'b2' }] });
  });

  it('passes the round index to init', () => {
    const puzzle = signalPuzzle({ type: 'none' });
    const { engine, box, run } = setup([puzzle, puzzle]);
    expect(box('r1').last('match.view')?.view).toMatchObject({ round: 0 });
    run(60_000 + 100 + 200);
    expect(engine.state.round).toBe(1);
    expect(box('r1').last('match.view')?.view).toMatchObject({ round: 1 });
  });
});

describe('MatchEngine: reveal', () => {
  const revealing: PuzzleServerModule<{ secret: number }, unknown, unknown> = {
    manifest: {
      id: 'reveal-test',
      name: 'Reveal',
      description: 'Test.',
      teams: { min: 1, max: 3 },
      playersPerTeam: { min: 1, max: 4 },
      winCondition: 'race',
      timeLimitSeconds: 5,
      comms: { type: 'none' },
    },
    init: () => ({ secret: 7 }),
    view: () => ({ hidden: true }),
    reveal: (state, playerId) => ({ secret: state.secret, you: playerId }),
    apply: () => ({ reject: 'no' }),
    isSolved: () => false,
    score: () => ({}),
  };

  it('sends each player the reveal once the scoreboard is up, and again on reconnect', () => {
    const { engine, box, run } = setup([revealing as AnyPuzzleServerModule]);
    expect(box('r1').all('match.reveal')).toHaveLength(0);
    run(5000);
    expect(engine.state.phase).toBe('scoreboard');
    expect(box('r1').last('match.reveal')).toEqual({
      type: 'match.reveal',
      round: 0,
      view: { secret: 7, you: 'r1' },
    });
    expect(box('b2').last('match.reveal')?.view).toEqual({ secret: 7, you: 'b2' });
    engine.playerDisconnected('b2');
    engine.playerReconnected('b2');
    expect(box('b2').all('match.reveal')).toHaveLength(2);
  });

  it('sends nothing for puzzles without reveal()', () => {
    const { box, run } = setup([signalPuzzle({ type: 'none' })]);
    run(60_000);
    expect(box('r1').all('match.reveal')).toHaveLength(0);
  });
});

interface PointsState {
  points: number;
  submitted: boolean;
}

describe('MatchEngine: points', () => {
  const pointsPuzzle: PuzzleServerModule<
    PointsState,
    PointsState,
    { type: 'set' | 'submit'; n?: number }
  > = {
    manifest: {
      id: 'points',
      name: 'Points',
      description: 'Test.',
      teams: { min: 1, max: 3 },
      playersPerTeam: { min: 1, max: 4 },
      winCondition: 'compare',
      timeLimitSeconds: 10,
      comms: { type: 'none' },
    },
    init: () => ({ points: 0, submitted: false }),
    view: (state) => state,
    apply: (state, _p, action) =>
      action.type === 'submit'
        ? { state: { ...state, submitted: true } }
        : { state: { ...state, points: action.n ?? 0 } },
    isSolved: (state) => state.submitted,
    score: (state) => ({ points: state.points }),
  };

  it('ranks by points, counting teams that ran out of time', () => {
    const { engine, run } = setup([pointsPuzzle as AnyPuzzleServerModule]);
    engine.handleAction('r1', { type: 'set', n: 40 });
    engine.handleAction('r1', { type: 'submit' });
    engine.handleAction('b1', { type: 'set', n: 70 }); // never submits
    run(10_000);
    expect(engine.state.history[0]).toMatchObject({ outcome: 'won', winnerTeamId: 'blue' });
  });

  it('breaks equal points by who finished first', () => {
    const { engine, run } = setup([pointsPuzzle as AnyPuzzleServerModule]);
    engine.handleAction('b1', { type: 'set', n: 50 });
    engine.handleAction('b1', { type: 'submit' });
    run(1000);
    engine.handleAction('r1', { type: 'set', n: 50 });
    engine.handleAction('r1', { type: 'submit' });
    expect(engine.state.history[0]).toMatchObject({ outcome: 'won', winnerTeamId: 'blue' });
  });

  it('breaks a tie between teams that never finish on the time the puzzle reports', () => {
    // Never solved; 'submit' just marks an earlier tie-break time.
    const timed = {
      ...pointsPuzzle,
      isSolved: () => false,
      score: (state: PointsState) => ({ points: state.points, elapsedMs: state.submitted ? 3 : 8 }),
    } as unknown as AnyPuzzleServerModule;
    const { engine, run } = setup([timed]);
    engine.handleAction('r1', { type: 'set', n: 2 });
    engine.handleAction('b1', { type: 'set', n: 2 });
    engine.handleAction('b1', { type: 'submit' });
    run(10_000);
    expect(engine.state.history[0]).toMatchObject({ outcome: 'won', winnerTeamId: 'blue' });
    expect(engine.state.history[0]?.results).toEqual([
      { teamId: 'red', solved: false, points: 2, elapsedMs: 8 },
      { teamId: 'blue', solved: false, points: 2, elapsedMs: 3 },
    ]);
  });

  it('calls a round where nobody scored unsolved', () => {
    const { engine, run } = setup([pointsPuzzle as AnyPuzzleServerModule]);
    run(10_000);
    expect(engine.state.history[0]).toMatchObject({ outcome: 'unsolved', winnerTeamId: null });
  });
});
