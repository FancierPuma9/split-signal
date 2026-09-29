import type { PuzzleServerModule } from '@split-signal/shared';
import { describe, expect, it } from 'vitest';
import { HarnessError, deepEqual, runPuzzleScript, startPuzzle } from './index';

interface State {
  secret: number;
  count: number;
}
type Action = { type: 'bump' };

const manifest = {
  id: 'fixture',
  name: 'Fixture',
  description: 'Harness fixture.',
  teams: { min: 1, max: 2 },
  playersPerTeam: { min: 1, max: 2 },
  winCondition: 'race',
  timeLimitSeconds: 30,
  comms: { type: 'none' },
} as const satisfies PuzzleServerModule<State, unknown, Action>['manifest'];

function fixture(
  overrides: Partial<PuzzleServerModule<State, unknown, Action>> = {},
): PuzzleServerModule<State, unknown, Action> {
  return {
    manifest,
    init: ({ rng }) => ({ secret: rng.int(1, 100), count: 0 }),
    view: (state, playerId, ctx) =>
      ctx.players[0]?.id === playerId
        ? { count: state.count, secret: state.secret }
        : { count: state.count },
    apply: (state) => ({ state: { ...state, count: state.count + 1 } }),
    isSolved: (state) => state.count >= 2,
    score: (state) => ({ moves: state.count }),
    ...overrides,
  };
}

const hideSecret = [
  {
    name: 'the secret',
    hiddenFrom: (p: { seat: number }) => p.seat !== 0,
    change: (s: State) => ({ ...s, secret: s.secret + 1 }),
  },
];

describe('harness', () => {
  it('runs a passing script', () => {
    const game = runPuzzleScript(fixture(), {
      players: 2,
      hidden: hideSecret,
      steps: [
        { seat: 0, action: { type: 'bump' } },
        { seat: 1, action: { type: 'bump' } },
      ],
      expectScore: { moves: 2 },
    });
    expect(game.solved).toBe(true);
  });

  it('catches a view that leaks hidden info', () => {
    const leaky = fixture({ view: (state) => ({ count: state.count, secret: state.secret }) });
    expect(() => startPuzzle(leaky, { players: 2, hidden: hideSecret })).toThrow(
      /leaks "the secret"/,
    );
  });

  it('catches a leak that only appears after an action', () => {
    const leaky = fixture({
      view: (state) => (state.count > 0 ? { hint: state.secret % 2 } : { hint: null }),
    });
    const game = startPuzzle(leaky, { players: 2, hidden: hideSecret });
    expect(() => game.act(1, { type: 'bump' })).toThrow(/leaks/);
  });

  it('catches state mutation', () => {
    const mutating = fixture({
      apply: (state) => {
        state.count += 1;
        return { state };
      },
    });
    const game = startPuzzle(mutating, { players: 1 });
    expect(() => game.act(0, { type: 'bump' })).toThrow(/state is frozen/);
  });

  it('catches non-deterministic init', () => {
    // eslint-disable-next-line no-restricted-properties -- deliberately broken fixture
    const random = fixture({ init: () => ({ secret: Math.random(), count: 0 }) });
    expect(() => startPuzzle(random, { players: 1 })).toThrow(/not deterministic/);
  });

  it('catches non-JSON views', () => {
    const bad = fixture({ view: () => ({ seen: new Set([1]) }) });
    expect(() => startPuzzle(bad, { players: 1 })).toThrow(/not plain JSON/);
  });

  it('rejects unsupported team sizes', () => {
    expect(() => startPuzzle(fixture(), { players: 3 })).toThrow(/supports 1-2 players/);
  });

  it('fails scripts whose expectations are wrong', () => {
    const run = () =>
      runPuzzleScript(fixture(), {
        players: 1,
        steps: [{ seat: 0, action: { type: 'bump' } }],
      });
    expect(run).toThrow(HarnessError);
    expect(run).toThrow(/expected solved=true/);
  });

  it('flags a change() that changes nothing', () => {
    const useless = [{ name: 'nothing', hiddenFrom: () => true, change: (s: State) => s }];
    expect(() => startPuzzle(fixture(), { players: 1, hidden: useless })).toThrow(/identical/);
  });

  it('ticks on the simulated clock', () => {
    let ticks = 0;
    const ticking = fixture({
      tick: (state, nowMs) => {
        ticks++;
        return nowMs >= 500 && state.count === 0 ? { ...state, count: 1 } : state;
      },
    });
    const game = startPuzzle(ticking, { players: 1 });
    game.advance(1000);
    expect(ticks).toBe(10);
    expect(game.state.count).toBe(1);
    expect(game.elapsedMs).toBe(1000);
  });
});

describe('deepEqual', () => {
  it('compares JSON-like data structurally', () => {
    expect(deepEqual({ a: [1, { b: 2 }] }, { a: [1, { b: 2 }] })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 1, b: undefined })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepEqual([1, 2], { 0: 1, 1: 2 })).toBe(false);
    expect(deepEqual(new Map(), {})).toBe(false);
  });
});
