import type { PuzzleServerModule } from '@split-signal/shared';
import { PICK_MS, REVEAL_MS, TURNS, manifest } from './manifest';
import { scoreTurn } from './scoring';
import type { Action, State, View } from './types';

/** Closes the current turn: scores the picks and moves to the reveal (or ends the game). */
function resolve(state: State, now: number): State {
  const teamOf = Object.fromEntries(state.players.map((p) => [p.id, p.teamId]));
  const picks = Object.fromEntries(state.players.map((p) => [p.id, state.picks[p.id] ?? null]));
  const turn = { picks, ...scoreTurn(picks, teamOf) };
  const totals = { ...state.totals };
  for (const [team, points] of Object.entries(turn.teams)) {
    totals[team] = (totals[team] ?? 0) + points;
  }
  const last = state.turn + 1 >= TURNS;
  return {
    ...state,
    turn: state.turn + 1,
    phase: 'reveal',
    phaseEndsAt: now + REVEAL_MS,
    picks: {},
    history: [...state.history, turn],
    totals,
    // No reveal pause after the last turn: the scoreboard (and reveal) take over.
    over: last,
  };
}

function viewOf(state: State, playerId: string): View {
  return {
    players: state.players,
    teams: state.teams,
    myTeam: state.players.find((p) => p.id === playerId)?.teamId ?? '',
    turn: state.turn,
    turns: TURNS,
    phase: state.phase,
    phaseEndsAt: state.phaseEndsAt,
    myPick: state.picks[playerId] ?? null,
    picked: state.players.filter((p) => p.id in state.picks).map((p) => p.id),
    last: state.history.at(-1) ?? null,
    totals: state.totals,
    over: state.over,
  };
}

const puzzle: PuzzleServerModule<State, View, Action> = {
  manifest,

  init({ players, teams }) {
    const teamOf = new Map(teams.flatMap((t) => t.playerIds.map((id) => [id, t.id])));
    return {
      players: players.map((p) => ({ id: p.id, name: p.name, teamId: teamOf.get(p.id)! })),
      teams: teams.map((t) => ({ id: t.id, name: t.name })),
      turn: 0,
      phase: 'pick',
      phaseEndsAt: PICK_MS,
      picks: {},
      history: [],
      totals: Object.fromEntries(teams.map((t) => [t.id, 0])),
      over: false,
    };
  },

  view: (state, playerId) => viewOf(state, playerId),

  // Under the scoreboard: the last turn's picks and the final totals.
  reveal: (state, playerId) => viewOf(state, playerId),

  apply(state, playerId, action, ctx) {
    if (state.over) return { reject: 'The game is over' };
    if (state.phase !== 'pick') return { reject: 'Wait for the next turn' };
    if (action?.type !== 'pick' || !Number.isInteger(action.n) || action.n < 1 || action.n > 6) {
      return { reject: 'Pick a number from 1 to 6' };
    }
    const picks = { ...state.picks, [playerId]: action.n };
    const next = { ...state, picks };
    // Everyone's in: reveal now rather than waiting out the clock.
    return {
      state: state.players.every((p) => p.id in picks) ? resolve(next, ctx.elapsedMs) : next,
    };
  },

  tick(state, now) {
    if (state.over || now < state.phaseEndsAt) return state;
    if (state.phase === 'pick') return resolve(state, now);
    return { ...state, phase: 'pick', phaseEndsAt: now + PICK_MS };
  },

  isSolved: (state) => state.over,

  score: (state) => ({
    teams: Object.fromEntries(state.teams.map((t) => [t.id, { points: state.totals[t.id] ?? 0 }])),
  }),
};

export default puzzle;
