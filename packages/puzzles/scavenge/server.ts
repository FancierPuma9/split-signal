import type { Context, PuzzleServerModule } from '@split-signal/shared';
import { generateBin, generateSchematics } from './bin';
import { manifest } from './manifest';
import type { Action, Part, Resolution, State, View } from './types';

/** Grabs resolve together this often. */
export const TICK_MS = 5000;
export const GRABS = 12;

const done = (state: State, team: string) =>
  (state.required[team] ?? []).every((id) => state.trays[team]!.includes(id));

/** Resolves every team's grab at once: uncontested ones land, contested ones stay in the bin. */
export function resolveGrabs(state: State, now: number): State {
  const wants = new Map<string, string[]>();
  const results: Resolution['results'] = {};
  const grabsLeft = { ...state.grabsLeft };
  for (const [team, hover] of Object.entries(state.hover)) {
    const part = hover.part;
    if (
      part === null ||
      !state.bin.includes(part) ||
      (grabsLeft[team] ?? 0) <= 0 ||
      state.solvedAt[team] !== undefined
    ) {
      results[team] = { part: null, outcome: 'pass' };
      continue;
    }
    grabsLeft[team] = (grabsLeft[team] ?? 0) - 1;
    wants.set(part, [...(wants.get(part) ?? []), team]);
  }
  let bin = state.bin;
  const trays = { ...state.trays };
  for (const [part, teams] of wants) {
    if (teams.length > 1) {
      for (const team of teams) results[team] = { part, outcome: 'contested' };
      continue;
    }
    const team = teams[0]!;
    results[team] = { part, outcome: 'got' };
    bin = bin.filter((id) => id !== part);
    trays[team] = [...trays[team]!, part];
  }
  let next: State = {
    ...state,
    bin,
    trays,
    grabsLeft,
    hover: Object.fromEntries(
      Object.keys(state.hover).map((t) => [t, { part: null, committed: false }]),
    ),
    nextTickAt: state.nextTickAt + TICK_MS,
    last: { at: now, results },
  };
  const solvedAt = { ...next.solvedAt };
  for (const team of Object.keys(trays)) {
    if (solvedAt[team] === undefined && done(next, team)) solvedAt[team] = now;
  }
  next = { ...next, solvedAt };
  return next;
}

function common(state: State, playerId: string, ctx: Context) {
  const byId = Object.fromEntries(state.parts.map((p) => [p.id, p]));
  const myTeam = state.teamOf[playerId] ?? '';
  const partsOf = (ids: readonly string[]) => ids.map((id) => byId[id]!);
  return {
    myTeam,
    teamNames: Object.fromEntries(ctx.teams.map((t) => [t.id, t.name])),
    tray: partsOf(state.trays[myTeam] ?? []),
    trays: Object.fromEntries(Object.entries(state.trays).map(([t, ids]) => [t, partsOf(ids)])),
    grabsLeft: state.grabsLeft,
    nextTickAt: state.nextTickAt,
    last: state.last,
    catalog: byId as Record<string, Part>,
  };
}

const puzzle: PuzzleServerModule<State, View, Action> = {
  manifest,

  init({ rng, teams, roundIndex }) {
    const parts = generateBin(rng.fork('bin'));
    const teamIds = teams.map((t) => t.id);
    const roles: State['roles'] = {};
    const teamOf: State['teamOf'] = {};
    for (const team of teams) {
      team.playerIds.forEach((id, seat) => {
        roles[id] = seat === roundIndex % team.playerIds.length ? 'reader' : 'grabber';
        teamOf[id] = team.id;
      });
    }
    return {
      parts,
      bin: parts.map((p) => p.id),
      required: generateSchematics(teamIds, parts, rng.fork('schematics')),
      trays: Object.fromEntries(teamIds.map((t) => [t, []])),
      grabsLeft: Object.fromEntries(teamIds.map((t) => [t, GRABS])),
      roles,
      teamOf,
      hover: Object.fromEntries(teamIds.map((t) => [t, { part: null, committed: false }])),
      nextTickAt: TICK_MS,
      last: null,
      solvedAt: {},
    };
  },

  view(state, playerId, ctx): View {
    const base = common(state, playerId, ctx);
    if (state.roles[playerId] === 'reader') {
      return {
        role: 'reader',
        ...base,
        schematic: (state.required[base.myTeam] ?? []).map((id) => base.catalog[id]!),
      };
    }
    return {
      role: 'grabber',
      ...base,
      bin: state.bin.map((id) => base.catalog[id]!),
      hover: state.hover[base.myTeam] ?? { part: null, committed: false },
    };
  },

  apply(state, playerId, action) {
    if (state.roles[playerId] !== 'grabber') return { reject: 'Readers read; Grabbers grab' };
    const team = state.teamOf[playerId]!;
    const current = state.hover[team] ?? { part: null, committed: false };
    if (state.solvedAt[team] !== undefined) return { reject: 'Your team is done' };
    if (action?.type === 'hover') {
      if (current.committed) return { reject: 'Committed until the grab lands' };
      if (action.partId !== null && !state.bin.includes(action.partId)) {
        return { reject: "That isn't in the bin" };
      }
      return {
        state: {
          ...state,
          hover: { ...state.hover, [team]: { part: action.partId, committed: false } },
        },
      };
    }
    if (action?.type === 'commit') {
      if (current.part === null) return { reject: 'Pick a part first' };
      return {
        state: { ...state, hover: { ...state.hover, [team]: { ...current, committed: true } } },
      };
    }
    return { reject: 'Unknown action' };
  },

  tick(state, now) {
    return now >= state.nextTickAt ? resolveGrabs(state, now) : state;
  },

  reveal(state, playerId, ctx) {
    const base = common(state, playerId, ctx);
    return {
      role: 'reveal',
      ...base,
      schematics: Object.fromEntries(
        Object.entries(state.required).map(([t, ids]) => [t, ids.map((id) => base.catalog[id]!)]),
      ),
    };
  },

  // The first team to finish ends it (teams finishing on the same grab tie).
  isSolved: (state) => Object.keys(state.solvedAt).length > 0,

  score: (state) => ({
    teams: Object.fromEntries(
      Object.keys(state.trays).map((team) => {
        const parts = (state.required[team] ?? []).filter((id) =>
          state.trays[team]!.includes(id),
        ).length;
        const solved = state.solvedAt[team] !== undefined;
        return [
          team,
          {
            solved,
            points: parts,
            tiebreak: state.grabsLeft[team] ?? 0,
            ...(solved ? { elapsedMs: state.solvedAt[team] } : {}),
          },
        ];
      }),
    ),
  }),
};

export default puzzle;
