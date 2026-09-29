import { describe, expect, it } from 'vitest';
import { startPuzzle, type HiddenInfo } from '../harness';
import { DIRS, MIN_DISTANCE, SIZE, distances, stepFrom, type Cell, type Dir } from './grid';
import { HINT_MS, MOVE_MS, TURN_CAP } from './manifest';
import puzzle from './server';
import type { State } from './types';

// Seats: 0 t1-p1, 1 t1-p2 (team-1); 2 t2-p1, 3 t2-p2 (team-2).
const other = (d: Dir): Dir => DIRS[(DIRS.indexOf(d) + 1) % 4]!;

const hidden: HiddenInfo<State>[] = [
  {
    name: 'your own target',
    hiddenFrom: (p) => p.id === 't1-p1',
    change: (state) => {
      const t = state.targets['t1-p1']!;
      const moved = [...distances(state.grid, t).keys()].find((k) => k !== `${t.x},${t.y}`)!;
      const [x, y] = moved.split(',').map(Number);
      return { ...state, targets: { ...state.targets, 't1-p1': { x: x!, y: y! } } };
    },
    until: (state) => state.over,
  },
  {
    name: 'who sent which hint',
    hiddenFrom: (p) => p.id !== 't2-p1' && p.id !== 't2-p2',
    change: (state) => {
      const to = state.hints['t1-p1']!;
      return {
        ...state,
        hints: { ...state.hints, 't1-p1': { ...to, 't2-p1': to['t2-p2']!, 't2-p2': to['t2-p1']! } },
      };
    },
    until: (state) => {
      const to = state.hints['t1-p1'];
      return !to?.['t2-p1'] || !to['t2-p2'] || to['t2-p1'] === to['t2-p2'];
    },
  },
  {
    name: 'a hint before the reveal',
    hiddenFrom: (p) => p.id !== 't2-p2',
    change: (state) => {
      const to = state.hints['t1-p2']!;
      return {
        ...state,
        hints: { ...state.hints, 't1-p2': { ...to, 't2-p2': other(to['t2-p2']!) } },
      };
    },
    // Once revealed, the recipient sees the shuffled hints, not this.
    until: (state) => !state.hints['t1-p2']?.['t2-p2'] || state.phase === 'move',
  },
  {
    name: 'a move before everyone moves',
    hiddenFrom: (p) => p.id !== 't2-p1',
    change: (state) => ({
      ...state,
      moves: { ...state.moves, 't2-p1': state.moves['t2-p1'] === 'stay' ? 'up' : 'stay' },
    }),
    until: (state) => !('t2-p1' in state.moves),
  },
];

