import type { PuzzleManifest, PuzzleServerModule, ServerMessage } from '@split-signal/shared';

interface TapState {
  moves: number;
  solved: boolean;
  /** From the seeded rng, so tests can check every team got the same puzzle. */
  seedValue: number;
  /** Signals received through onSignal. */
  signals: string[];
}
type TapAction = { type: 'tap' } | { type: 'solve' };

/** A controllable test puzzle: 'tap' counts a move, 'solve' solves it. */
export function tapPuzzle(
  overrides: Partial<PuzzleManifest> = {},
): PuzzleServerModule<TapState, TapState, TapAction> {
  return {
    manifest: {
      id: 'tap',
      name: 'Tap',
      description: 'Tap, then solve.',
      teams: { min: 1, max: 3 },
      playersPerTeam: { min: 1, max: 4 },
      winCondition: 'race',
      timeLimitSeconds: 10,
      comms: { type: 'none' },
      ...overrides,
    },
    init: ({ rng }) => ({
      moves: 0,
      solved: false,
      seedValue: rng.int(0, 1_000_000),
      signals: [],
    }),
    view: (state) => state,
    onSignal: (state, _from, signal) => ({ ...state, signals: [...state.signals, signal] }),
    apply: (state, _playerId, action) => {
      if (action?.type === 'tap') return { state: { ...state, moves: state.moves + 1 } };
      if (action?.type === 'solve') return { state: { ...state, solved: true } };
      return { reject: 'Unknown action' };
    },
    isSolved: (state) => state.solved,
    score: (state) => ({ moves: state.moves }),
  };
}

/** Collects messages sent to one fake connection. */
export function inbox() {
  const messages: ServerMessage[] = [];
  return {
    messages,
    send: (message: ServerMessage) => {
      messages.push(message);
    },
    last<T extends ServerMessage['type']>(type: T) {
      return messages
        .filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type)
        .at(-1);
    },
    all<T extends ServerMessage['type']>(type: T) {
      return messages.filter((m): m is Extract<ServerMessage, { type: T }> => m.type === type);
    },
    clear() {
      messages.length = 0;
    },
  };
}
