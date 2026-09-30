import {
  TICK_INTERVAL_MS,
  type Context,
  type PlayerCommsGate,
  type PuzzleServerModule,
} from '@split-signal/shared';
import { BIT, DIRS, braid, distancesFrom, generateMaze, step } from '../lib/maze';
import { manifest } from './manifest';
import {
  BATTERY,
  CATCH_COOLDOWN_MS,
  GHOST_STEP_MS,
  HUNTER_SIGHT,
  HUNTER_STEP_MS,
  MUTE_MS,
  POINTS,
  RADIUS,
  drift,
  farTile,
  hearing,
  litTiles,
  smoothRadius,
} from './rules';
import type { Action, Ghost, GhostMark, Hunter, HunterMark, State, View } from './types';

export const MAZE_SIZE = 13;

const muted = (g: Ghost, now: number) => g.mutedUntil !== null && now < g.mutedUntil;
const ghostMark = (team: string, g: Ghost, now: number): GhostMark => ({
  team,
  pos: g.pos,
  muted: muted(g, now),
});
const hunterMark = (team: string, h: Hunter): HunterMark => ({
  team,
  pos: h.pos,
  facing: h.facing,
  light: h.light,
});

function common(state: State, playerId: string, ctx: Context) {
  return {
    myTeam: state.teamOf[playerId] ?? '',
    teamNames: Object.fromEntries(ctx.teams.map((t) => [t.id, t.name])),
    scores: state.scores,
    catches: state.catches.slice(-5),
  };
}

const roleOf = (state: State, playerId: string) => {
  const team = state.teamOf[playerId];
  return team && state.ghosts[team]?.player === playerId ? 'ghost' : 'hunter';
};

