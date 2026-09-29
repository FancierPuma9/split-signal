import type { PuzzleManifest, PuzzleServerModule } from '@split-signal/shared';
import type { Action, State, View } from './types';

export const manifest: PuzzleManifest = {
  id: 'press-together',
  name: 'Press Together',
  description: 'Everyone in the room has a button. The first team where everyone has pressed wins.',
  teams: { min: 1, max: 3 },
  playersPerTeam: { min: 1, max: 4 },
  winCondition: 'race',
  timeLimitSeconds: 60,
  comms: { type: 'none' },
  instance: 'shared',
};

// Development dummy for shared (arena) instances: one instance for the whole room, per-team
// scoring, and a round that ends as soon as one team is done.
const puzzle: PuzzleServerModule<State, View, Action> = {
  manifest,

  init({ teams }) {
    return {
      pressed: [],
      finishedAt: {},
      teams: teams.map((t) => ({ id: t.id, playerIds: [...t.playerIds] })),
    };
  },

  view(state, playerId) {
    return {
      teams: state.teams.map((t) => ({
        id: t.id,
        pressed: t.playerIds.filter((id) => state.pressed.includes(id)).length,
        size: t.playerIds.length,
        done: state.finishedAt[t.id] !== undefined,
      })),
      myTeam: state.teams.find((t) => t.playerIds.includes(playerId))?.id ?? '',
      iPressed: state.pressed.includes(playerId),
    };
  },

  apply(state, playerId, action, ctx) {
    if (action?.type !== 'press') return { reject: 'Unknown action' };
    if (state.pressed.includes(playerId)) return { reject: 'Already pressed' };
    const pressed = [...state.pressed, playerId];
    const finishedAt = { ...state.finishedAt };
    for (const team of state.teams) {
      if (finishedAt[team.id] === undefined && team.playerIds.every((id) => pressed.includes(id))) {
        finishedAt[team.id] = ctx.elapsedMs;
      }
    }
    return { state: { ...state, pressed, finishedAt } };
  },

  // Shared: solved means the round is over. Race: the first finished team ends it.
  isSolved: (state) => Object.keys(state.finishedAt).length > 0,

  score: (state) => ({
    teams: Object.fromEntries(
      state.teams.map((t) => {
        const at = state.finishedAt[t.id];
        return [t.id, at === undefined ? { solved: false } : { solved: true, elapsedMs: at }];
      }),
    ),
  }),
};

export default puzzle;