/** Shortest moves from a cell to another on the grid. */
function route(grid: string[], from: Cell, to: Cell): Dir[] {
  const prev = new Map<string, [string, Dir] | null>([[`${from.x},${from.y}`, null]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    for (const dir of DIRS) {
      const n = stepFrom(grid, queue[i]!, dir);
      const k = `${n.x},${n.y}`;
      if (prev.has(k)) continue;
      prev.set(k, [`${queue[i]!.x},${queue[i]!.y}`, dir]);
      queue.push(n);
    }
  }
  const dirs: Dir[] = [];
  for (let k = `${to.x},${to.y}`; prev.get(k); k = prev.get(k)![0]) dirs.unshift(prev.get(k)![1]);
  return dirs;
}

describe('bad advice', () => {
  it('shows everyone else’s target, never your own', () => {
    const game = startPuzzle(puzzle, { teams: [2, 2], hidden });
    const view = game.view(0);
    expect(view.boards.find((b) => b.playerId === 't1-p1')?.target).toBeNull();
    expect(view.boards.find((b) => b.playerId === 't2-p1')?.target).toEqual(
      game.state.targets['t2-p1'],
    );
    expect(view.boards.find((b) => b.playerId === 't1-p2')?.target).toEqual(
      game.state.targets['t1-p2'],
    );
    expect(game.reveal(0)?.boards[0]?.target).toEqual(game.state.targets['t1-p1']);
  });

  it('builds a connected grid with starts far from targets', () => {
    for (let i = 0; i < 40; i++) {
      const { state } = startPuzzle(puzzle, { teams: [2, 2, 2], seed: `grid-${i}` });
      expect(state.grid).toHaveLength(SIZE);
      const open = state.grid.join('').split('.').length - 1;
      const first = state.pieces['t1-p1']!;
      expect(distances(state.grid, first).size).toBe(open);
      for (const p of state.players) {
        const d = distances(state.grid, state.pieces[p.id]!).get(
          `${state.targets[p.id]!.x},${state.targets[p.id]!.y}`,
        );
        expect(d).toBeGreaterThanOrEqual(MIN_DISTANCE);
      }
    }
  });

  it('collects hints secretly, then reveals each player’s shuffled set', () => {
    const game = startPuzzle(puzzle, { teams: [2, 2], hidden });
    game.signal(2, 'up', 0);
    game.signal(3, 'left', 0);
    expect(game.view(2).sent).toEqual({ 't1-p1': 'up' });
    expect(game.view(0)).toMatchObject({ phase: 'hint', received: null, sent: {} });
    // Hints to yourself, without a target, or off the list go nowhere.
    game.signal(0, 'up', 0);
    game.signal(0, 'up');
    game.signal(0, 'sideways', 1);
    expect(game.state.hints['t1-p1']).toEqual({ 't2-p1': 'up', 't2-p2': 'left' });

    // Everyone hints everyone: the reveal comes early.
    for (let from = 0; from < 4; from++) {
      for (let to = 0; to < 4; to++) if (from !== to) game.signal(from, 'down', to);
    }
    expect(game.state.phase).toBe('move');
    expect(game.view(0).received).toEqual(['down', 'down', 'down']);
  });

  it('reveals on the clock if not everyone hints', () => {
    const game = startPuzzle(puzzle, { teams: [2, 2], hidden });
    game.signal(1, 'right', 0);
    game.signal(2, 'up', 0);
    game.advance(HINT_MS);
    expect(game.state.phase).toBe('move');
    expect([...game.view(0).received!].sort()).toEqual(['right', 'up']);
    expect(game.view(1).received).toEqual([]);
    // No more hints once the moves start.
    game.signal(3, 'up', 0);
    expect(game.view(0).received).toHaveLength(2);
  });

  it('moves everyone at once, walls blocking, then starts a new turn', () => {
    const game = startPuzzle(puzzle, { teams: [2, 2], hidden });
    game.advance(HINT_MS);
    const before = { ...game.state.pieces };
    game.act(0, { type: 'move', dir: 'up' });
    game.act(1, { type: 'move', dir: 'stay' });
    game.act(2, { type: 'move', dir: 'left' });
    expect(game.state.pieces).toEqual(before);
    expect(game.view(3).moved).toEqual(['t1-p1', 't1-p2', 't2-p1']);
    game.act(3, { type: 'move', dir: 'down' });
    expect(game.state).toMatchObject({ phase: 'hint', turn: 1 });
    expect(game.state.pieces['t1-p1']).toEqual(stepFrom(game.state.grid, before['t1-p1']!, 'up'));
    expect(game.state.pieces['t1-p2']).toEqual(before['t1-p2']);
    expect(game.act(0, { type: 'move', dir: 'up' })).toMatchObject({ ok: false });
  });

  it('finishes when both teammates reach home, first team wins', () => {
    const game = startPuzzle(puzzle, { teams: [2, 2], hidden });
    const paths = Object.fromEntries(
      ['t1-p1', 't1-p2'].map((id) => [
        id,
        route(game.state.grid, game.state.pieces[id]!, game.state.targets[id]!),
      ]),
    );
    for (let turn = 0; !game.solved; turn++) {
      expect(turn).toBeLessThan(TURN_CAP);
      game.advance(HINT_MS);
      game.act(0, { type: 'move', dir: paths['t1-p1']![turn] ?? 'stay' });
      if (!game.solved && !('t1-p2' in game.state.home)) {
        game.act(1, { type: 'move', dir: paths['t1-p2']![turn] ?? 'stay' });
      }
      if (!game.solved) game.advance(MOVE_MS);
    }
    const score = game.score();
    expect(score.teams?.['team-1']).toMatchObject({ solved: true, points: 33 });
    expect(score.teams?.['team-2']).toMatchObject({ solved: false });
  });

  it('stops at the turn cap and scores how close each team got', () => {
    const game = startPuzzle(puzzle, { teams: [2, 2] });
    for (let t = 0; t < TURN_CAP; t++) game.advance(HINT_MS + MOVE_MS);
    expect(game.solved).toBe(true);
    const left = (ids: string[]) =>
      ids.reduce(
        (sum, id) =>
          sum +
          Math.abs(game.state.pieces[id]!.x - game.state.targets[id]!.x) +
          Math.abs(game.state.pieces[id]!.y - game.state.targets[id]!.y),
        0,
      );
    expect(game.score().teams).toEqual({
      'team-1': { solved: false, points: 33 - left(['t1-p1', 't1-p2']) },
      'team-2': { solved: false, points: 33 - left(['t2-p1', 't2-p2']) },
    });
  });
});