const puzzle: PuzzleServerModule<State, View, Action> = {
  manifest,

  init({ rng, teams, roundIndex }) {
    const maze = braid(generateMaze(rng.fork('maze'), MAZE_SIZE), rng.fork('braid'), 0.6);
    const ghosts: State['ghosts'] = {};
    const hunters: State['hunters'] = {};
    const teamOf: State['teamOf'] = {};
    const place = rng.fork('places');
    const taken: number[] = [];
    const freeTile = () => {
      const tile = farTile(maze, taken, place);
      taken.push(tile);
      return tile;
    };
    // The Ghost role swaps each round.
    const roles = (ids: readonly string[]) => (roundIndex % 2 === 0 ? ids : [...ids].reverse());
    for (const team of teams) {
      const [, hunter] = roles(team.playerIds);
      for (const id of team.playerIds) teamOf[id] = team.id;
      hunters[team.id] = {
        player: hunter!,
        pos: freeTile(),
        facing: 'n',
        light: false,
        battery: BATTERY.max,
        lastStepAt: null,
        lastCatchAt: null,
      };
    }
    for (const team of teams) {
      ghosts[team.id] = {
        player: roles(team.playerIds)[0]!,
        pos: farTile(
          maze,
          Object.values(hunters).map((h) => h.pos),
          place,
        ),
        prev: null,
        nextStepAt: GHOST_STEP_MS,
        db: -100,
        heardAt: null,
        radius: RADIUS.min,
        mutedUntil: null,
      };
    }
    return {
      maze,
      ghosts,
      hunters,
      teamOf,
      scores: Object.fromEntries(teams.map((t) => [t.id, 0])),
      lastScoreAt: {},
      catches: [],
    };
  },

  view(state, playerId, ctx): View {
    const now = ctx.elapsedMs;
    const team = state.teamOf[playerId] ?? '';
    const ghostMarks = Object.entries(state.ghosts).map(([t, g]) => ghostMark(t, g, now));
    if (roleOf(state, playerId) === 'ghost') {
      const me = state.ghosts[team]!;
      return {
        role: 'ghost',
        ...common(state, playerId, ctx),
        maze: state.maze,
        me: { pos: me.pos, radius: me.radius, mutedUntil: me.mutedUntil },
        ghosts: ghostMarks,
        hunters: Object.entries(state.hunters).map(([t, h]) => hunterMark(t, h)),
      };
    }
    const me = state.hunters[team]!;
    const size = state.maze.size;
    const near = (cell: number) =>
      Math.abs(Math.floor(cell / size) - Math.floor(me.pos / size)) <= HUNTER_SIGHT &&
      Math.abs((cell % size) - (me.pos % size)) <= HUNTER_SIGHT;
    const lit = litTiles(state.maze, me);
    return {
      role: 'hunter',
      ...common(state, playerId, ctx),
      maze: { size, cells: state.maze.cells.map((bits, cell) => (near(cell) ? bits : null)) },
      me: {
        pos: me.pos,
        facing: me.facing,
        light: me.light,
        battery: Math.round(me.battery),
        catchReadyAt: me.lastCatchAt === null ? 0 : me.lastCatchAt + CATCH_COOLDOWN_MS,
      },
      hunters: Object.entries(state.hunters)
        .filter(([t]) => t !== team)
        .map(([t, h]) => hunterMark(t, h)),
      lit,
      seen: ghostMarks.filter((g) => lit.includes(g.pos)),
    };
  },

  apply(state, playerId, action, ctx) {
    const team = state.teamOf[playerId];
    if (!team) return { reject: 'Not playing' };
    const now = ctx.elapsedMs;
    if (action?.type === '__micLevel') {
      if (roleOf(state, playerId) !== 'ghost' || !Number.isFinite(action.db)) return { state };
      const ghost = { ...state.ghosts[team]!, db: action.db, heardAt: now };
      return { state: { ...state, ghosts: { ...state.ghosts, [team]: ghost } } };
    }
    if (roleOf(state, playerId) !== 'hunter') return { reject: 'Ghosts only drift and talk' };
    const hunter = state.hunters[team]!;
    const put = (h: Hunter, extra: Partial<State> = {}) => ({
      state: { ...state, ...extra, hunters: { ...state.hunters, [team]: h } },
    });

    switch (action?.type) {
      case 'move': {
        if (!DIRS.includes(action.dir)) return { reject: 'No such way' };
        if (hunter.lastStepAt !== null && now - hunter.lastStepAt < HUNTER_STEP_MS) {
          return { state };
        }
        const open = ((state.maze.cells[hunter.pos] ?? 0) & BIT[action.dir]) !== 0;
        // Into a wall you just turn, which aims the flashlight.
        const pos = open ? step(hunter.pos, action.dir, state.maze.size)! : hunter.pos;
        return put({ ...hunter, pos, facing: action.dir, lastStepAt: now });
      }
      case 'flashlight':
        if (!hunter.light && hunter.battery < BATTERY.minToLight) return { reject: 'Battery flat' };
        return put({ ...hunter, light: !hunter.light });
      case 'catch': {
        if (hunter.lastCatchAt !== null && now - hunter.lastCatchAt < CATCH_COOLDOWN_MS) {
          return { reject: 'Catch recharging' };
        }
        const lit = litTiles(state.maze, hunter);
        const inBeam = Object.entries(state.ghosts).filter(([, g]) => lit.includes(g.pos));
        const target = inBeam.find(([t]) => t === team) ?? inBeam[0];
        const tried = { ...hunter, lastCatchAt: now };
        if (!target) return put(tried);
        const [ghostTeam, ghost] = target;
        const own = ghostTeam === team;
        const hunterTiles = Object.values(state.hunters).map((h) => h.pos);
        const moved: Ghost = {
          ...ghost,
          pos: farTile(state.maze, hunterTiles, ctx.rng),
          prev: null,
          ...(own ? {} : { mutedUntil: now + MUTE_MS }),
        };
        const points = own ? POINTS.own : POINTS.enemy;
        return put(tried, {
          ghosts: { ...state.ghosts, [ghostTeam]: moved },
          scores: { ...state.scores, [team]: (state.scores[team] ?? 0) + points },
          lastScoreAt: { ...state.lastScoreAt, [team]: now },
          catches: [...state.catches, { by: team, ghostTeam, own, at: now }],
        });
      }
      default:
        return { reject: 'Unknown action' };
    }
  },

  tick(state, now, ctx) {
    let changed = false;
    const ghosts: State['ghosts'] = {};
    for (const [team, g] of Object.entries(state.ghosts)) {
      let next = g;
      if (g.mutedUntil !== null && now >= g.mutedUntil) next = { ...next, mutedUntil: null };
      const radius = smoothRadius(next, now, TICK_INTERVAL_MS);
      if (radius !== next.radius) next = { ...next, radius };
      if (now >= next.nextStepAt) {
        next = {
          ...next,
          prev: next.pos,
          pos: drift(state.maze, next, ctx.rng),
          nextStepAt: next.nextStepAt + GHOST_STEP_MS,
        };
      }
      if (next !== g) changed = true;
      ghosts[team] = next;
    }
    const hunters: State['hunters'] = {};
    for (const [team, h] of Object.entries(state.hunters)) {
      const perTick = TICK_INTERVAL_MS / 1000;
      let next = h;
      if (h.light) {
        const battery = Math.max(0, h.battery - BATTERY.drainPerSec * perTick);
        next = { ...h, battery, light: battery > 0 };
      } else if (h.battery < BATTERY.max) {
        next = {
          ...h,
          battery: Math.min(BATTERY.max, h.battery + BATTERY.rechargePerSec * perTick),
        };
      }
      if (next !== h) changed = true;
      hunters[team] = next;
    }
    return changed ? { ...state, ghosts, hunters } : state;
  },

  commsState(state, playerId, ctx): PlayerCommsGate {
    const team = state.teamOf[playerId]!;
    const now = ctx.elapsedMs;
    if (roleOf(state, playerId) === 'ghost') {
      // Ghosts see everything and have nothing to listen to.
      return { send: !muted(state.ghosts[team]!, now), receive: false };
    }
    const hunter = state.hunters[team]!;
    const peers: NonNullable<PlayerCommsGate['peers']> = {};
    for (const [ghostTeam, ghost] of Object.entries(state.ghosts)) {
      const heard = hearing(
        state.maze,
        ghost,
        hunter.pos,
        ghostTeam !== team,
        now,
        distancesFrom(state.maze, ghost.pos),
      );
      peers[ghost.player] = { audible: heard.audible, gain: Math.round(heard.gain * 20) / 20 };
    }
    return { send: false, peers };
  },

  reveal(state, playerId, ctx) {
    const now = ctx.elapsedMs;
    return {
      role: 'reveal',
      ...common(state, playerId, ctx),
      maze: state.maze,
      ghosts: Object.entries(state.ghosts).map(([t, g]) => ghostMark(t, g, now)),
      hunters: Object.entries(state.hunters).map(([t, h]) => hunterMark(t, h)),
    };
  },

  // Timed: the round runs to the buzzer.
  isSolved: () => false,

  score: (state) => ({
    teams: Object.fromEntries(
      Object.entries(state.scores).map(([team, points]) => [
        team,
        {
          points,
          ...(state.lastScoreAt[team] !== undefined ? { elapsedMs: state.lastScoreAt[team] } : {}),
        },
      ]),
    ),
  }),
};

export default puzzle;
