import { describe, expect, it } from 'vitest';
import { startPuzzle, type HiddenInfo } from '../harness';
import { BUILD_MS, PIECES, SORT_MS } from './manifest';
import puzzle, { points } from './server';
import { MATERIALS, loads, settle, shortest, type Material, type Piece } from './tower';
import type { BuilderView, SorterView, State } from './types';

const pieces = (...ms: Material[]): Piece[] => ms.map((material, id) => ({ id, material }));
const swapMaterial = (m: Material): Material => (m === 'wood' ? 'steel' : 'wood');

const hidden: HiddenInfo<State>[] = [
  {
    name: 'the materials',
    hiddenFrom: (p) => p.seat !== 0,
    change: (state) => ({
      ...state,
      remaining: state.remaining.map((p) => ({ ...p, material: swapMaterial(p.material) })),
      columns: state.columns.map((set) =>
        set.map((c) => c.map((p) => ({ ...p, material: swapMaterial(p.material) }))),
      ),
    }),
  },
];

describe('swap stack: the tower', () => {
  it('puts the weight of everything above on each piece', () => {
    expect(loads(pieces('steel', 'iron', 'wood'))).toEqual([4, 1, 0]);
  });

  it('breaks the lowest overloaded piece and drops everything above it', () => {
    // Concrete (5) on wood (strength 2): the wood goes, and the concrete with it.
    expect(settle(pieces('steel', 'wood', 'concrete'))).toEqual({
      column: pieces('steel'),
      fell: 2,
    });
    // Steel carries 8: iron + concrete (3 + 5) is fine. One more wood makes 9 and the base gives
    // way; the lowest failure wins, so the whole column comes down.
    expect(settle(pieces('steel', 'iron', 'concrete')).fell).toBe(0);
    expect(settle(pieces('steel', 'iron', 'concrete', 'wood')).fell).toBe(4);
  });

  it('keeps the numbers the design set', () => {
    expect(MATERIALS).toEqual({
      wood: { weight: 1, strength: 2 },
      iron: { weight: 3, strength: 5 },
      steel: { weight: 4, strength: 8 },
      concrete: { weight: 5, strength: 6 },
    });
  });

  it('picks the shortest column, leftmost on ties', () => {
    expect(shortest([pieces('wood', 'wood'), pieces('wood'), [], []])).toBe(2);
  });
});

describe('swap stack', () => {
  it('shows the Builder plain wood and the Sorter the truth', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    const sorter = game.view(0) as SorterView;
    const builder = game.view(1) as BuilderView;
    expect(sorter).toMatchObject({ role: 'sorter', phase: 'sort', placed: 0, total: PIECES });
    expect(sorter.queue.map((p) => p.material)).toEqual(
      game.state.remaining.slice(0, 2).map((p) => p.material),
    );
    expect(builder).toMatchObject({ role: 'builder', me: 0, queue: [{ id: 0 }, { id: 1 }] });
    expect(JSON.stringify(builder)).not.toMatch(/wood|iron|steel|concrete/);
  });

  it('swaps the next two pieces, and tells the Builder it happened', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    const [a, b] = game.state.remaining;
    game.act(0, { type: 'swap' });
    expect(game.state.remaining.slice(0, 2)).toEqual([b, a]);
    expect(game.view(1)).toMatchObject({ phase: 'build', lastSort: { piece: 0, swapped: true } });
    game.act(1, { type: 'place', column: 2 });
    expect(game.state.columns[0]![2]).toEqual([b]);
    expect(game.view(1)).toMatchObject({ phase: 'sort', placed: 1 });
    game.act(0, { type: 'keep' });
    expect(game.view(1).lastSort).toEqual({ piece: 1, swapped: false });
  });

  it('keeps the order and places on the shortest column when time runs out', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    const first = game.state.remaining[0];
    game.advance(SORT_MS);
    expect(game.state.phase).toBe('build');
    game.advance(BUILD_MS);
    expect(game.state.columns[0]![0]).toEqual([first]);
    expect(game.state.phase).toBe('sort');
  });

  it('only lets each player do their own job, in their own phase', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    expect(game.act(1, { type: 'swap' })).toMatchObject({ ok: false });
    expect(game.act(1, { type: 'place', column: 0 })).toMatchObject({ ok: false });
    game.act(0, { type: 'keep' });
    expect(game.act(0, { type: 'place', column: 0 })).toMatchObject({ ok: false });
    expect(game.act(0, { type: 'swap' })).toMatchObject({ ok: false });
    expect(game.act(1, { type: 'place', column: 5 })).toMatchObject({ ok: false });
  });

  it('finishes after every piece, scored on the tallest column', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    for (let i = 0; i < PIECES; i++) {
      game.act(0, { type: 'keep' });
      game.act(1, { type: 'place', column: i % 5 });
    }
    expect(game.solved).toBe(true);
    const tallest = Math.max(...game.state.columns[0]!.map((c) => c.length));
    const standing = game.state.columns[0]!.reduce((n, c) => n + c.length, 0);
    expect(game.score()).toEqual({ points: tallest + standing / 100 });
    expect(points(game.state)).toBe(game.score().points);
  });

  it('reports falls to everyone', () => {
    // Search a few seeds for one whose first two pieces break when stacked.
    for (let i = 0; i < 50; i++) {
      const game = startPuzzle(puzzle, { players: 2, seed: `fall-${i}` });
      const [a, b] = game.state.remaining;
      if (settle([a!, b!]).fell === 0) continue;
      for (let k = 0; k < 2; k++) {
        game.act(0, { type: 'keep' });
        game.act(1, { type: 'place', column: 0 });
      }
      expect(game.view(1).lastFall).toEqual({ builder: 0, column: 0, count: 2, piece: 1 });
      expect(game.state.columns[0]![0]).toEqual([]);
      return;
    }
    throw new Error('no falling pair in 50 seeds');
  });

  it('gives two Builders turns on their own columns with three players', () => {
    const game = startPuzzle(puzzle, { players: 3, hidden });
    game.act(0, { type: 'keep' });
    expect(game.act(2, { type: 'place', column: 0 })).toMatchObject({ ok: false });
    game.act(1, { type: 'place', column: 0 });
    game.act(0, { type: 'keep' });
    expect(game.view(2)).toMatchObject({ activeBuilder: 1, me: 1 });
    game.act(2, { type: 'place', column: 0 });
    // A lone piece carries nothing, so it can't fall: one in each Builder's first column.
    expect(game.state.columns.map((set) => set[0]!.length)).toEqual([1, 1]);
  });

  it('rotates the Sorter with the round', () => {
    const game = startPuzzle(puzzle, { players: 2, roundIndex: 1 });
    expect(game.view(0).role).toBe('builder');
    expect(game.view(1).role).toBe('sorter');
  });
});
