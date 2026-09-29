import { describe, expect, it } from 'vitest';
import { startPuzzle } from '../harness';
import puzzle from './server';

describe('press together (shared instance)', () => {
  it('puts every player in one instance and shows every team', () => {
    const game = startPuzzle(puzzle, { teams: [2, 2] });
    expect(game.players).toHaveLength(4);
    expect(game.view(0).teams).toEqual([
      { id: 'team-1', pressed: 0, size: 2, done: false },
      { id: 'team-2', pressed: 0, size: 2, done: false },
    ]);
    expect(game.view(3).myTeam).toBe('team-2');
  });

  it('ends the round when the first team finishes, scored per team', () => {
    const game = startPuzzle(puzzle, { teams: [2, 2] });
    game.act(0, { type: 'press' });
    game.act(2, { type: 'press' });
    game.advance(1500);
    game.act(3, { type: 'press' });
    expect(game.solved).toBe(true);
    expect(game.score()).toEqual({
      teams: { 'team-1': { solved: false }, 'team-2': { solved: true, elapsedMs: 1500 } },
    });
  });

  it('refuses a second press', () => {
    const game = startPuzzle(puzzle, { teams: [2, 1] });
    game.act(0, { type: 'press' });
    expect(game.act(0, { type: 'press' })).toMatchObject({ ok: false });
  });
});
