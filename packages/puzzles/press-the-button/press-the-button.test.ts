import { describe, expect, it } from 'vitest';
import { runPuzzleScript, startPuzzle, type HiddenInfo } from '../harness';
import puzzle from './server';
import { BUTTON_COLORS, type ButtonColor, type State } from './types';

const nextColor = (color: ButtonColor): ButtonColor =>
  BUTTON_COLORS[(BUTTON_COLORS.indexOf(color) + 1) % BUTTON_COLORS.length] ?? color;

// Each player only sees their own button's color.
const hiddenFor = (players: number): HiddenInfo<State>[] =>
  Array.from({ length: players }, (_, seat) => ({
    name: `seat ${seat}'s button color`,
    hiddenFrom: (player) => player.seat !== seat,
    change: (state) => ({
      buttons: state.buttons.map((b, i) => (i === seat ? { ...b, color: nextColor(b.color) } : b)),
    }),
  }));

describe('press the button', () => {
  it('is solved once everyone has pressed', () => {
    runPuzzleScript(puzzle, {
      players: 3,
      hidden: hiddenFor(3),
      steps: [
        { seat: 0, action: { type: 'press' } },
        { seat: 0, action: { type: 'press' }, expect: 'reject' },
        { seat: 1, action: { type: 'press' } },
        { seat: 2, action: { type: 'press' } },
      ],
      expectScore: { moves: 3 },
    });
  });

  it('works solo', () => {
    runPuzzleScript(puzzle, { players: 1, steps: [{ seat: 0, action: { type: 'press' } }] });
  });

  it('is not solved until the last press', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden: hiddenFor(2) });
    game.act(1, { type: 'press' });
    expect(game.solved).toBe(false);
    expect(game.view(0)).toMatchObject({ pressed: false, teamPressed: 1, teamSize: 2 });
  });

  it('gives each player a different color', () => {
    const game = startPuzzle(puzzle, { players: 4 });
    const colors = game.state.buttons.map((b) => b.color);
    expect(new Set(colors).size).toBe(4);
  });
});
