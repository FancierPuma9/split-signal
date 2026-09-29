import type { PuzzleServerModule, Rng } from '@split-signal/shared';
import {
  GOING_ONCE_MS,
  NO_BID_MS,
  OPEN_BY_MS,
  RAISES,
  SOLD_MS,
  VALUE_RANGE,
  manifest,
} from './manifest';
import type { Action, Art, Player, Result, Role, State, View } from './types';

const FORMS = [
  'Study',
  'Composition',
  'Nocturne',
  'Fragment',
  'Meditation',
  'Elegy',
  'Variation',
  'Interior',
  'Figure',
];
const COLOURS = [
  'Ochre',
  'Cerulean',
  'Vermilion',
  'Umber',
  'Viridian',
  'Madder Lake',
  'Cadmium',
  'Prussian Blue',
  'Rose Doré',
  'Lamp Black',
];
const FIRST = [
  'Agnès',
  'Otto',
  'Imelda',
  'Casimir',
  'Pia',
  'Lorenzo',
  'Hedda',
  'Viktor',
  'Margit',
  'Anselm',
];
const LAST = [
  'Vandermeer',
  'Kowalczyk',
  'Brun',
  'Oyelaran',
  'Holloway',
  'Fairweather',
  'Lindqvist',
  'Moreau',
  'Achterberg',
];

function makeArt(rng: Rng): Art {
  const colour = rng.pick(COLOURS);
  const title = rng.chance(0.2)
    ? `Untitled (${colour} Period)`
    : `${rng.pick(FORMS)} in ${colour} No. ${rng.int(2, 14)}`;
  return {
    seed: rng.int(1, 2 ** 31 - 1),
    title,
    artist: `${rng.pick(FIRST)} ${rng.pick(LAST)}`,
    year: rng.int(1889, 1994),
  };
}

const highBid = (state: State) => state.bids.at(-1) ?? null;
const bidders = (state: State) => state.players.filter((p) => p.role === 'bidder');

function close(state: State, now: number, sold: boolean): State {
  return { ...state, phase: sold ? 'sold' : 'unsold', closedAt: now, goingOnce: false };
}

/**
 * Who bought it, for how much, and what each team gained. An auction still open at the buzzer
 * counts as sold to the high bidder at their bid.
 */
export function result(state: State): Result {
  const high = highBid(state);
  const sold = state.phase === 'sold' || (state.phase === 'open' && high !== null);
  const gains = Object.fromEntries(state.teams.map((t) => [t.id, 0]));
  if (!sold || !high) return { value: state.value, winner: null, price: null, gains };
  const team = state.players.find((p) => p.id === high.by)!.teamId;
  gains[team] = state.value - high.amount;
  return { value: state.value, winner: high.by, price: high.amount, gains };
}

function viewOf(state: State, me: string, revealed: boolean): View {
  const role = state.players.find((p) => p.id === me)?.role ?? 'bidder';
  const closed = state.phase === 'sold' || state.phase === 'unsold';
  return {
    me,
    role,
    players: state.players,
    teams: state.teams,
    sellerTeam: state.sellerTeam,
    art: state.art,
    phase: state.phase,
    openBy: state.openBy,
    openedAt: state.openedAt,
    bids: state.bids,
    passed: state.passed,
    goingOnce: state.goingOnce,
    value: role === 'appraiser' || closed || revealed ? state.value : null,
    result: closed || revealed ? result(state) : null,
  };
}

