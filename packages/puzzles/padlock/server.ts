import type { PuzzleServerModule } from '@split-signal/shared';
import { manifest } from './manifest';
import type { Action, Sound, State, Turn, View } from './types';

export const DIALS_PER_PLAYER = 2;
/** A turn resolves when everyone has chosen, or when this runs out. */
export const TURN_MS = 15_000;

const wrap = (n: number) => ((n % 10) + 10) % 10;

/**
 * The feedback rule (plan 13.3, tune in playtest): chime if at least one dial turned this turn
 * landed on its correct value, buzz otherwise.
 */
function feedback(state: State, moved: number[], dials: number[]): Sound | null {
  if (moved.length === 0) return null;
  return moved.some((i) => dials[i] === state.combination[i]) ? 'chime' : 'buzz';
}

function resolve(state: State, nowMs: number): State {
  const dials = [...state.dials];
  const moved: number[] = [];
  for (const choice of Object.values(state.choices)) {
    if (choice === 'hold') continue;
    dials[choice.dial] = wrap((dials[choice.dial] ?? 0) + choice.dir);
    moved.push(choice.dial);
  }
  const turns = state.turns + 1;
  return {
    ...state,
    dials,
    turns,
    turnStartedAt: nowMs,
    choices: {},
    history: [
      ...state.history,
      {
        turn: turns,
        moved: moved.map((dial) => ({ dial, to: dials[dial] ?? 0 })),
        sound: feedback(state, moved, dials),
      },
    ],
    open: dials.every((d, i) => d === state.combination[i]),
  };
}

const puzzle: PuzzleServerModule<State, View, Action> = {
  manifest,

  init({ rng, players }) {
    const owners = players.flatMap((p) => Array<string>(DIALS_PER_PLAYER).fill(p.id));
    const combination = owners.map(() => rng.int(0, 9));
    const dials = owners.map(() => rng.int(0, 9));
    // Never start already open.
    if (dials.every((d, i) => d === combination[i])) dials[0] = wrap((dials[0] ?? 0) + 5);
    return {
      dials,
      combination,
      owners,
      turns: 0,
      turnStartedAt: 0,
      choices: {},
      history: [],
      open: false,
    };
  },

  view(state, playerId, ctx) {
    const seatOf = new Map(ctx.players.map((p) => [p.id, p.seat]));
    const teammates = ctx.players.filter((p) => p.id !== playerId);
    return {
      dials: state.dials,
      dialSeats: state.owners.map((id) => seatOf.get(id) ?? 0),
      mine: state.owners.flatMap((id, i) => (id === playerId ? [i] : [])),
      turns: state.turns,
      turnStartedAt: state.turnStartedAt,
      turnMs: TURN_MS,
      myChoice: state.choices[playerId] ?? null,
      teammatesReady: teammates.filter((p) => state.choices[p.id] !== undefined).length,
      teammates: teammates.length,
      history: state.history,
      open: state.open,
    };
  },

  apply(state, playerId, action, ctx) {
    let choice: Turn;
    if (action?.type === 'hold') {
      choice = 'hold';
    } else if (action?.type === 'turn' && (action.dir === 1 || action.dir === -1)) {
      if (state.owners[action.dial] !== playerId) return { reject: "That isn't your dial" };
      choice = { dial: action.dial, dir: action.dir };
    } else {
      return { reject: 'Unknown action' };
    }
    const next = { ...state, choices: { ...state.choices, [playerId]: choice } };
    const everyoneReady = ctx.players.every((p) => next.choices[p.id] !== undefined);
    return { state: everyoneReady ? resolve(next, ctx.elapsedMs) : next };
  },

  tick(state, nowMs) {
    return nowMs - state.turnStartedAt >= TURN_MS ? resolve(state, nowMs) : state;
  },

  isSolved: (state) => state.open,

  score: (state) => ({ moves: state.turns }),
};

export default puzzle;
