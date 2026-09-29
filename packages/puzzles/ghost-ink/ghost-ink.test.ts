import { describe, expect, it } from 'vitest';
import { startPuzzle, type HiddenInfo } from '../harness';
import { PALETTE } from './scene';
import puzzle, { MAX_DISTANCE, SCENE_SIZE, accuracy, distance } from './server';
import type { DrawerView, PlacerView, State } from './types';

const hidden: HiddenInfo<State>[] = [
  {
    name: 'the target scene',
    hiddenFrom: (player) => player.seat !== 0,
    change: (state) => ({
      ...state,
      target: Object.fromEntries(
        Object.entries(state.target).map(([id, p]) => [id, { x: 1 - p.x, y: 1 - p.y }]),
      ),
    }),
    until: (state) => state.submittedAt !== null,
  },
];

const placeAll = (state: State) =>
  Object.entries(state.target).map(([objectId, p]) => ({ type: 'place' as const, objectId, ...p }));

describe('ghost ink', () => {
  it('gives the Drawer the scene and the pen, and the Placer the palette', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    const drawer = game.view(0) as DrawerView;
    const placer = game.view(1) as PlacerView;
    expect(drawer).toMatchObject({ role: 'drawer', canDraw: true, result: null });
    expect(Object.keys(drawer.target).length).toBeGreaterThanOrEqual(SCENE_SIZE.min);
    expect(placer).toMatchObject({ role: 'placer', canDraw: false, submitted: false });
    expect(placer).not.toHaveProperty('target');
    expect([...placer.mine].sort()).toEqual(PALETTE.map((o) => o.id).sort());
  });

  it('rotates the Drawer with the round', () => {
    const game = startPuzzle(puzzle, { players: 2, roundIndex: 1 });
    expect(game.view(0).role).toBe('placer');
    expect(game.view(1).role).toBe('drawer');
  });

  it('builds spread-out scenes from a subset of the palette', () => {
    for (let i = 0; i < 40; i++) {
      const { state } = startPuzzle(puzzle, { players: 2, seed: `scene-${i}` });
      const spots = Object.values(state.target);
      expect(spots.length).toBeGreaterThanOrEqual(SCENE_SIZE.min);
      expect(spots.length).toBeLessThanOrEqual(SCENE_SIZE.max);
      for (const [a, spot] of spots.entries()) {
        expect(spot.x).toBeGreaterThan(0.05);
        expect(spot.x).toBeLessThan(0.95);
        expect(spot.y).toBeGreaterThan(0.05);
        expect(spot.y).toBeLessThan(0.95);
        for (const other of spots.slice(a + 1)) expect(distance(spot, other)).toBeGreaterThan(0.19);
      }
    }
  });

  it('scores a perfect rebuild at 100 and unplaced objects at 0', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    const [first, ...rest] = placeAll(game.state);
    for (const action of rest) game.act(1, action);
    expect(game.score().points).toBeLessThan(100);
    game.act(1, first!);
    expect(game.score()).toEqual({ points: 100 });
  });

  it('scales accuracy with distance, bottoming out at half the diagonal', () => {
    const target = { x: 0.5, y: 0.5 };
    expect(accuracy(target, target)).toBe(1);
    expect(accuracy({ x: 0.5, y: 0.5 + MAX_DISTANCE / 2 }, target)).toBeCloseTo(0.5);
    expect(accuracy({ x: 1, y: 1 }, { x: 0, y: 0 })).toBe(0);
    expect(accuracy(undefined, target)).toBe(0);
  });

  it('ignores placed objects that are not in the scene', () => {
    const game = startPuzzle(puzzle, { players: 2 });
    for (const action of placeAll(game.state)) game.act(1, action);
    const extra = PALETTE.find((o) => !(o.id in game.state.target))!;
    game.act(1, { type: 'place', objectId: extra.id, x: 0.5, y: 0.5 });
    expect(game.score()).toEqual({ points: 100 });
  });

  it('places, moves and removes, and rejects the rest', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    expect(game.act(1, { type: 'move', objectId: 'tree', x: 0.5, y: 0.5 })).toMatchObject({
      ok: false,
    });
    expect(game.act(1, { type: 'place', objectId: 'tree', x: 0.2, y: 0.3 })).toMatchObject({
      ok: true,
    });
    expect(game.act(1, { type: 'place', objectId: 'tree', x: 0.2, y: 0.3 })).toMatchObject({
      ok: false,
    });
    game.act(1, { type: 'move', objectId: 'tree', x: 0.6, y: 0.7 });
    expect(game.view(0).placed).toEqual({ tree: { x: 0.6, y: 0.7 } });
    game.act(1, { type: 'remove', objectId: 'tree' });
    expect(game.view(1).placed).toEqual({});

    expect(game.act(1, { type: 'place', objectId: 'tree', x: 1.2, y: 0 })).toMatchObject({
      ok: false,
    });
    expect(game.act(1, { type: 'place', objectId: 'rocket', x: 0, y: 0 })).toMatchObject({
      ok: false,
    });
    expect(game.act(0, { type: 'place', objectId: 'tree', x: 0, y: 0 })).toMatchObject({
      ok: false,
    });
  });

  it('reveals the scene to everyone on submit and locks placements', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    game.act(1, { type: 'place', objectId: 'tree', x: 0.5, y: 0.5 });
    game.advance(4000);
    game.act(1, { type: 'submit' });
    expect(game.solved).toBe(true);
    const view = game.view(1);
    expect(view.result?.target).toEqual(game.state.target);
    expect(view.result?.score).toBe(game.score().points);
    expect(game.state.submittedAt).toBe(4000);
    expect(game.act(1, { type: 'remove', objectId: 'tree' })).toMatchObject({ ok: false });
  });

  it('reveals the result at the end of the round even without a submit', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    const [first] = placeAll(game.state);
    game.act(1, first!);
    expect(game.view(1).result).toBeNull();
    const reveal = game.reveal(1);
    expect(reveal?.result?.target).toEqual(game.state.target);
    expect(reveal?.result?.accuracy[first!.objectId]).toBe(1);
    expect(reveal?.result?.score).toBe(game.score().points);
  });

  describe('with three players', () => {
    it('splits the palette between the two Placers', () => {
      const game = startPuzzle(puzzle, { players: 3, hidden });
      const a = (game.view(1) as PlacerView).mine;
      const b = (game.view(2) as PlacerView).mine;
      expect(a).toHaveLength(6);
      expect(b).toHaveLength(6);
      expect(a.filter((id) => b.includes(id))).toEqual([]);
      expect(game.act(1, { type: 'place', objectId: b[0]!, x: 0.5, y: 0.5 })).toMatchObject({
        ok: false,
      });
    });

    it('waits for both Placers to submit', () => {
      const game = startPuzzle(puzzle, { players: 3, hidden });
      game.act(1, { type: 'submit' });
      expect(game.solved).toBe(false);
      expect(game.view(2)).toMatchObject({ ready: 1, placers: 2, submitted: false });
      expect(game.act(1, { type: 'submit' })).toMatchObject({ ok: false });
      game.act(2, { type: 'submit' });
      expect(game.solved).toBe(true);
    });
  });
});
