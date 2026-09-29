import type { Rng } from '@split-signal/shared';
import type { CookStep, Heat } from './types';

/** Every ingredient and the ways it can be prepped. */
export const INGREDIENTS: Record<string, string[]> = {
  onion: ['dice', 'slice', 'chop'],
  tomato: ['dice', 'slice', 'chop'],
  cheese: ['grate', 'slice'],
  mushroom: ['slice', 'chop'],
  pepper: ['dice', 'slice', 'chop'],
  garlic: ['crush', 'chop', 'slice'],
  egg: ['crack', 'whisk'],
  herbs: ['chop', 'tear'],
};

export const RECIPE_INGREDIENTS = 3;
export const PANTRY_SIZE = 6;

export interface Recipe {
  /** Plain-text lines, later written in glyphs: prep lines first, then cooking lines. */
  text: string[];
  steps: CookStep[];
  pantry: string[];
}

/** A short recipe: prep three ingredients, then heat, add, stir, and plate in a set order. */
export function generateRecipe(rng: Rng): Recipe {
  const all = Object.keys(INGREDIENTS);
  const pantry = rng.shuffle(all).slice(0, PANTRY_SIZE);
  const chosen = rng.shuffle(pantry).slice(0, RECIPE_INGREDIENTS);
  const preps = chosen.map((ingredient) => ({
    ingredient,
    method: rng.pick(INGREDIENTS[ingredient] ?? ['chop']),
  }));
  const levels = rng.shuffle(['low', 'med', 'high'] as Array<Exclude<Heat, 'off'>>);
  const [first, second, third] = preps as [
    (typeof preps)[number],
    (typeof preps)[number],
    (typeof preps)[number],
  ];

  const steps: CookStep[] = [
    { kind: 'heat', level: levels[0] ?? 'med' },
    { kind: 'add', ...first },
    { kind: 'stir' },
    { kind: 'add', ...second },
    { kind: 'heat', level: levels[1] ?? 'low' },
    { kind: 'add', ...third },
    { kind: 'stir' },
    { kind: 'plate' },
  ];

  const describe = (step: CookStep) => {
    switch (step.kind) {
      case 'heat':
        return `heat ${step.level}`;
      case 'add':
        return `add ${step.ingredient}`;
      case 'stir':
        return 'stir';
      case 'plate':
        return 'plate';
    }
  };

  return {
    text: [...preps.map((p) => `${p.method} ${p.ingredient}`), ...steps.map(describe)],
    steps,
    pantry,
  };
}
