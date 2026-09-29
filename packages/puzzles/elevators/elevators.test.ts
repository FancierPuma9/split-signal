import { createRng } from '@split-signal/shared';
import { describe, expect, it } from 'vitest';
import { startPuzzle, type PuzzleDriver } from '../harness';
import { CAPACITY, generateQueue, resolveTurn } from './logic';
import puzzle, { TURN_MS } from './server';
import type { Action, Group, Pick, State, View } from './types';

const g = (id: string, floor: number, size = 1): Group => ({ id, floor, size });
const pick = (player: string, elevator: number, floor: number) => ({
  player,
  pick: { elevator, floor } as Pick,
});

describe('resolveTurn', () => {
  const queue = [g('a', 3), g('b', 4), g('c', 3), g('d', 5)];

  it('delivers two groups when players split elevators and floors', () => {
    const { trips, remaining } = resolveTurn(
      queue,
      [pick('p1', 0, 3), pick('p2', 1, 4)],
      2,
      CAPACITY,
      createRng('x'),
    );
    expect(trips.map((t) => t.outcome)).toEqual(['served', 'served']);
    expect(trips[0]?.served).toEqual(['a', 'c']); // everyone for floor 3 fits in one car
    expect(remaining.map((r) => r.id)).toEqual(['d']);
  });

  it('serves only one floor when both players pick the same elevator', () => {
    const { trips, remaining } = resolveTurn(
      queue,
      [pick('p1', 0, 3), pick('p2', 0, 4)],
      2,
      CAPACITY,
      createRng('x'),
    );
    expect(trips[0]?.pickedBy).toEqual(['p1', 'p2']);
    expect([3, 4]).toContain(trips[0]?.floor);
    expect(trips[1]?.outcome).toBe('idle');
    expect(remaining.length === 2 || remaining.length === 3).toBe(true);
  });

  it('wastes one trip when two elevators go to the same floor', () => {
    const { trips } = resolveTurn(
      [g('a', 3), g('b', 3, 6)],
      [pick('p1', 0, 3), pick('p2', 1, 3)],
      2,
      CAPACITY,
      createRng('x'),
    );
    expect(trips.map((t) => t.outcome).sort()).toEqual(['blocked', 'served']);
  });

  it('boards in queue order while groups fit', () => {
    const { trips, remaining } = resolveTurn(
      [g('big1', 3, 4), g('big2', 3, 4), g('small', 3, 1)],
      [pick('p1', 0, 3)],
      2,
      CAPACITY,
      createRng('x'),
    );
    expect(trips[0]?.served).toEqual(['big1']);
    expect(remaining.map((r) => r.id)).toEqual(['big2', 'small']);
  });

  it('calls a trip to a floor nobody wants empty', () => {
    const { trips } = resolveTurn([g('a', 3)], [pick('p1', 0, 6)], 2, CAPACITY, createRng('x'));
    expect(trips[0]?.outcome).toBe('empty');
  });
});

describe('generateQueue', () => {
  it('is deterministic, sized to the team, and includes the big pair', () => {
    const a = generateQueue(2, createRng('s'));
    expect(a).toEqual(generateQueue(2, createRng('s')));
    expect(a).toHaveLength(8);
    expect(generateQueue(3, createRng('s'))).toHaveLength(12);
    const bigs = a.filter((x) => x.size === 4);
    expect(bigs.length).toBeGreaterThanOrEqual(2);
    expect(new Set(bigs.map((x) => x.floor)).size).toBeLessThan(bigs.length);
  });
});

type Game = PuzzleDriver<State, View, Action>;

/** A sensible convention: each player takes their own elevator to a different waiting floor. */
function playWell(game: Game) {
  for (let guard = 0; guard < 100 && !game.solved; guard++) {
    const floors = [...new Set(game.state.queue.map((q) => q.floor))];
    game.players.forEach((_, seat) => {
      if (game.solved) return;
      const floor = floors[seat % floors.length] ?? 2;
      game.act(seat, { type: 'pick', elevator: seat, floor });
    });
  }
}

describe('elevators', () => {
  it('shows everyone the same board, but keeps pending picks secret', () => {
    const game = startPuzzle(puzzle, { players: 2 });
    game.act(0, { type: 'pick', elevator: 1, floor: 4 });
    const other = game.view(1);
    expect(other.queue).toEqual(game.view(0).queue);
    expect(other.myPick).toBeNull();
    expect(other.teammatesReady).toBe(1);
    expect(JSON.stringify(other)).not.toContain('"floor":4,"elevator"');
  });

  it('reveals every pick once the turn resolves', () => {
    const game = startPuzzle(puzzle, { players: 2 });
    game.act(0, { type: 'pick', elevator: 0, floor: 3 });
    game.act(1, { type: 'idle' });
    expect(game.view(1).last?.picks).toEqual([
      { player: game.player(0).id, pick: { elevator: 0, floor: 3 } },
      { player: game.player(1).id, pick: 'idle' },
    ]);
  });

  it('treats no pick as idle when the turn timer runs out', () => {
    const game = startPuzzle(puzzle, { players: 2 });
    game.advance(TURN_MS);
    expect(game.state.turns).toBe(1);
    expect(game.state.last?.trips.every((t) => t.outcome === 'idle')).toBe(true);
  });

  it('rejects bad elevators and floors', () => {
    const game = startPuzzle(puzzle, { players: 2 });
    expect(game.act(0, { type: 'pick', elevator: 2, floor: 3 })).toMatchObject({ ok: false });
    expect(game.act(0, { type: 'pick', elevator: 0, floor: 1 })).toMatchObject({ ok: false });
    expect(game.act(0, { type: 'pick', elevator: 0, floor: 7 })).toMatchObject({ ok: false });
  });

  it('is solved when the lobby is empty, scored in turns', () => {
    for (const players of [2, 3]) {
      const game = startPuzzle(puzzle, { players });
      playWell(game);
      expect(game.solved).toBe(true);
      expect(game.score()).toEqual({ moves: game.state.turns });
    }
  });
});
