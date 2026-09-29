import { createRng, type Context, type PlayerInfo } from '@split-signal/shared';
import { describe, expect, it } from 'vitest';
import { createTestPlayers, startPuzzle, type HiddenInfo } from '../harness';
import { cellKey, generateTiles, layoutFor, resolveTurn } from './logic';
import puzzle, { TURN_MS } from './server';
import type { Dir, State, Tile } from './types';

const tile = (id: string, x: number, y: number, owner = 'p'): Tile => ({
  id,
  owner,
  label: id,
  pos: { x, y },
  target: { x, y },
});

const resolve = (tiles: Tile[], moves: Array<[string, Dir]>, size = 4) => {
  const { moved, bumped } = resolveTurn(
    tiles,
    moves.map(([tileId, dir]) => ({ tileId, dir })),
    size,
  );
  return { moved: [...moved].sort(), bumped: [...bumped].sort() };
};

describe('resolveTurn', () => {
  it('moves tiles into free cells', () => {
    expect(resolve([tile('a', 0, 0)], [['a', 'right']])).toEqual({ moved: ['a'], bumped: [] });
  });

  it('bumps at the edge of the board', () => {
    expect(resolve([tile('a', 0, 0)], [['a', 'up']])).toEqual({ moved: [], bumped: ['a'] });
  });

  it('bumps into a tile that stays put', () => {
    expect(resolve([tile('a', 0, 0), tile('b', 1, 0)], [['a', 'right']])).toEqual({
      moved: [],
      bumped: ['a'],
    });
  });

  it('lets a tile follow one that is leaving', () => {
    expect(
      resolve(
        [tile('a', 0, 0), tile('b', 1, 0)],
        [
          ['a', 'right'],
          ['b', 'right'],
        ],
      ),
    ).toEqual({ moved: ['a', 'b'], bumped: [] });
  });

  it('fails both tiles when they claim the same square', () => {
    expect(
      resolve(
        [tile('a', 0, 0), tile('b', 2, 0)],
        [
          ['a', 'right'],
          ['b', 'left'],
        ],
      ),
    ).toEqual({ moved: [], bumped: ['a', 'b'] });
  });

  it('fails swaps: tiles cannot pass through each other', () => {
    expect(
      resolve(
        [tile('a', 0, 0), tile('b', 1, 0)],
        [
          ['a', 'right'],
          ['b', 'left'],
        ],
      ),
    ).toEqual({ moved: [], bumped: ['a', 'b'] });
  });

  it('cascades a block down a chain', () => {
    // c is stuck at the edge, so b can't move into c's cell, so a can't move into b's.
    expect(
      resolve(
        [tile('a', 1, 0), tile('b', 2, 0), tile('c', 3, 0)],
        [
          ['a', 'right'],
          ['b', 'right'],
          ['c', 'right'],
        ],
      ),
    ).toEqual({ moved: [], bumped: ['a', 'b', 'c'] });
  });

  it('allows a rotation of three or more tiles', () => {
    // A 2x2 block turning clockwise: each tile moves into the cell the next one is leaving.
    expect(
      resolve(
        [tile('a', 0, 0), tile('b', 1, 0), tile('c', 1, 1), tile('d', 0, 1)],
        [
          ['a', 'right'],
          ['b', 'down'],
          ['c', 'left'],
          ['d', 'up'],
        ],
      ),
    ).toEqual({ moved: ['a', 'b', 'c', 'd'], bumped: [] });
  });

  it('does not depend on submission order', () => {
    const tiles = [tile('a', 0, 0), tile('b', 1, 0), tile('c', 2, 1)];
    const moves: Array<[string, Dir]> = [
      ['a', 'right'],
      ['b', 'down'],
      ['c', 'left'],
    ];
    expect(resolve(tiles, [...moves].reverse())).toEqual(resolve(tiles, moves));
  });
});

describe('generateTiles', () => {
  it('builds a deterministic, valid, scrambled layout sized to the team', () => {
    for (const count of [2, 3, 4]) {
      const players = createTestPlayers(count);
      const a = generateTiles(players, createRng('seed'));
      const b = generateTiles(players, createRng('seed'));
      expect(a).toEqual(b);

      const { size, tilesPerPlayer } = layoutFor(count);
      expect(a.size).toBe(size);
      expect(a.tiles).toHaveLength(count * tilesPerPlayer);
      const positions = new Set(a.tiles.map((t) => cellKey(t.pos)));
      const targets = new Set(a.tiles.map((t) => cellKey(t.target)));
      expect(positions.size).toBe(a.tiles.length);
      expect(targets.size).toBe(a.tiles.length);
      for (const t of a.tiles) {
        expect(t.pos.x).toBeGreaterThanOrEqual(0);
        expect(t.pos.x).toBeLessThan(size);
      }
      const offTarget = a.tiles.filter((t) => cellKey(t.pos) !== cellKey(t.target));
      expect(offTarget.length).toBeGreaterThan(a.tiles.length / 2);
    }
  });
});

