import type { PuzzleServerModule } from '@split-signal/shared';
import { generateGlyphs } from './glyphs';
import { manifest } from './manifest';
import { INGREDIENTS, generateRecipe } from './recipe';
import { HEATS, type Action, type Roles, type State, type View } from './types';

/** Knife time per item, so nobody can prep every combination. */
export const PREP_MS = 1500;
/** A wrong step fills the kitchen with smoke: the stove is unusable for this long. */
export const SMOKE_MS = 5000;
export const TRAY_LIMIT = 4;

const LETTERS = [...'abcdefghijklmnopqrstuvwxyz'];

function rolesFor(ids: string[]): Roles {
  const [a = '', b = '', c] = ids;
  return c ? { glyphs: a, key: b, prep: b, cook: c } : { glyphs: a, prep: a, key: b, cook: b };
}

const puzzle: PuzzleServerModule<State, View, Action> = {
  manifest,

  init({ rng, players }) {
    const recipe = generateRecipe(rng.fork('recipe'));
    const glyphs = generateGlyphs(LETTERS.length, rng.fork('glyphs'));
    const letters = rng.fork('key').shuffle(LETTERS);
    const letterOf: Record<string, string> = {};
    const glyphFor: Record<string, string> = {};
    glyphs.forEach((g, i) => {
      const letter = letters[i] as string;
      letterOf[g.id] = letter;
      glyphFor[letter] = g.id;
    });
    return {
      glyphs,
      letterOf,
      lines: recipe.text.map((line) =>
        [...line].map((ch) => (ch === ' ' ? ' ' : (glyphFor[ch] ?? ' '))),
      ),
      steps: recipe.steps,
      progress: 0,
      heat: 'off',
      pan: [],
      tray: [],
      pantry: recipe.pantry,
      nextItem: 0,
      prepLockedUntil: 0,
      stoveLockedUntil: 0,
      mistakes: 0,
      roles: rolesFor(players.map((p) => p.id)),
      solved: false,
    };
  },

  view(state, playerId) {
    const { roles } = state;
    const has = (role: keyof Roles) => roles[role] === playerId;
    return {
      lines: has('glyphs') ? state.lines : null,
      glyphs: state.glyphs,
      key: has('key')
        ? state.glyphs.map((g) => ({ glyph: g.id, letter: state.letterOf[g.id] ?? '?' }))
        : null,
      stove: has('cook')
        ? {
            heat: state.heat,
            pan: state.pan,
            tray: state.tray,
            lockedUntil: state.stoveLockedUntil,
          }
        : null,
      prep: has('prep')
        ? {
            pantry: state.pantry.map((ingredient) => ({
              ingredient,
              methods: INGREDIENTS[ingredient] ?? [],
            })),
            tray: state.tray,
            trayLimit: TRAY_LIMIT,
            lockedUntil: state.prepLockedUntil,
          }
        : null,
      progress: state.progress,
      totalSteps: state.steps.length,
      mistakes: state.mistakes,
      roles: (['glyphs', 'key', 'prep', 'cook'] as const).filter(has),
      solved: state.solved,
    };
  },

  apply(state, playerId, action, ctx) {
    const now = ctx.elapsedMs;
    const { roles } = state;

    if (action?.type === 'prep') {
      if (roles.prep !== playerId) return { reject: "You're not at the prep station" };
      if (now < state.prepLockedUntil) return { reject: 'Still chopping…' };
      if (!state.pantry.includes(action.ingredient)) return { reject: 'Not in the pantry' };
      if (!INGREDIENTS[action.ingredient]?.includes(action.method)) {
        return { reject: `You can't ${action.method} that` };
      }
      if (state.tray.length >= TRAY_LIMIT) return { reject: 'The tray is full' };
      const item = {
        id: `i${state.nextItem}`,
        ingredient: action.ingredient,
        method: action.method,
      };
      return {
        state: {
          ...state,
          tray: [...state.tray, item],
          nextItem: state.nextItem + 1,
          prepLockedUntil: now + PREP_MS,
        },
      };
    }

    if (action?.type === 'discard') {
      if (roles.prep !== playerId && roles.cook !== playerId) return { reject: 'Not your tray' };
      if (!state.tray.some((i) => i.id === action.itemId)) return { reject: 'No such item' };
      return { state: { ...state, tray: state.tray.filter((i) => i.id !== action.itemId) } };
    }

    if (!['heat', 'add', 'stir', 'plate'].includes(action?.type))
      return { reject: 'Unknown action' };
    if (roles.cook !== playerId) return { reject: "You're not at the stove" };
    if (now < state.stoveLockedUntil) return { reject: 'The kitchen is full of smoke! Wait…' };

    const expected = state.steps[state.progress];
    const advance = (changes: Partial<State>): { state: State } => {
      const progress = state.progress + 1;
      return { state: { ...state, ...changes, progress, solved: progress >= state.steps.length } };
    };
    const smoke = (changes: Partial<State> = {}): { state: State } => ({
      state: {
        ...state,
        ...changes,
        mistakes: state.mistakes + 1,
        stoveLockedUntil: now + SMOKE_MS,
      },
    });

    switch (action.type) {
      case 'heat': {
        if (!HEATS.includes(action.level)) return { reject: 'No such heat' };
        if (action.level === state.heat) return { state };
        return expected?.kind === 'heat' && expected.level === action.level
          ? advance({ heat: action.level })
          : smoke({ heat: action.level });
      }
      case 'add': {
        const item = state.tray.find((i) => i.id === action.itemId);
        if (!item) return { reject: 'No such item' };
        const tray = state.tray.filter((i) => i !== item);
        const right =
          expected?.kind === 'add' &&
          expected.ingredient === item.ingredient &&
          expected.method === item.method;
        // A wrong ingredient burns and is gone.
        return right ? advance({ tray, pan: [...state.pan, item] }) : smoke({ tray });
      }
      case 'stir':
        return expected?.kind === 'stir' ? advance({}) : smoke();
      case 'plate':
        return expected?.kind === 'plate' ? advance({}) : smoke();
    }
  },

  isSolved: (state) => state.solved,

  score: (state) => ({ moves: state.mistakes }),
};

export default puzzle;
