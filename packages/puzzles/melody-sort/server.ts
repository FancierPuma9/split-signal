import type { PuzzleServerModule } from '@split-signal/shared';
import { manifest } from './manifest';
import { NOTE_MS, SOUNDS, type Action, type State, type Tile, type View } from './types';

export const NOTE_COUNT = SOUNDS.length;
/** The arranger can't play again until the previous playback has finished. */
export const PLAYBACK_MS = NOTE_COUNT * NOTE_MS + 400;

/** Abstract and hard to name, so arrangers can't guess which sound goes with which. */
const SYMBOLS = ['◆', '●', '▲', '■', '✚', '★', '◗', '⬟'];

const sameOrder = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((id, i) => id === b[i]);

const puzzle: PuzzleServerModule<State, View, Action> = {
  manifest,

  init({ rng, players }) {
    // Jobs are dealt at random, on their own stream so the melody doesn't depend on them.
    const [listener, ...arrangers] = rng.fork('roles').shuffle(players);
    if (!listener || arrangers.length === 0) throw new Error('needs a listener and an arranger');
    const sounds = rng.shuffle(SOUNDS.map((_, i) => i));
    const symbols = rng.shuffle(SYMBOLS);
    const tiles: Tile[] = sounds.map((sound, i) => ({
      id: `n${i}`,
      symbol: symbols[i] ?? '?',
      sound,
      owner: arrangers[i % arrangers.length]?.id ?? '',
    }));
    // The melody is the notes in the order they were drawn; the slots start scrambled.
    const answer = tiles.map((t) => t.id);
    let slots = rng.shuffle(answer);
    while (sameOrder(slots, answer)) slots = rng.shuffle(answer);
    return {
      tiles,
      answer,
      slots,
      listener: listener.id,
      targetPlays: 0,
      lastPlay: null,
      plays: 0,
      playLockedUntil: 0,
      solved: false,
    };
  },

  view(state, playerId) {
    const byId = new Map(state.tiles.map((t) => [t.id, t]));
    const soundOf = (id: string) => byId.get(id)?.sound ?? 0;
    if (playerId === state.listener) {
      return {
        role: 'listener',
        target: state.answer.map(soundOf),
        targetPlays: state.targetPlays,
        playback: state.lastPlay && {
          id: state.lastPlay.id,
          sounds: state.lastPlay.tileIds.map(soundOf),
        },
        solved: state.solved,
      };
    }
    return {
      role: 'arranger',
      slots: state.slots.map((id) => {
        const tile = byId.get(id);
        return { id, symbol: tile?.symbol ?? '?', mine: tile?.owner === playerId };
      }),
      plays: state.plays,
      playLockedUntil: state.playLockedUntil,
      solved: state.solved,
    };
  },

  apply(state, playerId, action, ctx) {
    const isListener = playerId === state.listener;
    switch (action?.type) {
      case 'replay':
        if (!isListener) return { reject: 'Only the Listener can hear the melody' };
        // As often as they like.
        return { state: { ...state, targetPlays: state.targetPlays + 1 } };

      case 'swap': {
        if (isListener) return { reject: 'Only arrangers move tiles' };
        const { a, b } = action;
        const n = state.slots.length;
        if (!Number.isInteger(a) || !Number.isInteger(b) || a < 0 || b < 0 || a >= n || b >= n) {
          return { reject: 'No such slot' };
        }
        if (a === b) return { state };
        const owners = new Map(state.tiles.map((t) => [t.id, t.owner]));
        const [ta, tb] = [state.slots[a] as string, state.slots[b] as string];
        if (owners.get(ta) !== playerId && owners.get(tb) !== playerId) {
          return { reject: 'Move one of your own tiles' };
        }
        const slots = [...state.slots];
        [slots[a], slots[b]] = [tb, ta];
        return { state: { ...state, slots } };
      }

      case 'play': {
        if (isListener) return { reject: 'Only arrangers can play the arrangement' };
        if (ctx.elapsedMs < state.playLockedUntil) {
          return { reject: 'Wait for the playback to finish' };
        }
        const plays = state.plays + 1;
        return {
          state: {
            ...state,
            plays,
            lastPlay: { id: plays, tileIds: [...state.slots] },
            playLockedUntil: ctx.elapsedMs + PLAYBACK_MS,
            solved: sameOrder(state.slots, state.answer),
          },
        };
      }

      default:
        return { reject: 'Unknown action' };
    }
  },

  isSolved: (state) => state.solved,

  score: (state) => ({ moves: state.plays }),
};

export default puzzle;
