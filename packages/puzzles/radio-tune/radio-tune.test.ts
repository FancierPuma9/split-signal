import { describe, expect, it } from 'vitest';
import { startPuzzle, type HiddenInfo, type PuzzleDriver } from '../harness';
import puzzle, { HOLD_MS, distortionFor } from './server';
import { KNOB_MAX, type Action, type State, type View } from './types';

type Game = PuzzleDriver<State, View, Action>;

const hidden: HiddenInfo<State>[] = [
  {
    name: 'the target settings',
    hiddenFrom: (p, s) => p.id === s.receiver,
    change: (s) => ({ ...s, target: { ...s.target, band: (s.target.band + 1) % (KNOB_MAX + 1) } }),
  },
];

/** Which seat got which job (they're dealt at random). */
function jobs(game: Game) {
  const seatOf = (id: string) => game.players.findIndex((p) => p.id === id);
  return { sender: seatOf(game.state.sender), receiver: seatOf(game.state.receiver) };
}

function tune(game: Game) {
  const { target } = game.state;
  const { receiver } = jobs(game);
  game.act(receiver, { type: 'knob', control: 'band', value: target.band });
  game.act(receiver, { type: 'knob', control: 'tuning', value: target.tuning });
  game.act(receiver, { type: 'switch', control: 'filter', on: target.filter });
  game.act(receiver, { type: 'switch', control: 'squelch', on: target.squelch });
}

const clipTo = (game: Game, from: number) => game.clip(from)!;

describe('radio tune', () => {
  it('shows the sender the target and the receiver only their panel', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    const { sender, receiver } = jobs(game);
    expect(game.view(sender)).toEqual({ role: 'sender', target: game.state.target, solved: false });
    expect(game.view(receiver)).toEqual({
      role: 'receiver',
      panel: game.state.panel,
      solved: false,
    });
  });

  it('deals the jobs at random', () => {
    const senders = new Set<number>();
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const game = startPuzzle(puzzle, { players: 2, seed });
      senders.add(jobs(game).sender);
      expect(jobs(game).receiver).toBe(1 - jobs(game).sender);
    }
    expect(senders).toEqual(new Set([0, 1]));
  });

  it('starts well away from the target', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      const { state } = startPuzzle(puzzle, { players: 2, seed });
      expect(Math.abs(state.panel.band - state.target.band)).toBeGreaterThanOrEqual(3);
      expect(Math.abs(state.panel.tuning - state.target.tuning)).toBeGreaterThanOrEqual(3);
      expect(
        state.panel.filter !== state.target.filter || state.panel.squelch !== state.target.squelch,
      ).toBe(true);
    }
  });

  it('distorts less as each control gets closer, and not at all when right', () => {
    const target = { band: 5, tuning: 4, filter: true, squelch: false };
    expect(distortionFor(target, target)).toEqual({ noise: 0, chop: 0, pitch: 0, narrow: 0 });
    const far = distortionFor(
      { ...target, band: 0, tuning: 9, filter: false, squelch: true },
      target,
    );
    const near = distortionFor({ ...target, band: 4, tuning: 5 }, target);
    expect(far.narrow).toBeGreaterThan(near.narrow);
    expect(far.pitch).toBeGreaterThan(near.pitch);
    expect(far.noise).toBeGreaterThan(0);
    expect(far.chop).toBeGreaterThan(0);
    expect(distortionFor({ ...target, tuning: 2 }, target).pitch).toBeLessThan(0); // too low
  });

  it('routes clips only from the sender to the receiver, with current distortion', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    const { sender, receiver } = jobs(game);
    expect(clipTo(game, receiver)).toMatchObject({ reject: expect.any(String) });
    const before = clipTo(game, sender);
    if (!('deliveries' in before)) throw new Error('expected deliveries');
    expect(before.deliveries).toHaveLength(1);
    expect(before.deliveries[0]!.to).toBe(game.player(receiver).id);
    tune(game);
    const after = clipTo(game, sender);
    if (!('deliveries' in after)) throw new Error('expected deliveries');
    expect(after.deliveries[0]!.params).toEqual({ noise: 0, chop: 0, pitch: 0, narrow: 0 });
  });

  it('is solved once the panel matches and holds', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    tune(game);
    game.advance(HOLD_MS - 100);
    expect(game.solved).toBe(false);
    game.advance(100);
    expect(game.solved).toBe(true);
  });

  it('only lets the receiver touch the panel, within range', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    const { sender, receiver } = jobs(game);
    expect(game.act(sender, { type: 'knob', control: 'band', value: 1 })).toMatchObject({
      ok: false,
    });
    expect(game.act(receiver, { type: 'knob', control: 'band', value: 10 })).toMatchObject({
      ok: false,
    });
    expect(
      game.act(receiver, { type: 'switch', control: 'filter', on: 'yes' as unknown as boolean }),
    ).toMatchObject({
      ok: false,
    });
  });
});
