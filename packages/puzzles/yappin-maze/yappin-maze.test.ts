import { createRng } from '@split-signal/shared';
import { describe, expect, it } from 'vitest';
import { startPuzzle } from '../harness';
import {
  BIT,
  DIRS,
  JUNCTIONS,
  countJunctions,
  generateMaze,
  openSides,
  solution,
  step,
  towardExit,
  type Maze,
} from './maze';
import yappinMaze, { REPLAY_GAP_MS, WINDOW, replayWindows } from './server';
import type { State } from './types';

/** Every cell reachable, with exactly cells - 1 passages: one route between any two cells. */
function isPerfect(maze: Maze): boolean {
  let passages = 0;
  maze.cells.forEach((bits) => {
    passages += DIRS.filter((d) => bits & BIT[d]).length;
  });
  const seen = new Set([0]);
  const queue = [0];
  while (queue.length) {
    const cell = queue.pop()!;
    for (const d of openSides(maze, cell)) {
      const next = step(cell, d, maze.size)!;
      if (!seen.has(next)) {
        seen.add(next);
        queue.push(next);
      }
    }
  }
  return seen.size === maze.cells.length && passages / 2 === maze.cells.length - 1;
}

describe('yappin maze mazes', () => {
  it('makes perfect 15x15 mazes with 25-35 junctions, corner to corner', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f']) {
      const maze = generateMaze(createRng(seed));
      expect(isPerfect(maze)).toBe(true);
      expect(countJunctions(maze)).toBeGreaterThanOrEqual(JUNCTIONS.min);
      expect(countJunctions(maze)).toBeLessThanOrEqual(JUNCTIONS.max);
      expect(maze.start + maze.exit).toBe(maze.cells.length - 1);
      const path = solution(maze);
      expect(path[0]).toBe(maze.start);
      expect(path.at(-1)).toBe(maze.exit);
      expect(generateMaze(createRng(seed))).toEqual(maze);
    }
  });

  it('knows the way out from every cell', () => {
    const maze = generateMaze(createRng('toward'));
    const toward = towardExit(maze);
    for (let cell = 0; cell < maze.cells.length; cell++) {
      let at = cell;
      for (let steps = 0; at !== maze.exit && steps < 300; steps++)
        at = step(at, toward[at]!, maze.size)!;
      expect(at).toBe(maze.exit);
    }
  });
});

