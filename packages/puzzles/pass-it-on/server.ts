import type { ClipTransform, PuzzleManifest, PuzzleServerModule } from '@split-signal/shared';
import { PARTS, SLOTS, STEPS, TOOLS, countWrong, newState, sameStep } from './assembly';
import type { Action, State, View } from './types';

/** Added to the finishing time for every step that doesn't match. */
export const PENALTY_MS = 15_000;

export interface PassItOnVariant {
  id: string;
  name: string;
  description: string;
  transform: ClipTransform;
}

export const SHUFFLED: PassItOnVariant = {
  id: 'pass-it-on',
  name: 'Pass It On',
  description:
    'Clips only go one way round your team, and they arrive chopped up and shuffled. The ' +
    'Builder has the parts, the Reader the steps in glyphs, the Keyholder what the glyphs mean.',
  transform: { kind: 'shuffle', sliceMs: 600 },
};

export function manifestFor(variant: PassItOnVariant): PuzzleManifest {
  return {
    id: variant.id,
    name: variant.name,
    description: variant.description,
    teams: { min: 1, max: 3 },
    playersPerTeam: { min: 3, max: 4 },
    winCondition: 'race',
    goal: `Fastest build wins; every wrong step adds ${PENALTY_MS / 1000}s`,
    timeLimitSeconds: 240,
    // A team that finishes with mistakes can still be beaten by one that takes longer but gets
    // it right, so the others get time to finish.
    raceGraceMs: PENALTY_MS * STEPS,
    comms: { type: 'clips', maxSeconds: 5, direction: 'ring', transform: variant.transform },
  };
}

export function createPassItOn(variant: PassItOnVariant): PuzzleServerModule<State, View, Action> {
  const builder = (state: State, playerId: string) => state.roles[playerId] === 'builder';

  return {
    manifest: manifestFor(variant),

    init({ rng, players, roundIndex }) {
      if (players.length < 3) throw new Error('Pass It On needs 3 or 4 players');
      return newState(rng, players, roundIndex);
    },

    view(state, playerId): View {
      switch (state.roles[playerId]) {
        case 'builder':
          return {
            role: 'builder',
            parts: [...PARTS],
            tools: [...TOOLS],
            slots: SLOTS,
            steps: STEPS,
            assembly: state.assembly,
            finished: state.finishedAt !== null,
          };
        case 'reader':
          return {
            role: 'reader',
            glyphs: state.glyphs,
            steps: state.target.map((step) => ({
              glyph: state.partGlyph[step.part]!,
              slot: step.slot,
              ...(state.toolsmith
                ? {}
                : { toolGlyph: step.tool === null ? null : state.toolGlyph[step.tool]! }),
            })),
          };
        case 'toolsmith':
          return {
            role: 'toolsmith',
            tools: state.target.map((step, i) => ({
              step: i + 1,
              tool: TOOLS.find((t) => t.id === step.tool) ?? null,
            })),
          };
        default:
          return {
            role: 'keyholder',
            glyphs: state.glyphs,
            parts: PARTS.map((part) => ({ glyph: state.partGlyph[part.id]!, part })),
            ...(state.toolsmith
              ? {}
              : { tools: TOOLS.map((tool) => ({ glyph: state.toolGlyph[tool.id]!, tool })) }),
          };
      }
    },

    apply(state, playerId, action, ctx) {
      if (!builder(state, playerId)) return { reject: 'Only the Builder builds' };
      switch (action?.type) {
        case 'attach': {
          if (!PARTS.some((p) => p.id === action.partId)) return { reject: 'No such part' };
          if (!Number.isInteger(action.slot) || action.slot < 1 || action.slot > SLOTS) {
            return { reject: 'No such slot' };
          }
          if (state.assembly.length >= STEPS) return { reject: `That's all ${STEPS} steps` };
          if (state.assembly.some((s) => s.part === action.partId)) {
            return { reject: 'That part is already on' };
          }
          const step = { part: action.partId, slot: action.slot, tool: null };
          return { state: { ...state, assembly: [...state.assembly, step] } };
        }
        case 'useTool': {
          if (!TOOLS.some((t) => t.id === action.toolId)) return { reject: 'No such tool' };
          const last = state.assembly.at(-1);
          if (!last) return { reject: 'Attach a part first' };
          if (last.tool === action.toolId) return { state };
          const assembly = [...state.assembly.slice(0, -1), { ...last, tool: action.toolId }];
          return { state: { ...state, assembly } };
        }
        case 'undo':
          if (state.assembly.length === 0) return { reject: 'Nothing to undo' };
          return { state: { ...state, assembly: state.assembly.slice(0, -1) } };
        case 'finish':
          if (state.assembly.length < STEPS) return { reject: `Build all ${STEPS} steps first` };
          return {
            state: {
              ...state,
              finishedAt: ctx.elapsedMs,
              wrong: countWrong(state.target, state.assembly),
            },
          };
        default:
          return { reject: 'Unknown action' };
      }
    },

    reveal(state) {
      return {
        role: 'reveal',
        steps: state.target.map((target, i) => ({
          target,
          built: state.assembly[i] ?? null,
          right: sameStep(target, state.assembly[i]),
        })),
        wrong: state.finishedAt === null ? countWrong(state.target, state.assembly) : state.wrong,
        penaltyMs: PENALTY_MS,
        parts: [...PARTS],
        tools: [...TOOLS],
      };
    },

    isSolved: (state) => state.finishedAt !== null,

    score: (state) =>
      state.finishedAt === null
        ? {}
        : { elapsedMs: state.finishedAt + state.wrong * PENALTY_MS, moves: state.wrong },
  };
}

export default createPassItOn(SHUFFLED);