const puzzle: PuzzleServerModule<State, View, Action> = {
  manifest,

  init({ rng, players, teams, roundIndex }) {
    // The Seller's team rotates with the round; each time a team comes round again, its two
    // players swap jobs.
    const sellerTeam = teams[roundIndex % teams.length]!.id;
    const flip = Math.floor(roundIndex / teams.length) % 2 === 1;
    const roles = new Map<string, Role>();
    const teamOf = new Map<string, string>();
    for (const t of teams) {
      const [a, b] = flip ? [...t.playerIds].reverse() : t.playerIds;
      if (!a || !b) throw new Error('Going Once needs two players per team');
      roles.set(a, t.id === sellerTeam ? 'seller' : 'appraiser');
      roles.set(b, 'bidder');
      teamOf.set(a, t.id);
      teamOf.set(b, t.id);
    }
    const steps = (VALUE_RANGE.max - VALUE_RANGE.min) / VALUE_RANGE.step;
    return {
      players: players.map((p): Player => ({
        id: p.id,
        name: p.name,
        teamId: teamOf.get(p.id)!,
        role: roles.get(p.id)!,
      })),
      teams: teams.map((t) => ({ id: t.id, name: t.name })),
      sellerTeam,
      value: VALUE_RANGE.min + rng.int(0, steps) * VALUE_RANGE.step,
      art: makeArt(rng),
      phase: 'waiting',
      openBy: OPEN_BY_MS,
      openedAt: null,
      bids: [],
      passed: [],
      goingOnce: false,
      closedAt: null,
    };
  },

  view: (state, playerId) => viewOf(state, playerId, false),

  // Under the scoreboard: the value, the price, and who came out ahead.
  reveal: (state, playerId) => viewOf(state, playerId, true),

  apply(state, playerId, action, ctx) {
    const me = state.players.find((p) => p.id === playerId);
    if (!me) return { reject: 'You are not at this auction' };
    if (state.phase === 'sold' || state.phase === 'unsold')
      return { reject: 'The auction is over' };
    const now = ctx.elapsedMs;

    switch (action?.type) {
      case 'open':
        if (me.role !== 'seller') return { reject: 'Only the Seller opens the bidding' };
        if (state.phase !== 'waiting') return { reject: 'The bidding is already open' };
        return { state: { ...state, phase: 'open', openedAt: now } };

      case 'hammer':
        if (me.role !== 'seller') return { reject: 'Only the Seller has the hammer' };
        if (state.phase !== 'open' || !state.goingOnce || !highBid(state)) {
          return { reject: 'Not yet: wait for "going once"' };
        }
        return { state: close(state, now, true) };

      case 'bid': {
        if (me.role !== 'bidder') return { reject: 'Only Bidders bid' };
        if (state.phase !== 'open') return { reject: "The bidding isn't open yet" };
        if (state.passed.includes(playerId)) return { reject: 'You passed' };
        if (!RAISES.includes(action.raise as (typeof RAISES)[number]))
          return { reject: 'Bad raise' };
        const high = highBid(state);
        if (high?.by === playerId) return { reject: "You're already the high bidder" };
        const bid = { by: playerId, amount: (high?.amount ?? 0) + action.raise, at: now };
        return { state: { ...state, bids: [...state.bids, bid], goingOnce: false } };
      }

      case 'pass': {
        if (me.role !== 'bidder') return { reject: 'Only Bidders can pass' };
        if (state.phase !== 'open') return { reject: "The bidding isn't open yet" };
        if (state.passed.includes(playerId)) return { reject: 'You already passed' };
        const next = { ...state, passed: [...state.passed, playerId] };
        const high = highBid(next);
        const left = bidders(next).filter((b) => !next.passed.includes(b.id) && b.id !== high?.by);
        // Nobody left to outbid the high bidder: sold. Everyone out and no bids: no sale.
        if (left.length === 0) return { state: close(next, now, high !== null) };
        return { state: next };
      }

      default:
        return { reject: 'Unknown action' };
    }
  },

  tick(state, now) {
    if (state.phase === 'waiting') {
      return now >= state.openBy ? { ...state, phase: 'open', openedAt: now } : state;
    }
    if (state.phase !== 'open') return state;
    const high = highBid(state);
    if (!high) return now - state.openedAt! >= NO_BID_MS ? close(state, now, false) : state;
    const quiet = now - high.at;
    if (quiet >= SOLD_MS) return close(state, now, true);
    if (quiet >= GOING_ONCE_MS && !state.goingOnce) return { ...state, goingOnce: true };
    return state;
  },

  isSolved: (state) => state.phase === 'sold' || state.phase === 'unsold',

  score(state) {
    const { gains } = result(state);
    // Once the hammer falls every team has finished, so a team that stayed out beats one that
    // overpaid. (Until then nobody has: the shell shows live results as they come in.)
    const closed = state.phase === 'sold' || state.phase === 'unsold';
    return {
      teams: Object.fromEntries(
        state.teams.map((t) => [t.id, { solved: closed, points: gains[t.id] ?? 0 }]),
      ),
    };
  },
};

export default puzzle;
