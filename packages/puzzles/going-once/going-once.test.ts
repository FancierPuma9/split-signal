import { describe, expect, it } from 'vitest';
import { startPuzzle, type HiddenInfo } from '../harness';
import { GOING_ONCE_MS, NO_BID_MS, OPEN_BY_MS, SOLD_MS, VALUE_RANGE } from './manifest';
import puzzle from './server';
import type { State } from './types';

// Round 0 with two teams: t1-p1 Seller (seat 0), t1-p2 Bidder (1), t2-p1 Appraiser (2),
// t2-p2 Bidder (3).
const hidden: HiddenInfo<State>[] = [
  {
    name: 'the true value',
    hiddenFrom: (p) => p.id !== 't2-p1',
    change: (state) => ({ ...state, value: state.value === 200 ? 250 : 200 }),
    until: (state) => state.phase === 'sold' || state.phase === 'unsold',
  },
];

function opened() {
  const game = startPuzzle(puzzle, { teams: [2, 2], hidden });
  game.act(0, { type: 'open' });
  return game;
}

describe('going once', () => {
  it('hands out Seller, Bidders and an Appraiser, and only the Appraiser knows the value', () => {
    const game = startPuzzle(puzzle, { teams: [2, 2], hidden });
    expect(game.view(0)).toMatchObject({ role: 'seller', value: null, sellerTeam: 'team-1' });
    expect(game.view(1)).toMatchObject({ role: 'bidder', value: null });
    expect(game.view(2)).toMatchObject({ role: 'appraiser', value: game.state.value });
    expect(game.view(3)).toMatchObject({ role: 'bidder', value: null });
    const { value } = game.state;
    expect(value % VALUE_RANGE.step).toBe(0);
    expect(value).toBeGreaterThanOrEqual(VALUE_RANGE.min);
    expect(value).toBeLessThanOrEqual(VALUE_RANGE.max);
    expect(game.state.art.title).toMatch(/\w/);
  });

  it('rotates the selling team, and swaps jobs when a team comes round again', () => {
    const second = startPuzzle(puzzle, { teams: [2, 2], roundIndex: 1 });
    expect(second.view(2)).toMatchObject({ role: 'seller', sellerTeam: 'team-2' });
    expect(second.view(0).role).toBe('appraiser');
    const third = startPuzzle(puzzle, { teams: [2, 2], roundIndex: 2 });
    expect(third.view(1).role).toBe('seller');
    expect(third.view(0).role).toBe('bidder');
  });

  it('opens when the Seller says so, or by itself', () => {
    const game = startPuzzle(puzzle, { teams: [2, 2], hidden });
    expect(game.act(1, { type: 'bid', raise: 50 })).toMatchObject({ ok: false });
    expect(game.act(1, { type: 'open' })).toMatchObject({ ok: false });
    game.advance(OPEN_BY_MS);
    expect(game.state.phase).toBe('open');
  });

  it('takes ascending bids, never against yourself', () => {
    const game = opened();
    game.act(1, { type: 'bid', raise: 100 });
    expect(game.act(1, { type: 'bid', raise: 50 })).toMatchObject({ ok: false });
    game.act(3, { type: 'bid', raise: 250 });
    expect(game.state.bids.map((b) => [b.by, b.amount])).toEqual([
      ['t1-p2', 100],
      ['t2-p2', 350],
    ]);
    expect(game.act(3, { type: 'bid', raise: 75 })).toMatchObject({ ok: false });
    expect(game.act(2, { type: 'bid', raise: 50 })).toMatchObject({ ok: false });
    expect(game.act(0, { type: 'bid', raise: 50 })).toMatchObject({ ok: false });
  });

  it('goes once after ten quiet seconds, and the Seller can bring the hammer down', () => {
    const game = opened();
    game.act(3, { type: 'bid', raise: 100 });
    expect(game.act(0, { type: 'hammer' })).toMatchObject({ ok: false });
    game.advance(GOING_ONCE_MS);
    expect(game.view(1).goingOnce).toBe(true);
    game.act(0, { type: 'hammer' });
    expect(game.solved).toBe(true);
    expect(game.view(1).result).toEqual({
      value: game.state.value,
      winner: 't2-p2',
      price: 100,
      gains: { 'team-1': 0, 'team-2': game.state.value - 100 },
    });
    expect(game.view(1).value).toBe(game.state.value);
  });

  it('sells itself after fifteen quiet seconds, and a new bid resets the clock', () => {
    const game = opened();
    game.act(1, { type: 'bid', raise: 50 });
    game.advance(GOING_ONCE_MS + 1000);
    game.act(3, { type: 'bid', raise: 50 });
    expect(game.view(0).goingOnce).toBe(false);
    game.advance(SOLD_MS - 100);
    expect(game.solved).toBe(false);
    game.advance(100);
    expect(game.state.phase).toBe('sold');
    expect(game.score().teams?.['team-2']?.points).toBe(game.state.value - 100);
  });

  it('is no sale if nobody bids', () => {
    const game = opened();
    game.advance(NO_BID_MS);
    expect(game.state.phase).toBe('unsold');
    expect(game.score()).toEqual({
      teams: { 'team-1': { solved: true, points: 0 }, 'team-2': { solved: true, points: 0 } },
    });
  });

  it('sells at once when everyone else passes', () => {
    const game = opened();
    game.act(1, { type: 'bid', raise: 250 });
    game.act(3, { type: 'pass' });
    expect(game.state.phase).toBe('sold');
    expect(game.view(0).result?.winner).toBe('t1-p2');
  });

  it('charges an overpaying team the difference', () => {
    const game = opened();
    let bidder = 1;
    while ((game.state.bids.at(-1)?.amount ?? 0) <= game.state.value) {
      game.act(bidder, { type: 'bid', raise: 250 });
      bidder = bidder === 1 ? 3 : 1;
    }
    const high = game.state.bids.at(-1)!;
    game.act(bidder, { type: 'pass' });
    const team = high.by.startsWith('t1') ? 'team-1' : 'team-2';
    expect(game.score().teams?.[team]?.points).toBe(game.state.value - high.amount);
    expect(game.score().teams?.[team]?.points).toBeLessThan(0);
  });

  it('works with three teams: two informed, one guessing', () => {
    const game = startPuzzle(puzzle, { teams: [2, 2, 2] });
    expect(game.view(2).role).toBe('appraiser');
    expect(game.view(4).role).toBe('appraiser');
    expect(game.view(4).value).toBe(game.state.value);
    expect(game.view(0).role).toBe('seller');
  });

  it('counts an auction still open at the buzzer as sold at the current bid', () => {
    const game = opened();
    game.act(1, { type: 'bid', raise: 100 });
    expect(game.score().teams?.['team-1']).toEqual({
      solved: false,
      points: game.state.value - 100,
    });
    expect(game.reveal(3)?.value).toBe(game.state.value);
  });
});
