import { createRng, type Context } from '@split-signal/shared';
import { describe, expect, it } from 'vitest';
import { startPuzzle, type PuzzleDriver } from '../harness';
import { BIT, DIRS, distancesFrom, step, type Maze } from '../lib/maze';
import {
  BATTERY,
  MUTE_MS,
  POINTS,
  RADIUS,
  drift,
  hearing,
  litTiles,
  radiusFor,
  smoothRadius,
} from './rules';
import earshot from './server';
import type { Action, Ghost, State, View } from './types';

// Two teams of two. Round 0: seat 0 of each team is the Ghost, seat 1 the Hunter.
const RED_GHOST = 0;
const RED_HUNTER = 1;
const BLUE_GHOST = 2;
const BLUE_HUNTER = 3;

const start = () =>
  startPuzzle(earshot, {
    teams: [2, 2],
    hidden: [
      {
        name: 'where the ghosts are',
        hiddenFrom: (p) => p.seat === 1,
        change: (s: State) => ({
          ...s,
          ghosts: Object.fromEntries(
            Object.entries(s.ghosts).map(([t, g]) => [
              t,
              { ...g, pos: (g.pos + 1) % s.maze.cells.length },
            ]),
          ),
        }),
      },
    ],
  });

/** A context for calling the module directly on a hand-made state. */
function ctxFor(game: PuzzleDriver<State, View, Action>, elapsedMs: number): Context {
  return {
    teamId: 'shared',
    players: game.players,
    teams: game.teams,
    elapsedMs,
    rng: createRng('ctx'),
    comms: {},
  };
}

/** A corridor cell with an open side, for aiming a flashlight. */
function openSpot(maze: Maze): { from: number; dir: (typeof DIRS)[number]; to: number } {
  for (let cell = 0; cell < maze.cells.length; cell++) {
    for (const dir of DIRS) {
      if ((maze.cells[cell]! & BIT[dir]) !== 0)
        return { from: cell, dir, to: step(cell, dir, maze.size)! };
    }
  }
  throw new Error('no open side');
}

describe('earshot rules', () => {
  it('maps loudness to a 2-12 tile radius, smoothed, falling back to 2 when silent', () => {
    expect(radiusFor(-80)).toBe(RADIUS.min);
    expect(radiusFor(-30)).toBe(7);
    expect(radiusFor(0)).toBe(RADIUS.max);
    const ghost = { radius: 2, db: -10, heardAt: 1000 } as Ghost;
    const after = smoothRadius(ghost, 1100, 100);
    expect(after).toBeGreaterThan(2);
    expect(after).toBeLessThan(12);
    expect(smoothRadius({ ...ghost, radius: 12 }, 5000, 100)).toBeLessThan(12);
  });

  it('hears by path through the maze, fading to nothing at the edge; muted ghosts are silent', () => {
    const game = start();
    const maze = game.state.maze;
    const ghost = { ...game.state.ghosts['team-1']!, radius: 6 };
    const dist = distancesFrom(maze, ghost.pos);
    const near = dist.findIndex((d) => d === 2);
    const far = dist.findIndex((d) => d === 9);
    expect(hearing(maze, ghost, near, false, 0)).toEqual({ audible: true, gain: 1 - 2 / 6 });
    expect(hearing(maze, ghost, far, true, 0).audible).toBe(false);
    expect(hearing(maze, { ...ghost, mutedUntil: 5000 }, near, false, 1000).audible).toBe(false);
  });

  it('lights two tiles ahead, stopped by walls, and drifts without turning back', () => {
    const game = start();
    const maze = game.state.maze;
    const { from, dir, to } = openSpot(maze);
    const hunter = { ...game.state.hunters['team-1']!, pos: from, facing: dir, light: true };
    expect(litTiles(maze, hunter)[0]).toBe(to);
    expect(litTiles(maze, { ...hunter, light: false })).toEqual([]);
    const ghost = { ...game.state.ghosts['team-1']!, pos: to, prev: from };
    const options = DIRS.filter((d) => (maze.cells[to]! & BIT[d]) !== 0);
    if (options.length > 1) {
      for (let i = 0; i < 10; i++) expect(drift(maze, ghost, createRng(`d${i}`))).not.toBe(from);
    }
  });
});

