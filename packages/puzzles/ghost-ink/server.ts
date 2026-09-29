import type { PuzzleServerModule } from '@split-signal/shared';
import { manifest } from './manifest';
import { ASPECT, PALETTE } from './scene';
import type { Action, Point, Result, State, View } from './types';

/** How many palette objects the target scene uses. */
export const SCENE_SIZE = { min: 5, max: 7 };
/** Closest two scene objects may be, in scene heights, so none overlap. */
const MIN_GAP = 0.2;
/** Half the scene diagonal, in scene heights: placing this far off (or farther) scores 0. */
export const MAX_DISTANCE = Math.hypot(ASPECT, 1) / 2;

/** Distance in scene heights, so a step sideways counts the same as a step down. */
export function distance(a: Point, b: Point): number {
  return Math.hypot((a.x - b.x) * ASPECT, a.y - b.y);
}

export function accuracy(placed: Point | undefined, target: Point): number {
  return placed ? Math.max(0, 1 - distance(placed, target) / MAX_DISTANCE) : 0;
}

export function result(state: State): Result {
  const accuracies: Record<string, number> = {};
  for (const [id, target] of Object.entries(state.target)) {
    accuracies[id] = accuracy(state.placed[id], target);
  }
  const values = Object.values(accuracies);
  const mean = values.reduce((sum, a) => sum + a, 0) / values.length;
  return { target: state.target, accuracy: accuracies, score: Math.round(mean * 1000) / 10 };
}

/** revealed: the round is over, so everyone sees the result, submitted or not. */
function viewOf(state: State, playerId: string, revealed: boolean): View {
  const common = {
    canDraw: playerId === state.drawer,
    placed: state.placed,
    placers: Object.keys(state.owners).length,
    ready: state.ready.length,
    result: revealed || state.submittedAt !== null ? result(state) : null,
  };
  if (playerId === state.drawer) return { ...common, role: 'drawer', target: state.target };
  return {
    ...common,
    role: 'placer',
    mine: state.owners[playerId] ?? [],
    submitted: state.ready.includes(playerId),
  };
}

const isCoord = (v: unknown): v is number => typeof v === 'number' && v >= 0 && v <= 1;
const round3 = (v: number) => Math.round(v * 1000) / 1000;

const puzzle: PuzzleServerModule<State, View, Action> = {
  manifest,

  init({ rng, players, roundIndex }) {
    if (players.length < 2) throw new Error('Ghost Ink needs at least 2 players');
    // The Drawer rotates with the round, so the same seat isn't always stuck drawing.
    const drawer = players[roundIndex % players.length]!.id;
    const placers = players.filter((p) => p.id !== drawer).map((p) => p.id);
    const shuffled = rng.shuffle(PALETTE.map((o) => o.id));
    const owners = Object.fromEntries(
      placers.map((id, i) => [id, shuffled.filter((_, j) => j % placers.length === i)]),
    );

    const chosen = rng.shuffle(shuffled).slice(0, rng.int(SCENE_SIZE.min, SCENE_SIZE.max));
    const target: Record<string, Point> = {};
    const taken: Point[] = [];
    for (const id of chosen) {
      let spot: Point = { x: 0.5, y: 0.5 };
      for (let attempt = 0; attempt < 200; attempt++) {
        spot = { x: round3(0.08 + rng.next() * 0.84), y: round3(0.1 + rng.next() * 0.8) };
        if (taken.every((other) => distance(spot, other) >= MIN_GAP)) break;
      }
      taken.push(spot);
      target[id] = spot;
    }

    return { drawer, owners, target, placed: {}, ready: [], submittedAt: null };
  },

  view: (state, playerId) => viewOf(state, playerId, false),

  // Under the scoreboard: the scene and the rebuild side by side, even if time ran out.
  reveal: (state, playerId) => viewOf(state, playerId, true),

  apply(state, playerId, action, ctx) {
    if (state.submittedAt !== null) return { reject: 'Your team has already submitted' };
    if (playerId === state.drawer) return { reject: 'The Drawer can only draw' };
    if (state.ready.includes(playerId)) return { reject: "You've already submitted" };
    const mine = state.owners[playerId] ?? [];

    switch (action?.type) {
      case 'place':
      case 'move': {
        if (!mine.includes(action.objectId)) return { reject: "That isn't yours to place" };
        if (!isCoord(action.x) || !isCoord(action.y)) return { reject: 'That is off the canvas' };
        const isPlaced = Object.hasOwn(state.placed, action.objectId);
        if (action.type === 'place' && isPlaced) return { reject: 'That is already placed' };
        if (action.type === 'move' && !isPlaced) return { reject: "That isn't placed yet" };
        const spot = { x: action.x, y: action.y };
        return { state: { ...state, placed: { ...state.placed, [action.objectId]: spot } } };
      }
      case 'remove': {
        if (!mine.includes(action.objectId)) return { reject: "That isn't yours to remove" };
        if (!Object.hasOwn(state.placed, action.objectId)) return { reject: "That isn't placed" };
        const placed = { ...state.placed };
        delete placed[action.objectId];
        return { state: { ...state, placed } };
      }
      case 'submit': {
        const ready = [...state.ready, playerId];
        const everyone = Object.keys(state.owners).every((id) => ready.includes(id));
        return { state: { ...state, ready, submittedAt: everyone ? ctx.elapsedMs : null } };
      }
      default:
        return { reject: 'Unknown action' };
    }
  },

  isSolved: (state) => state.submittedAt !== null,

  // Scored whether or not the team submitted: placements count at the buzzer too.
  score: (state) => ({ points: result(state).score }),
};

export default puzzle;
