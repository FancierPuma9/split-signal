import type { PuzzleServerModule } from '@split-signal/shared';
import { manifest } from './manifest';
import {
  BIT,
  DIRS,
  generateMaze,
  isJunction,
  solution,
  step,
  towardExit,
  type Dir,
  type Maze,
} from './maze';
import type { Action, FoggedMaze, State, Turn, View, Window } from './types';

/** How far you can see in your own maze. */
export const FOG_RADIUS = 2;
/** At most one replay per player this often. */
export const REPLAY_GAP_MS = 8000;
/** The window before a turn that's replayed: what the partner said just before it. */
export const WINDOW = { before: 4000, until: 300 };
/** Clients keep a minute of voice, so older turns can't be replayed. */
const BUFFER_MS = 58_000;

function fog(maze: Maze, pos: number): FoggedMaze {
  const pr = Math.floor(pos / maze.size);
  const pc = pos % maze.size;
  const near = (cell: number) =>
    Math.abs(Math.floor(cell / maze.size) - pr) <= FOG_RADIUS &&
    Math.abs((cell % maze.size) - pc) <= FOG_RADIUS;
  return {
    size: maze.size,
    cells: maze.cells.map((bits, cell) => (near(cell) ? bits : null)),
    exit: near(maze.exit) ? maze.exit : null,
  };
}

/**
 * Where to look for a replay when a player reaches a replay junction: their earlier turns in a
 * direction that would be wrong here, most recent first. Whatever the partner said just before
 * such a turn was almost certainly "go <that way>".
 */
export function replayWindows(
  turns: readonly Turn[],
  wrongHere: (dir: Dir) => boolean,
  now: number,
): Window[] {
  return turns
    .filter((t) => wrongHere(t.dir) && t.at - WINDOW.before >= now - BUFFER_MS)
    .reverse()
    .map((t) => ({ windowStartMs: t.at - WINDOW.before, windowEndMs: t.at - WINDOW.until }));
}

const puzzle: PuzzleServerModule<State, View, Action> = {
  manifest,

  init({ rng, players }) {
    if (players.length !== 2) throw new Error('YappinMaze needs 2 players');
    const [a, b] = [...players].sort((x, y) => x.seat - y.seat);
    const mazes: Record<string, Maze> = {
      [a!.id]: generateMaze(rng.fork('maze-a')),
      [b!.id]: generateMaze(rng.fork('maze-b')),
    };
    // Roughly every third junction replays something.
    const replayCells = Object.fromEntries(
      Object.entries(mazes).map(([id, maze], i) => {
        const junctions = maze.cells.map((_, c) => c).filter((c) => isJunction(maze, c));
        const pick = rng.fork(`replays-${i}`);
        return [id, junctions.filter(() => pick.chance(1 / 3))];
      }),
    );
    return {
      mazes,
      pos: Object.fromEntries(Object.entries(mazes).map(([id, m]) => [id, m.start])),
      partnerOf: { [a!.id]: b!.id, [b!.id]: a!.id },
      replayCells,
      replayed: { [a!.id]: [], [b!.id]: [] },
      turns: { [a!.id]: [], [b!.id]: [] },
      replay: { [a!.id]: null, [b!.id]: null },
      replayCounter: 0,
      lastReplayAt: {},
      exitedAt: {},
    };
  },

  view(state, playerId): View {
    const partner = state.partnerOf[playerId]!;
    const theirs = state.mazes[partner]!;
    return {
      me: {
        maze: fog(state.mazes[playerId]!, state.pos[playerId]!),
        pos: state.pos[playerId]!,
        exited: state.exitedAt[playerId] !== undefined,
      },
      partner: {
        maze: theirs,
        pos: state.pos[partner]!,
        path: solution(theirs),
        exited: state.exitedAt[partner] !== undefined,
      },
      out: Object.keys(state.exitedAt).length,
    };
  },

  apply(state, playerId, action, ctx) {
    if (action?.type === '__replayMissed') {
      const current = state.replay[playerId];
      if (!current || current.id !== action.id) return { state };
      const [next, ...rest] = current.left;
      const replayCounter = state.replayCounter + 1;
      return {
        state: {
          ...state,
          replayCounter,
          replay: {
            ...state.replay,
            [playerId]: next
              ? { id: replayCounter, from: current.from, ...next, left: rest }
              : null,
          },
        },
      };
    }
    if (action?.type !== 'move' || !DIRS.includes(action.dir)) return { reject: 'Unknown action' };
    if (state.exitedAt[playerId] !== undefined) return { reject: "You're out" };
    const maze = state.mazes[playerId]!;
    const from = state.pos[playerId]!;
    if (((maze.cells[from] ?? 0) & BIT[action.dir]) === 0) return { reject: 'Wall' };
    const to = step(from, action.dir, maze.size)!;
    const now = ctx.elapsedMs;

    let next: State = { ...state, pos: { ...state.pos, [playerId]: to } };
    if (isJunction(maze, from)) {
      next = {
        ...next,
        turns: {
          ...next.turns,
          [playerId]: [...next.turns[playerId]!, { cell: from, dir: action.dir, at: now }],
        },
      };
    }
    if (to === maze.exit) next = { ...next, exitedAt: { ...next.exitedAt, [playerId]: now } };

    const last = state.lastReplayAt[playerId];
    const due =
      state.replayCells[playerId]!.includes(to) &&
      !state.replayed[playerId]!.includes(to) &&
      (last === undefined || now - last >= REPLAY_GAP_MS);
    if (due) {
      const correct = towardExit(maze)[to];
      const windows = replayWindows(next.turns[playerId]!, (dir) => dir !== correct, now);
      if (windows.length > 0) {
        const [first, ...rest] = windows;
        const replayCounter = next.replayCounter + 1;
        next = {
          ...next,
          replayCounter,
          replay: {
            ...next.replay,
            [playerId]: {
              id: replayCounter,
              from: state.partnerOf[playerId]!,
              ...first!,
              left: rest,
            },
          },
          lastReplayAt: { ...next.lastReplayAt, [playerId]: now },
          replayed: { ...next.replayed, [playerId]: [...next.replayed[playerId]!, to] },
        };
      }
    }
    return { state: next };
  },

  // The only thing the engine does for this puzzle: pass replay requests on. No indicator shows.
  commsState(state, playerId) {
    const replay = state.replay[playerId];
    if (!replay) return {};
    const { left: _left, ...request } = replay;
    return { replay: request };
  },

  reveal(state, playerId, ctx) {
    const view = puzzle.view(state, playerId, ctx);
    const maze = state.mazes[playerId]!;
    return { ...view, mine: { maze, path: solution(maze) } };
  },

  isSolved: (state) => Object.keys(state.exitedAt).length >= Object.keys(state.mazes).length,

  score: (state) => {
    const times = Object.values(state.exitedAt);
    return times.length >= Object.keys(state.mazes).length ? { elapsedMs: Math.max(...times) } : {};
  },
};

export default puzzle;