describe('earshot', () => {
  it('lets hunters hear ghosts by distance, and ghosts talk without listening', () => {
    const game = start();
    expect(game.commsGate(RED_GHOST)).toEqual({ send: true, receive: false });
    const hunter = game.commsGate(RED_HUNTER);
    expect(hunter.send).toBe(false);
    expect(Object.keys(hunter.peers ?? {}).sort()).toEqual(
      [game.player(RED_GHOST).id, game.player(BLUE_GHOST).id].sort(),
    );
  });

  it('grows a ghost’s radius as it gets louder', () => {
    const game = start();
    for (let i = 0; i < 10; i++) {
      game.act(RED_GHOST, { type: '__micLevel', db: -12 });
      game.advance(100);
    }
    const ghost = game.state.ghosts['team-1']!;
    expect(ghost.radius).toBeGreaterThan(9);
    // Hunters' levels are ignored.
    expect(game.act(RED_HUNTER, { type: '__micLevel', db: 0 }).ok).toBe(true);
  });

  it('runs the flashlight battery down at 20/s and back up at 5/s', () => {
    const game = start();
    game.act(RED_HUNTER, { type: 'flashlight' });
    game.advance(1000);
    expect(game.state.hunters['team-1']!.battery).toBeCloseTo(BATTERY.max - 20, 5);
    game.act(RED_HUNTER, { type: 'flashlight' });
    game.advance(1000);
    expect(game.state.hunters['team-1']!.battery).toBeCloseTo(BATTERY.max - 15, 5);
    expect(game.act(RED_GHOST, { type: 'flashlight' }).ok).toBe(false);
  });

  it('catches only in the beam: +5 for your ghost, +3 and a mute for an enemy’s', () => {
    const game = start();
    const maze = game.state.maze;
    const { from, dir, to } = openSpot(maze);
    const red = game.player(RED_HUNTER).id;
    const setUp = (ghostTeam: string): State => ({
      ...game.state,
      hunters: {
        ...game.state.hunters,
        'team-1': { ...game.state.hunters['team-1']!, pos: from, facing: dir, light: true },
      },
      ghosts: { ...game.state.ghosts, [ghostTeam]: { ...game.state.ghosts[ghostTeam]!, pos: to } },
    });

    const own = earshot.apply(setUp('team-1'), red, { type: 'catch' }, ctxFor(game, 10_000));
    if (!('state' in own)) throw new Error(own.reject);
    expect(own.state.scores['team-1']).toBe(POINTS.own);
    expect(own.state.ghosts['team-1']!.pos).not.toBe(to);
    expect(own.state.ghosts['team-1']!.mutedUntil).toBeNull();

    const enemy = earshot.apply(setUp('team-2'), red, { type: 'catch' }, ctxFor(game, 10_000));
    if (!('state' in enemy)) throw new Error(enemy.reject);
    expect(enemy.state.scores['team-1']).toBe(POINTS.enemy);
    expect(enemy.state.ghosts['team-2']!.mutedUntil).toBe(10_000 + MUTE_MS);
    // Straight away again: still recharging.
    expect(earshot.apply(enemy.state, red, { type: 'catch' }, ctxFor(game, 11_000))).toEqual({
      reject: 'Catch recharging',
    });
  });

  it('swaps Ghost and Hunter each round', () => {
    const game = startPuzzle(earshot, { teams: [2, 2], roundIndex: 1 });
    expect(game.view(RED_GHOST).role).toBe('hunter');
    expect(game.view(BLUE_HUNTER).role).toBe('ghost');
  });
});
