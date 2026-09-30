import { TICK_INTERVAL_MS, type Context, type PuzzleServerModule } from '@split-signal/shared';
import { ANSWER, LANE_LENGTH, generateLane } from './course';
import { manifest } from './manifest';
import type { Action, Hazard, LaneView, Move, Runner, State, View } from './types';

/** Tiles per second while running. */
export const SPEED = 2;
/** No 'run' for this long and you've stopped (and your mic opens). */
export const STILL_MS = 300;
/** A move clears a hazard if it was made this soon before reaching it. */
export const MOVE_WINDOW_MS = 700;
/** Moves can't be spammed faster than this. */
export const MOVE_COOLDOWN_MS = 600;
export const STUN_MS = 5000;
/** How far ahead of the watched runner hazards show: the next 3, or 8 tiles, whichever is less. */
export const REVEAL = { hazards: 3, tiles: 8 };

const MOVES: readonly Move[] = ['jump', 'duck', 'stepLeft', 'stepRight'];

function laneView(r: Runner): LaneView {
  return {
    pos: Math.min(LANE_LENGTH, Math.round(r.pos * 100) / 100),
    moving: r.moving,
    stunnedUntil: r.stunnedUntil,
    finished: r.finishedAt !== null,
    hits: r.hits,
  };
}

/** Hazards the watcher may see: the next few ahead of the watched runner. */
export function revealed(r: Runner): Hazard[] {
  return r.lane
    .filter((h) => h.at > r.pos && !r.passed.includes(h.at) && h.at - r.pos <= REVEAL.tiles)
    .slice(0, REVEAL.hazards);
}

/** Advances one runner by dt, settling any hazard it reaches. */
function advance(r: Runner, now: number, dt: number): Runner {
  const running = r.lastRunAt !== null && now - r.lastRunAt < STILL_MS;
  const stunned = r.stunnedUntil !== null && now < r.stunnedUntil;
  const moving = running && !stunned && r.finishedAt === null;
  let next: Runner = r;
  if (moving !== r.moving) next = { ...next, moving };
  if (!moving) return next;

  let pos = r.pos + (SPEED * dt) / 1000;
  const hazard = r.lane.find((h) => h.at > r.pos && h.at <= pos && !r.passed.includes(h.at));
  if (hazard) {
    const cleared =
      r.lastMove !== null &&
      r.lastMove.move === ANSWER[hazard.kind] &&
      now - r.lastMove.at <= MOVE_WINDOW_MS;
    next = { ...next, passed: [...next.passed, hazard.at] };
    if (!cleared) {
      pos = hazard.at;
      next = { ...next, stunnedUntil: now + STUN_MS, hits: next.hits + 1, moving: false };
    }
  }
  if (pos >= LANE_LENGTH) {
    return { ...next, pos: LANE_LENGTH, finishedAt: now, moving: false };
  }
  return { ...next, pos };
}

function view(state: State, playerId: string, ctx: Context): View {
  const me = state.runners[playerId]!;
  const watchedId = state.watches[playerId]!;
  const watched = state.runners[watchedId]!;
  const runners = Object.values(state.runners);
  return {
    length: LANE_LENGTH,
    me: laneView(me),
    watched: {
      ...laneView(watched),
      name: ctx.players.find((p) => p.id === watchedId)?.name ?? 'your partner',
      hazards: revealed(watched),
    },
    finished: runners.filter((r) => r.finishedAt !== null).length,
    total: runners.length,
  };
}

const puzzle: PuzzleServerModule<State, View, Action> = {
  manifest,

  init({ rng, players }) {
    if (players.length < 2) throw new Error('Hot Mic needs at least 2 players');
    const bySeat = [...players].sort((a, b) => a.seat - b.seat);
    const runners: State['runners'] = {};
    bySeat.forEach((p, i) => {
      runners[p.id] = {
        lane: generateLane(rng.fork(`lane-${i}`)),
        pos: 0,
        lastRunAt: null,
        moving: false,
        lastMove: null,
        stunnedUntil: null,
        passed: [],
        hits: 0,
        finishedAt: null,
      };
    });
    const watches = Object.fromEntries(
      bySeat.map((p, i) => [p.id, bySeat[(i + 1) % bySeat.length]!.id]),
    );
    return { runners, watches };
  },

  view,

  apply(state, playerId, action, ctx) {
    const r = state.runners[playerId];
    if (!r) return { reject: 'Not running' };
    if (r.finishedAt !== null) return { reject: "You're over the line" };
    const now = ctx.elapsedMs;
    let next: Runner;
    if (action?.type === 'run') {
      next = { ...r, lastRunAt: now };
    } else if (action?.type === 'stop') {
      next = { ...r, lastRunAt: null };
    } else if (MOVES.includes(action?.type as Move)) {
      if (r.lastMove && now - r.lastMove.at < MOVE_COOLDOWN_MS) return { reject: 'Too fast' };
      next = { ...r, lastMove: { move: action.type as Move, at: now } };
    } else {
      return { reject: 'Unknown action' };
    }
    return { state: { ...state, runners: { ...state.runners, [playerId]: next } } };
  },

  tick(state, now) {
    // Ticks come every TICK_INTERVAL_MS of round time (the clock stops while paused).
    const dt = TICK_INTERVAL_MS;
    let changed = false;
    const runners: State['runners'] = {};
    for (const [id, r] of Object.entries(state.runners)) {
      const next = advance(r, now, dt);
      runners[id] = next;
      if (next !== r) changed = true;
    }
    return changed ? { ...state, runners } : state;
  },

  // The mic and the ears open only while you stand still.
  commsState: (state, playerId) =>
    state.runners[playerId]?.moving ? { send: false, receive: false } : {},

  reveal(state, playerId, ctx) {
    return { ...view(state, playerId, ctx), myHazards: state.runners[playerId]!.lane };
  },

  isSolved: (state) => Object.values(state.runners).every((r) => r.finishedAt !== null),

  score(state) {
    const runners = Object.values(state.runners);
    if (!runners.every((r) => r.finishedAt !== null)) return {};
    return {
      elapsedMs: Math.max(...runners.map((r) => r.finishedAt!)),
      moves: runners.reduce((n, r) => n + r.hits, 0),
    };
  },
};

export default puzzle;
