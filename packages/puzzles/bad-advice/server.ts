import type { PuzzleServerModule, Rng } from '@split-signal/shared';
import { DIRS, makeGrid, manhattan, placePair, stepFrom, type Dir } from './grid';
import { HINT_MS, MOVE_MS, TURN_CAP, manifest } from './manifest';
import type { Action, Move, State, View } from './types';

const isDir = (v: unknown): v is Dir => DIRS.includes(v as Dir);
const stillOut = (state: State) => state.players.filter((p) => !(p.id in state.home));

/** Everyone has hinted everyone else who is still out. */
function hintsAllIn(state: State): boolean {
  return state.players.every((from) =>
    stillOut(state).every((to) => to.id === from.id || state.hints[to.id]?.[from.id] !== undefined),
  );
}

/** End of the hint phase: each player's hints, shuffled so nobody can tell who sent which. */
function reveal(state: State, now: number, rng: Rng): State {
  const received: Record<string, Dir[]> = {};
  for (const p of state.players)
    received[p.id] = rng.shuffle(Object.values(state.hints[p.id] ?? {}));
  return { ...state, phase: 'move', phaseEndsAt: now + MOVE_MS, received };
}

/** End of the move phase: everyone still out moves at once, then a new turn starts. */
function resolve(state: State, now: number): State {
  const pieces = { ...state.pieces };
  const home = { ...state.home };
  for (const p of stillOut(state)) {
    const move = state.moves[p.id] ?? 'stay';
    if (move !== 'stay') pieces[p.id] = stepFrom(state.grid, pieces[p.id]!, move);
    const at = pieces[p.id]!;
    const target = state.targets[p.id]!;
    if (at.x === target.x && at.y === target.y) home[p.id] = now;
  }
  const teamDoneAt = { ...state.teamDoneAt };
  for (const t of state.teams) {
    const members = state.players.filter((p) => p.teamId === t.id);
    if (!(t.id in teamDoneAt) && members.every((p) => p.id in home)) teamDoneAt[t.id] = now;
  }
  const turn = state.turn + 1;
  return {
    ...state,
    pieces,
    home,
    teamDoneAt,
    turn,
    over: Object.keys(teamDoneAt).length > 0 || turn >= TURN_CAP,
    phase: 'hint',
    phaseEndsAt: now + HINT_MS,
    hints: {},
    received: {},
    moves: {},
  };
}

function viewOf(state: State, me: string, showOwnTarget: boolean): View {
  const sent: Record<string, Dir> = {};
  for (const [to, byFrom] of Object.entries(state.hints)) {
    const dir = byFrom[me];
    if (dir) sent[to] = dir;
  }
  return {
    me,
    myTeam: state.players.find((p) => p.id === me)?.teamId ?? '',
    players: state.players,
    teams: state.teams,
    grid: state.grid,
    boards: state.players.map((p) => ({
      playerId: p.id,
      piece: state.pieces[p.id]!,
      target: p.id === me && !showOwnTarget ? null : state.targets[p.id]!,
      home: p.id in state.home,
    })),
    turn: state.turn,
    turnCap: TURN_CAP,
    phase: state.phase,
    phaseEndsAt: state.phaseEndsAt,
    sent,
    received: state.phase === 'move' ? (state.received[me] ?? []) : null,
    myMove: state.moves[me] ?? null,
    moved: state.players.filter((p) => p.id in state.moves).map((p) => p.id),
    teamsDone: state.teams.filter((t) => t.id in state.teamDoneAt).map((t) => t.id),
    over: state.over,
  };
}

const puzzle: PuzzleServerModule<State, View, Action> = {
  manifest,

  init({ rng, players, teams }) {
    const grid = makeGrid(rng);
    const teamOf = new Map(teams.flatMap((t) => t.playerIds.map((id) => [id, t.id])));
    const pieces: State['pieces'] = {};
    const targets: State['targets'] = {};
    for (const p of players) {
      const { start, target } = placePair(rng, grid);
      pieces[p.id] = start;
      targets[p.id] = target;
    }
    return {
      players: players.map((p) => ({ id: p.id, name: p.name, teamId: teamOf.get(p.id)! })),
      teams: teams.map((t) => ({ id: t.id, name: t.name })),
      grid,
      pieces,
      targets,
      home: {},
      turn: 0,
      phase: 'hint',
      phaseEndsAt: HINT_MS,
      hints: {},
      received: {},
      moves: {},
      teamDoneAt: {},
      over: false,
    };
  },

  view: (state, playerId) => viewOf(state, playerId, false),

  // Under the scoreboard, everyone finally sees their own target too.
  reveal: (state, playerId) => viewOf(state, playerId, true),

  // Hints arrive as targeted signals. They're never relayed: the puzzle is the only one who knows
  // who sent what.
  onSignal(state, from, signal, ctx, to) {
    if (state.over || state.phase !== 'hint' || !isDir(signal)) return state;
    if (!to || to === from || !state.players.some((p) => p.id === to) || to in state.home) {
      return state;
    }
    if (state.hints[to]?.[from] === signal) return state;
    const next = {
      ...state,
      hints: { ...state.hints, [to]: { ...state.hints[to], [from]: signal } },
    };
    return hintsAllIn(next) ? reveal(next, ctx.elapsedMs, ctx.rng) : next;
  },

  apply(state, playerId, action, ctx) {
    if (state.over) return { reject: 'The game is over' };
    if (state.phase !== 'move') return { reject: 'Wait for the hints' };
    if (playerId in state.home) return { reject: "You're home: keep sending hints" };
    const dir = action?.dir as Move | undefined;
    if (action?.type !== 'move' || !(dir === 'stay' || isDir(dir)))
      return { reject: 'Unknown move' };
    const next = { ...state, moves: { ...state.moves, [playerId]: dir } };
    return {
      state: stillOut(next).every((p) => p.id in next.moves) ? resolve(next, ctx.elapsedMs) : next,
    };
  },

  tick(state, now, ctx) {
    if (state.over || now < state.phaseEndsAt) return state;
    return state.phase === 'hint' ? reveal(state, now, ctx.rng) : resolve(state, now);
  },

  isSolved: (state) => state.over,

  score(state) {
    const teams: Record<string, { solved: boolean; elapsedMs?: number; points: number }> = {};
    for (const t of state.teams) {
      // Fallback when nobody gets home: closest to home wins (33 minus the distance left, so
      // it's always positive and bigger is better).
      const left = state.players
        .filter((p) => p.teamId === t.id && !(p.id in state.home))
        .reduce((sum, p) => sum + manhattan(state.pieces[p.id]!, state.targets[p.id]!), 0);
      const doneAt = state.teamDoneAt[t.id];
      teams[t.id] = {
        solved: doneAt !== undefined,
        ...(doneAt !== undefined ? { elapsedMs: doneAt } : {}),
        points: 33 - left,
      };
    }
    return { teams };
  },
};

export default puzzle;
