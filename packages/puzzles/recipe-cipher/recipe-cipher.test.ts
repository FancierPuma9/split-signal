import { createRng } from '@split-signal/shared';
import { describe, expect, it } from 'vitest';
import { startPuzzle, type HiddenInfo, type PuzzleDriver } from '../harness';
import { generateGlyphs } from './glyphs';
import { INGREDIENTS, generateRecipe } from './recipe';
import puzzle, { PREP_MS, SMOKE_MS, TRAY_LIMIT } from './server';
import type { Action, State, View } from './types';

type Game = PuzzleDriver<State, View, Action>;

const seatOf = (game: Game, id: string) => game.players.findIndex((p) => p.id === id);

/** Plays the recipe perfectly: prep each ingredient just before it's added. */
function cook(game: Game) {
  const prep = seatOf(game, game.state.roles.prep);
  const cookSeat = seatOf(game, game.state.roles.cook);
  for (const step of game.state.steps) {
    if (step.kind === 'add') {
      game.advance(PREP_MS);
      game.act(prep, { type: 'prep', ingredient: step.ingredient, method: step.method });
      const item = game.state.tray.at(-1)!;
      game.act(cookSeat, { type: 'add', itemId: item.id });
    } else if (step.kind === 'heat') {
      game.act(cookSeat, { type: 'heat', level: step.level });
    } else {
      game.act(cookSeat, { type: step.kind });
    }
  }
}

const hidden: HiddenInfo<State>[] = [
  {
    name: 'the decoding key',
    hiddenFrom: (p) => p.seat === 0 || p.seat === 2,
    change: (s) => ({
      ...s,
      letterOf: Object.fromEntries(
        Object.entries(s.letterOf).map(([g, l]) => [
          g,
          String.fromCharCode(((l.charCodeAt(0) - 96) % 26) + 97),
        ]),
      ),
    }),
  },
  {
    name: 'the written recipe',
    hiddenFrom: (p) => p.seat !== 0,
    change: (s) => ({ ...s, lines: s.lines.map((line) => [...line].reverse()) }),
  },
];

describe('glyphs and recipes', () => {
  it('draws distinct glyphs deterministically', () => {
    const glyphs = generateGlyphs(26, createRng('g'));
    expect(glyphs).toEqual(generateGlyphs(26, createRng('g')));
    const signatures = new Set(glyphs.map((g) => `${g.d}|${JSON.stringify(g.dots)}`));
    expect(signatures.size).toBe(26);
    expect(glyphs.every((g) => g.d.length > 0)).toBe(true);
  });

  it('builds a recipe from pantry ingredients with valid prep methods', () => {
    const recipe = generateRecipe(createRng('r'));
    for (const step of recipe.steps) {
      if (step.kind !== 'add') continue;
      expect(recipe.pantry).toContain(step.ingredient);
      expect(INGREDIENTS[step.ingredient]).toContain(step.method);
    }
    expect(recipe.steps.at(-1)).toEqual({ kind: 'plate' });
  });
});

describe('recipe cipher', () => {
  it('splits roles for two and three players', () => {
    const two = startPuzzle(puzzle, { players: 2, hidden: [hidden[0]!] });
    expect(two.view(0).roles).toEqual(['glyphs', 'prep']);
    expect(two.view(1).roles).toEqual(['key', 'cook']);
    const three = startPuzzle(puzzle, { players: 3, hidden });
    expect(three.view(0).roles).toEqual(['glyphs']);
    expect(three.view(1).roles).toEqual(['key', 'prep']);
    expect(three.view(2).roles).toEqual(['cook']);
  });

  it('writes the recipe so that the key decodes it', () => {
    const game = startPuzzle(puzzle, { players: 2 });
    const { lines } = game.view(0);
    const key = new Map(game.view(1).key!.map((k) => [k.glyph, k.letter]));
    const text = lines!.map((line) => line.map((g) => (g === ' ' ? ' ' : key.get(g))).join(''));
    expect(text.at(-1)).toBe('plate');
    expect(text).toContain('stir');
    expect(game.view(0).key).toBeNull();
    expect(game.view(1).lines).toBeNull();
  });

  it('is solved by following the recipe', () => {
    const game = startPuzzle(puzzle, { players: 3, hidden });
    cook(game);
    expect(game.solved).toBe(true);
    expect(game.state.mistakes).toBe(0);
  });

  it('fills the kitchen with smoke on a wrong step, without losing progress', () => {
    const game = startPuzzle(puzzle, { players: 2 });
    const first = game.state.steps[0]!;
    expect(first.kind).toBe('heat');
    game.act(1, { type: 'stir' }); // wrong: should heat first
    expect(game.state.mistakes).toBe(1);
    expect(game.state.progress).toBe(0);
    expect(game.act(1, { type: 'stir' })).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/smoke/),
    });
    game.advance(SMOKE_MS);
    if (first.kind === 'heat') game.act(1, { type: 'heat', level: first.level });
    expect(game.state.progress).toBe(1);
  });

  it('burns a wrongly prepped ingredient', () => {
    const game = startPuzzle(puzzle, { players: 2 });
    const heat = game.state.steps[0]!;
    if (heat.kind === 'heat') game.act(1, { type: 'heat', level: heat.level });
    const add = game.state.steps[1]!;
    if (add.kind !== 'add') throw new Error('expected an add step');
    const wrong = (INGREDIENTS[add.ingredient] ?? []).find((m) => m !== add.method)!;
    game.act(0, { type: 'prep', ingredient: add.ingredient, method: wrong });
    game.act(1, { type: 'add', itemId: game.state.tray[0]!.id });
    expect(game.state.tray).toHaveLength(0);
    expect(game.state.mistakes).toBe(1);
    expect(game.state.progress).toBe(1);
  });

  it('limits prep speed and tray size', () => {
    const game = startPuzzle(puzzle, { players: 2 });
    const ingredient = game.state.pantry[0]!;
    const method = INGREDIENTS[ingredient]![0]!;
    game.act(0, { type: 'prep', ingredient, method });
    expect(game.act(0, { type: 'prep', ingredient, method })).toMatchObject({ ok: false });
    for (let i = 1; i < TRAY_LIMIT; i++) {
      game.advance(PREP_MS);
      game.act(0, { type: 'prep', ingredient, method });
    }
    game.advance(PREP_MS);
    expect(game.act(0, { type: 'prep', ingredient, method })).toMatchObject({
      reason: 'The tray is full',
    });
    game.act(1, { type: 'discard', itemId: game.state.tray[0]!.id });
    expect(game.state.tray).toHaveLength(TRAY_LIMIT - 1);
  });

  it('keeps each station to its role', () => {
    const game = startPuzzle(puzzle, { players: 2 });
    expect(
      game.act(1, { type: 'prep', ingredient: game.state.pantry[0]!, method: 'chop' }),
    ).toMatchObject({
      ok: false,
    });
    expect(game.act(0, { type: 'stir' })).toMatchObject({ ok: false });
  });
});
