import type { PlayerInfo, PuzzleServerModule } from '@split-signal/shared';
import { describe, expect, it, vi } from 'vitest';
import { PuzzleRuntime, type RuntimeHooks } from './puzzle-runtime';

interface State {
  a: number;
  b: number;
}
type Action = { field: 'a' | 'b' } | { field: 'crash' };

const module: PuzzleServerModule<State, { mine: number }, Action> = {
  manifest: {
    id: 'split-counter',
    name: 'Split Counter',
    description: 'Each player bumps their own counter.',
    teams: { min: 1, max: 1 },
    playersPerTeam: { min: 2, max: 2 },
    winCondition: 'race',
    timeLimitSeconds: 60,
    comms: { type: 'none' },
  },
  init: () => ({ a: 0, b: 0 }),
  view: (state, playerId) => ({ mine: playerId === 'p1' ? state.a : state.b }),
  apply: (state, _playerId, action) => {
    if (action.field === 'crash') throw new Error('boom');
    return { state: { ...state, [action.field]: state[action.field] + 1 } };
  },
  isSolved: (state) => state.a + state.b >= 3,
  score: (state) => ({ moves: state.a + state.b }),
};

const players: PlayerInfo[] = [
  { id: 'p1', name: 'One', seat: 0 },
  { id: 'p2', name: 'Two', seat: 1 },
];

function setup() {
  const hooks = {
    sendView: vi.fn(),
    sendReject: vi.fn(),
    onSolved: vi.fn(),
    onError: vi.fn(),
  } satisfies RuntimeHooks;
  const runtime = new PuzzleRuntime(
    module,
    { seed: 's', teamId: 't', players, clock: () => 0 },
    hooks,
  );
  return { runtime, hooks };
}

describe('PuzzleRuntime', () => {
  it('sends every player their view on start', () => {
    const { runtime, hooks } = setup();
    runtime.start();
    expect(hooks.sendView.mock.calls).toEqual([
      ['p1', { mine: 0 }],
      ['p2', { mine: 0 }],
    ]);
  });

  it('only sends views that changed', () => {
    const { runtime, hooks } = setup();
    runtime.start();
    hooks.sendView.mockClear();
    runtime.handleAction('p1', { field: 'a' });
    expect(hooks.sendView.mock.calls).toEqual([['p1', { mine: 1 }]]);
  });

  it('sends rejections and reports module errors', () => {
    const { runtime, hooks } = setup();
    runtime.handleAction('p1', { field: 'crash' });
    expect(hooks.sendReject).toHaveBeenCalledWith('p1', 'Invalid action');
    expect(hooks.onError).toHaveBeenCalledOnce();
  });

  it('reports solved exactly once', () => {
    const { runtime, hooks } = setup();
    runtime.start();
    runtime.handleAction('p1', { field: 'a' });
    runtime.handleAction('p2', { field: 'b' });
    runtime.handleAction('p2', { field: 'b' });
    expect(hooks.onSolved).toHaveBeenCalledOnce();
    runtime.handleAction('p1', { field: 'a' });
    expect(hooks.onSolved).toHaveBeenCalledOnce();
    expect(runtime.score()).toEqual({ moves: 3 });
  });

  it('re-sends a view on request even if unchanged', () => {
    const { runtime, hooks } = setup();
    runtime.start();
    hooks.sendView.mockClear();
    runtime.resendView('p2');
    expect(hooks.sendView.mock.calls).toEqual([['p2', { mine: 0 }]]);
  });
});