describe('yappin maze replays', () => {
  it('picks earlier turns that would be wrong here, newest first, within the buffer', () => {
    const turns = [
      { cell: 1, dir: 'n' as const, at: 5000 },
      { cell: 2, dir: 'e' as const, at: 20_000 },
      { cell: 3, dir: 'n' as const, at: 30_000 },
    ];
    expect(replayWindows(turns, (d) => d !== 'e', 40_000)).toEqual([
      { windowStartMs: 30_000 - WINDOW.before, windowEndMs: 30_000 - WINDOW.until },
      { windowStartMs: 5000 - WINDOW.before, windowEndMs: 5000 - WINDOW.until },
    ]);
    // A minute on, the first turn has fallen out of every client's buffer.
    expect(replayWindows(turns, (d) => d !== 'e', 64_000)).toHaveLength(1);
  });

  it('asks for replays at replay junctions along a real walk, no more than one per 8s', () => {
    const game = startPuzzle(yappinMaze, { players: 2 });
    const me = game.player(0).id;
    const maze = game.state.mazes[me]!;
    const toward = towardExit(maze);
    let lastId = 0;
    let lastAt = -Infinity;
    for (let i = 0; i < 200 && game.state.pos[me] !== maze.exit; i++) {
      game.advance(700);
      const from = game.state.pos[me]!;
      expect(game.act(0, { type: 'move', dir: toward[from]! }).ok).toBe(true);
      const replay = game.commsGate(0).replay;
      if (replay && replay.id !== lastId) {
        const here = game.state.pos[me]!;
        expect(game.state.replayCells[me]).toContain(here);
        expect(game.elapsedMs - lastAt).toBeGreaterThanOrEqual(REPLAY_GAP_MS);
        expect(replay.from).toBe(game.player(1).id);
        // The window sits just before a turn that went a different way from here.
        const turn = game.state.turns[me]!.find(
          (t) => t.at - WINDOW.before === replay.windowStartMs,
        )!;
        expect(turn.dir).not.toBe(toward[here]);
        lastId = replay.id;
        lastAt = game.elapsedMs;
      }
    }
    expect(game.state.exitedAt[me]).toBeDefined();
    expect(lastId).toBeGreaterThan(0);
  });

  it('moves on to the next window when a client finds nothing to replay', () => {
    const game = startPuzzle(yappinMaze, { players: 2 });
    const me = game.player(0).id;
    const withReplay = (s: State): State => ({
      ...s,
      replay: {
        ...s.replay,
        [me]: {
          id: 7,
          from: game.player(1).id,
          windowStartMs: 1000,
          windowEndMs: 4700,
          left: [{ windowStartMs: 500, windowEndMs: 900 }],
        },
      },
    });
    // Drive the module directly: a replay with one fallback.
    const ctx = {
      teamId: 'team-1',
      players: game.players,
      teams: game.teams,
      elapsedMs: 5000,
      rng: createRng('x'),
      comms: {},
    };
    const s1 = withReplay(game.state);
    const missed = yappinMaze.apply(s1, me, { type: '__replayMissed', id: 7 }, ctx);
    if (!('state' in missed)) throw new Error('expected a state');
    expect(missed.state.replay[me]).toMatchObject({ windowStartMs: 500, windowEndMs: 900 });
    // A stale miss (wrong id) changes nothing.
    const stale = yappinMaze.apply(s1, me, { type: '__replayMissed', id: 3 }, ctx);
    expect('state' in stale && stale.state).toBe(s1);
  });
});

describe('yappin maze', () => {
  it('gives the partners different mazes, and every team the same pair', () => {
    const a = startPuzzle(yappinMaze, { players: 2 });
    const b = startPuzzle(yappinMaze, { players: 2 });
    const [m1, m2] = Object.values(a.state.mazes);
    expect(m1).not.toEqual(m2);
    expect(b.state.mazes).toEqual(a.state.mazes);
  });

  it('shows you only around yourself in your own maze, and all of your partner’s', () => {
    const game = startPuzzle(yappinMaze, {
      players: 2,
      hidden: [
        {
          name: 'the far side of your own maze',
          hiddenFrom: (p) => p.seat === 0,
          change: (s: State) => {
            const id = 'player-1';
            const maze = s.mazes[id]!;
            const cells = [...maze.cells];
            cells[maze.exit] = (cells[maze.exit] ?? 0) ^ BIT.n;
            return { ...s, mazes: { ...s.mazes, [id]: { ...maze, cells } } };
          },
        },
      ],
    });
    const view = game.view(0);
    expect(view.me.maze.cells.filter((c) => c !== null).length).toBeLessThanOrEqual(25);
    expect(view.me.maze.exit).toBeNull();
    expect(view.partner.maze.cells.every((c) => c !== null)).toBe(true);
    expect(view.partner.path.length).toBeGreaterThan(10);
  });

  it('stops you at walls, and solves when both are out', () => {
    const game = startPuzzle(yappinMaze, { players: 2 });
    for (const seat of [0, 1]) {
      const id = game.player(seat).id;
      const maze = game.state.mazes[id]!;
      const closed = DIRS.find((d) => !((maze.cells[maze.start] ?? 0) & BIT[d]))!;
      expect(game.act(seat, { type: 'move', dir: closed }).ok).toBe(false);
      const toward = towardExit(maze);
      while (game.state.pos[id] !== maze.exit) {
        game.advance(200);
        game.act(seat, { type: 'move', dir: toward[game.state.pos[id]!]! });
      }
      expect(game.act(seat, { type: 'move', dir: 'n' }).ok).toBe(false);
    }
    expect(game.solved).toBe(true);
    expect(game.score().elapsedMs).toBe(game.elapsedMs);
  });
});
