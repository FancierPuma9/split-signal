import { createRng } from '@split-signal/shared';
import { describe, expect, it } from 'vitest';
import { createTestPlayers, startPuzzle } from '../harness';
import { cluster, lookKey, shared, similarLooks } from '../lib/composite';
import { BOARD_SIZE, QUOTA, deal, tally } from './deal';
import overdraft from './server';

describe('composite pictures', () => {
  it('makes tight clusters that share a shape', () => {
    const looks = cluster(8, createRng('c'));
    expect(new Set(looks.map(lookKey)).size).toBe(8);
    expect(new Set(looks.map((l) => l.shape)).size).toBe(1);
  });

  it('makes boards where cards share attributes with several others', () => {
    const looks = similarLooks(25, createRng('s'));
    expect(new Set(looks.map(lookKey)).size).toBe(25);
    for (const look of looks) {
      const close = looks.filter((other) => other !== look && shared(look, other) >= 2);
      expect(close.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('overdraft scoring', () => {
  const state = (picks: Record<string, string[]>) => ({
    correct: ['a', 'b', 'c', 'd', 'e', 'f'],
    quota: 6,
    picks,
  });

  it('matches the worked examples', () => {
    // Four right and one wrong: two missed, nothing past the quota.
    expect(tally(state({ p1: ['a', 'b', 'x'], p2: ['c', 'd'], p3: [] }))).toMatchObject({
      correct: 4,
      missed: 2,
      surplus: 0,
      points: 2,
    });
    // All six plus two extra.
    expect(
      tally(state({ p1: ['a', 'b', 'c', 'x'], p2: ['d', 'e', 'f', 'y'], p3: [] })).points,
    ).toBe(4);
    // Caution isn't safe: picking nothing costs every answer.
    expect(tally(state({ p1: [], p2: [], p3: [] })).points).toBe(-6);
  });
});

describe('overdraft deal', () => {
  it('hides 5-7 answers unevenly, each known to one of the owner’s teammates', () => {
    const players = createTestPlayers(3);
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      const s = deal(players, createRng(seed));
      expect(s.quota).toBeGreaterThanOrEqual(QUOTA.min);
      expect(s.quota).toBeLessThanOrEqual(QUOTA.max);
      expect(new Set(s.correct).size).toBe(s.quota);
      for (const [owner, board] of Object.entries(s.boards)) {
        expect(board).toHaveLength(BOARD_SIZE);
        const mine = board.filter((i) => s.correct.includes(i.id));
        expect(mine.length).toBeLessThanOrEqual(4);
        for (const item of mine) {
          expect(s.holders[item.id]).toBeDefined();
          expect(s.holders[item.id]).not.toBe(owner);
        }
      }
      expect(deal(players, createRng(seed))).toEqual(s);
    }
  });
});

describe('overdraft', () => {
  it('shows each player their board and the answers they hold for others, never their own', () => {
    const game = startPuzzle(overdraft, { players: 3 });
    for (let seat = 0; seat < 3; seat++) {
      const view = game.view(seat);
      const id = game.player(seat).id;
      expect(view.board).toEqual(game.state.boards[id]);
      expect(JSON.stringify(view)).not.toContain('"correct"');
      const held = game.state.correct.filter((c) => game.state.holders[c] === id);
      expect(view.holding).toHaveLength(held.length);
      for (const h of view.holding) expect(h.owner).not.toBe(id);
    }
  });

  it('locks a player’s picks on submit and ends when all three have', () => {
    const game = startPuzzle(overdraft, { players: 3 });
    const mine = game.view(0).board[0]!.id;
    const theirs = game.view(1).board[0]!.id;
    expect(game.act(0, { type: 'toggle', itemId: theirs }).ok).toBe(false);
    game.act(0, { type: 'toggle', itemId: mine });
    game.advance(1000);
    game.act(0, { type: 'submit' });
    expect(game.act(0, { type: 'toggle', itemId: mine }).ok).toBe(false);
    game.advance(1000);
    game.act(1, { type: 'submit' });
    expect(game.solved).toBe(false);
    expect(game.view(2).teammatesDone).toEqual(['player-1', 'player-2']);
    game.advance(1000);
    game.act(2, { type: 'submit' });
    expect(game.solved).toBe(true);
    expect(game.score().elapsedMs).toBe(3000);
    const reveal = game.reveal(0);
    expect(reveal?.result?.quota).toBe(game.state.quota);
  });

  it('scores the picks as they stand when time runs out', () => {
    const game = startPuzzle(overdraft, { players: 3 });
    const answer = game.state.correct[0]!;
    const owner = game.players.findIndex((p) =>
      game.state.boards[p.id]!.some((i) => i.id === answer),
    );
    game.act(owner, { type: 'toggle', itemId: answer });
    expect(game.score()).toEqual({ points: 1 - (game.state.quota - 1) });
  });

  it('uses a team pool of 12 two-second sends', () => {
    expect(overdraft.manifest.comms).toEqual({
      type: 'budget-clips',
      maxSeconds: 2,
      budgetSends: 12,
      budgetScope: 'team',
    });
  });
});
