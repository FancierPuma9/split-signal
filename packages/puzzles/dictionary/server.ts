import type { PuzzleServerModule } from '@split-signal/shared';
import { manifest } from './manifest';
import { STAGES, generateTasks, isCorrect, soundsFor, startControls } from './stages';
import type { Action, Controls, ReceiverTask, State, Task, View } from './types';

/** A wrong submit locks the Receiver out this long. */
export const LOCKOUT_MS = 5000;

function receiverTask(task: Task): ReceiverTask {
  switch (task.kind) {
    case 'pick':
      return { kind: 'pick', shapes: task.shapes };
    case 'order':
      return { kind: 'order', count: task.answer.length };
    case 'dials':
      return { kind: 'dials' };
    case 'rotate':
      return { kind: 'rotate', count: task.answer.length };
  }
}

/** Applies a Receiver control action, or explains why not. */
function operate(controls: Controls, action: Action): Controls | string {
  switch (action.type) {
    case 'pick':
      if (controls.kind !== 'pick') return 'Nothing to pick here';
      return { ...controls, selected: action.index };
    case 'swap': {
      if (controls.kind !== 'order' && controls.kind !== 'rotate') return 'Nothing to arrange';
      const n = controls.tiles.length;
      const ok = (i: number) => Number.isInteger(i) && i >= 0 && i < n;
      if (!ok(action.a) || !ok(action.b)) return 'No such tile';
      const tiles = [...controls.tiles];
      [tiles[action.a], tiles[action.b]] = [tiles[action.b]!, tiles[action.a]!];
      return { ...controls, tiles };
    }
    case 'rotate': {
      if (controls.kind !== 'rotate') return 'Nothing to turn';
      const tile = controls.tiles[action.position];
      if (tile === undefined) return 'No such tile';
      return {
        ...controls,
        turns: { ...controls.turns, [tile]: ((controls.turns[tile] ?? 0) + 1) % 4 },
      };
    }
    case 'setDial': {
      if (controls.kind !== 'dials') return 'No dials here';
      if (action.dial !== 0 && action.dial !== 1) return 'No such dial';
      if (!Number.isInteger(action.value) || action.value < 0 || action.value > 9) {
        return 'Dials go from 0 to 9';
      }
      const values: [number, number] = [...controls.values];
      values[action.dial] = action.value;
      return { ...controls, values };
    }
    default:
      return 'Unknown action';
  }
}

const puzzle: PuzzleServerModule<State, View, Action> = {
  manifest,

  init({ rng, players, roundIndex }) {
    if (players.length < 2) throw new Error('Dictionary needs 2 players');
    const bySeat = [...players].sort((a, b) => a.seat - b.seat);
    const sender = bySeat[roundIndex % 2]!.id;
    const tasks = generateTasks(rng);
    return {
      sender,
      receiver: bySeat.find((p) => p.id !== sender)!.id,
      tasks,
      stage: 0,
      controls: startControls(tasks[0]!),
      lockedUntil: null,
      clearedAt: null,
      wrongSubmits: 0,
    };
  },

  view(state, playerId): View {
    const task = state.tasks[state.stage] ?? null;
    const common = {
      stage: state.stage,
      stages: STAGES,
      controls: state.controls,
      lockedUntil: state.lockedUntil,
      done: state.stage >= STAGES,
    };
    const sounds = soundsFor(state.stage);
    if (playerId === state.sender) {
      return {
        role: 'sender',
        ...common,
        task,
        sounds,
        nextSounds: soundsFor(state.stage + 1).slice(sounds.length),
      };
    }
    return { role: 'receiver', ...common, task: task && receiverTask(task), sounds };
  },

  apply(state, playerId, action, ctx) {
    if (playerId !== state.receiver) return { reject: 'Only the Receiver works the controls' };
    const task = state.tasks[state.stage];
    if (!task || !state.controls) return { reject: 'All stages are done' };
    if (state.lockedUntil !== null && ctx.elapsedMs < state.lockedUntil) {
      return { reject: 'Locked after a wrong answer' };
    }
    if (action?.type === 'submit') {
      if (!isCorrect(task, state.controls)) {
        return {
          state: {
            ...state,
            lockedUntil: ctx.elapsedMs + LOCKOUT_MS,
            wrongSubmits: state.wrongSubmits + 1,
          },
        };
      }
      const stage = state.stage + 1;
      const next = state.tasks[stage];
      return {
        state: {
          ...state,
          stage,
          controls: next ? startControls(next) : null,
          lockedUntil: null,
          clearedAt: ctx.elapsedMs,
        },
      };
    }
    const controls = operate(state.controls, action);
    if (typeof controls === 'string') return { reject: controls };
    return { state: { ...state, controls } };
  },

  // Sounds are the Sender's only voice, and only the unlocked ones exist yet.
  onSignal(state, from, signal) {
    if (from !== state.sender) return { reject: 'Only the Sender has sound buttons' };
    if (!soundsFor(state.stage).includes(signal)) return { reject: `${signal} isn't unlocked yet` };
    return state;
  },

  // The Sender has no mic at all; the Receiver's voice goes one way, to them.
  commsState: (state, playerId) => (playerId === state.sender ? { send: false } : {}),

  reveal(state) {
    return {
      role: 'reveal',
      cleared: Math.min(state.stage, STAGES),
      stages: STAGES,
      wrongSubmits: state.wrongSubmits,
    };
  },

  isSolved: (state) => state.stage >= STAGES,

  score: (state) => ({
    points: Math.min(state.stage, STAGES),
    ...(state.clearedAt !== null ? { elapsedMs: state.clearedAt } : {}),
  }),
};

export default puzzle;