// Teammates' tiles must be invisible: moving them anywhere free changes nothing in your view.
const hideTeammateTiles = (seat: number): HiddenInfo<State> => ({
  name: `tiles not owned by seat ${seat}`,
  hiddenFrom: (player) => player.seat === seat,
  change: (state) => {
    const other = state.tiles.find((t) => !t.id.startsWith(`s${seat}-`));
    if (!other) return state;
    const taken = new Set(state.tiles.map((t) => cellKey(t.pos)));
    for (let y = 0; y < state.size; y++) {
      for (let x = 0; x < state.size; x++) {
        if (!taken.has(`${x},${y}`)) {
          return {
            ...state,
            tiles: state.tiles.map((t) =>
              t === other ? { ...t, pos: { x, y }, target: { x, y } } : t,
            ),
          };
        }
      }
    }
    return state;
  },
});

const hidden = [hideTeammateTiles(0), hideTeammateTiles(1)];
const myTile = (state: State, player: PlayerInfo) =>
  state.tiles.find((t) => t.owner === player.id) as Tile;

describe('sliding grid', () => {
  it('shows each player only their own tiles', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    const view = game.view(0);
    expect(view.tiles).toHaveLength(layoutFor(2).tilesPerPlayer);
    const ownIds = game.state.tiles.filter((t) => t.owner === game.player(0).id).map((t) => t.id);
    expect(view.tiles.map((t) => t.id).sort()).toEqual(ownIds.sort());
  });

  it('keeps plans secret until everyone is ready, then resolves the turn', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    const t0 = myTile(game.state, game.player(0));
    expect(game.act(0, { type: 'move', tileId: t0.id, dir: 'up' })).toEqual({
      ok: true,
      changed: true,
    });
    expect(game.view(1)).toMatchObject({ myPlan: null, teammatesReady: 1, turns: 0 });
    expect(JSON.stringify(game.view(1))).not.toContain(t0.id);

    game.act(1, { type: 'pass' });
    expect(game.state.turns).toBe(1);
    expect(game.state.plans).toEqual({});
    const last = game.view(0).last;
    expect([...(last?.moved ?? []), ...(last?.bumped ?? [])]).toEqual([t0.id]);
  });

  it('lets a player change their mind before the turn resolves', () => {
    const game = startPuzzle(puzzle, { players: 3, hidden });
    const t0 = myTile(game.state, game.player(0));
    game.act(0, { type: 'move', tileId: t0.id, dir: 'up' });
    game.act(0, { type: 'move', tileId: t0.id, dir: 'down' });
    expect(game.view(0).myPlan).toEqual({ tileId: t0.id, dir: 'down' });
    expect(game.state.turns).toBe(0);
  });

  it('resolves the turn when the turn timer runs out', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    game.advance(TURN_MS - 100);
    expect(game.state.turns).toBe(0);
    game.advance(100);
    expect(game.state.turns).toBe(1);
    expect(game.state.turnStartedAt).toBe(TURN_MS);
  });

  it("rejects moving someone else's tile and malformed actions", () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    const theirs = myTile(game.state, game.player(1));
    expect(game.act(0, { type: 'move', tileId: theirs.id, dir: 'up' })).toMatchObject({
      ok: false,
    });
    expect(game.act(0, { type: 'move', tileId: theirs.id, dir: 'sideways' as Dir })).toMatchObject({
      ok: false,
    });
  });

  it('is solved when every tile reaches its target, scored in turns', () => {
    const players = createTestPlayers(2);
    const [p0, p1] = players as [PlayerInfo, PlayerInfo];
    const ctx: Context = {
      teamId: 't',
      players,
      teams: [{ id: 't', playerIds: players.map((p) => p.id) }],
      elapsedMs: 0,
      rng: createRng('x'),
      comms: {},
    };
    const state: State = {
      size: 4,
      tiles: [
        { id: 's0-0', owner: p0.id, label: 'A', pos: { x: 0, y: 0 }, target: { x: 1, y: 0 } },
        { id: 's1-0', owner: p1.id, label: 'A', pos: { x: 3, y: 3 }, target: { x: 3, y: 2 } },
      ],
      turns: 4,
      turnStartedAt: 0,
      plans: {},
      last: null,
      solved: false,
    };
    const first = puzzle.apply(state, p0.id, { type: 'move', tileId: 's0-0', dir: 'right' }, ctx);
    if (!('state' in first)) throw new Error(first.reject);
    const second = puzzle.apply(
      first.state,
      p1.id,
      { type: 'move', tileId: 's1-0', dir: 'up' },
      ctx,
    );
    if (!('state' in second)) throw new Error(second.reject);
    expect(puzzle.isSolved(second.state)).toBe(true);
    expect(puzzle.score(second.state)).toEqual({ moves: 5 });
  });
});
