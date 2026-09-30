import { describe, expect, it } from 'vitest';
import { startPuzzle, type HiddenInfo, type PuzzleDriver } from '../harness';
import { colorDistance, deltaE2000, rgbToLab } from './color';
import puzzle, { HOLD_MS, TOLERANCE, mixOf } from './server';
import type { Action, State, View } from './types';

describe('color math', () => {
  it('converts sRGB to Lab', () => {
    const white = rgbToLab({ r: 255, g: 255, b: 255 });
    expect(white.L).toBeCloseTo(100, 1);
    expect(white.a).toBeCloseTo(0, 1);
    expect(white.b).toBeCloseTo(0, 1);
    expect(rgbToLab({ r: 0, g: 0, b: 0 }).L).toBeCloseTo(0, 5);
    const red = rgbToLab({ r: 255, g: 0, b: 0 });
    expect(red.L).toBeCloseTo(53.24, 1);
    expect(red.a).toBeCloseTo(80.09, 1);
    expect(red.b).toBeCloseTo(67.2, 1);
  });

  it('matches the published CIEDE2000 test pairs (Sharma, Wu & Dalal 2005)', () => {
    const cases: Array<[[number, number, number], [number, number, number], number]> = [
      [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
      [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
      [[50, 0, 0], [50, -1, 2], 2.3669],
      [[50, 2.5, 0], [73, 25, -18], 27.1492],
      [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
    ];
    for (const [[L1, a1, b1], [L2, a2, b2], expected] of cases) {
      expect(deltaE2000({ L: L1, a: a1, b: b1 }, { L: L2, a: a2, b: b2 })).toBeCloseTo(expected, 3);
    }
  });

  it('is zero for identical colors and grows with difference', () => {
    const c = { r: 120, g: 40, b: 200 };
    expect(colorDistance(c, c)).toBe(0);
    expect(colorDistance(c, { r: 122, g: 40, b: 200 })).toBeLessThan(TOLERANCE);
    expect(colorDistance(c, { r: 20, g: 200, b: 40 })).toBeGreaterThan(50);
  });
});

type Game = PuzzleDriver<State, View, Action>;

const seatOf = (game: Game, id: string) => game.players.findIndex((p) => p.id === id);
const mixers = (state: State) =>
  Object.keys(state.sliders).filter((id) => id !== state.targetViewer);

const hiddenFor = (players: number): HiddenInfo<State>[] => [
  {
    name: 'the target color',
    hiddenFrom: (p, s) => p.id !== s.targetViewer,
    change: (state) => ({ ...state, target: { ...state.target, r: (state.target.r + 40) % 256 } }),
  },
  ...Array.from({ length: players - 1 }, (_, i) => ({
    name: `mixer ${i + 1}'s sliders`,
    hiddenFrom: (p: { id: string }, s: State) => p.id === s.targetViewer,
    change: (state: State) => {
      const id = mixers(state)[i] as string;
      const ch = state.controls[id]?.[0] ?? 'r';
      const s = state.sliders[id]!;
      return {
        ...state,
        sliders: { ...state.sliders, [id]: { ...s, [ch]: (s[ch] + 1) % state.max } },
      };
    },
  })),
];

/** Sets both players' sliders so the mix equals the target exactly (two-player layout). */
function matchTarget(game: Game) {
  const { target, max } = game.state;
  for (const ch of ['r', 'g', 'b'] as const) {
    const first = Math.min(max, target[ch]);
    game.act(0, { type: 'set', channel: ch, value: first });
    game.act(1, { type: 'set', channel: ch, value: target[ch] - first });
  }
}

describe('color mix', () => {
  it('shows the target to one player only and the mix to everyone else', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden: hiddenFor(2) });
    const viewer = seatOf(game, game.state.targetViewer);
    expect(game.view(viewer)).toMatchObject({ role: 'target', swatch: game.state.target });
    expect(game.view(1 - viewer)).toMatchObject({ role: 'mix', swatch: mixOf(game.state) });
  });

  it('deals the target to a random player', () => {
    const viewers = new Set<number>();
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const game = startPuzzle(puzzle, { players: 3, seed });
      viewers.add(seatOf(game, game.state.targetViewer));
    }
    expect(viewers.size).toBeGreaterThan(1);
  });

  it('starts far from the target, with a reachable target', () => {
    for (const seed of ['a', 'b', 'c', 'd']) {
      const game = startPuzzle(puzzle, { players: 2, seed });
      expect(colorDistance(mixOf(game.state), game.state.target)).toBeGreaterThan(TOLERANCE);
      for (const ch of ['r', 'g', 'b'] as const) {
        expect(game.state.target[ch]).toBeLessThanOrEqual(254);
      }
    }
  });

  it('splits one channel per player for three players', () => {
    const game = startPuzzle(puzzle, { players: 3, hidden: hiddenFor(3) });
    const controls = [0, 1, 2].map((seat) => game.view(seat).controls).sort();
    expect(controls).toEqual([['b'], ['g'], ['r']]);
    expect(game.state.max).toBe(255);
  });

  it('is solved only after the match holds for the full hold time', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden: hiddenFor(2) });
    game.advance(1000);
    matchTarget(game);
    expect(game.state.matchSince).toBe(1000);
    game.advance(HOLD_MS - 100);
    expect(game.solved).toBe(false);
    game.advance(100);
    expect(game.solved).toBe(true);
  });

  it('resets the hold when the mix drifts away', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden: hiddenFor(2) });
    matchTarget(game);
    game.advance(1000);
    // A fixed nudge isn't enough: CIEDE2000 barely notices, say, less red in a vivid blue. Pull
    // everything toward black instead, which is always far off.
    for (const seat of [0, 1]) {
      for (const ch of ['r', 'g', 'b'] as const)
        game.act(seat, { type: 'set', channel: ch, value: 0 });
    }
    expect(colorDistance(mixOf(game.state), game.state.target)).toBeGreaterThan(TOLERANCE);
    expect(game.state.matchSince).toBeNull();
    game.advance(HOLD_MS);
    expect(game.solved).toBe(false);
  });

  it("rejects out-of-range values and other players' channels", () => {
    const game = startPuzzle(puzzle, { players: 3, hidden: hiddenFor(3) });
    const mine = game.view(0).controls[0]!;
    const other = (['r', 'g', 'b'] as const).find((ch) => ch !== mine)!;
    expect(game.act(0, { type: 'set', channel: other, value: 10 })).toMatchObject({ ok: false });
    expect(game.act(0, { type: 'set', channel: mine, value: 256 })).toMatchObject({ ok: false });
    expect(game.act(0, { type: 'set', channel: mine, value: 1.5 })).toMatchObject({ ok: false });
  });
});
