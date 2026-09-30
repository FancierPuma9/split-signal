import { createRng } from '@split-signal/shared';
import { describe, expect, it } from 'vitest';
import { createTestTeams, startPuzzle } from '../harness';
import { lookKey } from '../lib/composite';
import { CONTESTED, NEUTRAL, OWN_PER_TEAM, generateBoard } from './board';
import cardTalk, { GRAB_COOLDOWN_MS } from './server';
import type { State } from './types';

// Two teams of two: players 0-1 are team 1, 2-3 team 2. Round 0: seat 0 of each team calls.
const RED_CALLER = 0;
const RED_GRABBER = 1;
const BLUE_GRABBER = 3;

const start = (roundIndex = 0) =>
  startPuzzle(cardTalk, {
    teams: [2, 2],
    roundIndex,
    hidden: [
      {
        name: 'the key',
        hiddenFrom: (p) => p.seat !== roundIndex % 2,
        change: (s: State) => ({
          ...s,
          cards: s.cards.map((c, i) => ({ ...c, owner: s.cards[(i + 1) % s.cards.length]!.owner })),
        }),
      },
    ],
  });

const cardOf = (state: State, test: (owner: State['cards'][number]['owner']) => boolean) =>
  state.cards.find((c) => test(c.owner) && !state.claims.some((cl) => cl.card === c.id))!.id;

describe('card talk board', () => {
  it('has 8 cards per team, 5 contested and 4 traps, all different', () => {
    for (const size of [2, 3]) {
      const { teams } = createTestTeams(Array.from({ length: size }, () => 2));
      const cards = generateBoard(teams, createRng(`b${size}`));
      expect(cards).toHaveLength(OWN_PER_TEAM * size + CONTESTED + NEUTRAL);
      expect(new Set(cards.map((c) => lookKey(c.look))).size).toBe(cards.length);
      expect(cards.filter((c) => c.owner === 'contested')).toHaveLength(CONTESTED);
      for (const t of teams) {
        expect(
          cards.filter((c) => typeof c.owner === 'object' && c.owner.team === t.id),
        ).toHaveLength(OWN_PER_TEAM);
      }
    }
  });
});

describe('card talk', () => {
  it('gives each team one Caller who sees the key, and turns roles each round', () => {
    const game = start();
    expect(game.view(RED_CALLER).role).toBe('caller');
    expect(game.view(RED_GRABBER).role).toBe('grabber');
    expect(game.view(RED_CALLER).cards.every((c) => c.key !== undefined)).toBe(true);
    expect(game.view(RED_GRABBER).cards.every((c) => c.key === undefined)).toBe(true);
    expect(start(1).view(RED_GRABBER).role).toBe('caller');
  });

  it('scores own, contested, trap and stolen grabs', () => {
    const game = start();
    const red = 'team-1';
    const blue = 'team-2';
    game.act(RED_GRABBER, {
      type: 'grab',
      cardId: cardOf(game.state, (o) => typeof o === 'object' && o.team === red),
    });
    expect(game.state.scores).toEqual({ [red]: 5, [blue]: 0 });
    game.act(BLUE_GRABBER, { type: 'grab', cardId: cardOf(game.state, (o) => o === 'contested') });
    expect(game.state.scores[blue]).toBe(10);
    game.advance(GRAB_COOLDOWN_MS);
    game.act(RED_GRABBER, { type: 'grab', cardId: cardOf(game.state, (o) => o === 'neutral') });
    expect(game.state.scores[red]).toBe(2);
    game.advance(GRAB_COOLDOWN_MS);
    game.act(BLUE_GRABBER, {
      type: 'grab',
      cardId: cardOf(game.state, (o) => typeof o === 'object' && o.team === red),
    });
    expect(game.state.scores).toEqual({ [red]: 7, [blue]: 7 });
    expect(game.state.claims.at(-1)).toMatchObject({ result: 'stolen', creditedTo: red });
  });

  it('allows one grab a second per Grabber, none for Callers, and one claim per card', () => {
    const game = start();
    const [first, second] = game.state.cards;
    expect(game.act(RED_CALLER, { type: 'grab', cardId: first!.id }).ok).toBe(false);
    expect(game.act(RED_GRABBER, { type: 'grab', cardId: first!.id }).ok).toBe(true);
    expect(game.act(RED_GRABBER, { type: 'grab', cardId: second!.id }).ok).toBe(false);
    expect(game.act(BLUE_GRABBER, { type: 'grab', cardId: first!.id }).ok).toBe(false);
    game.advance(GRAB_COOLDOWN_MS);
    expect(game.act(RED_GRABBER, { type: 'grab', cardId: second!.id }).ok).toBe(true);
  });

  it('ends once every contested and team card is claimed, traps aside', () => {
    const game = start();
    const needed = game.state.cards.filter((c) => c.owner !== 'neutral');
    needed.forEach((card, i) => {
      game.advance(GRAB_COOLDOWN_MS);
      game.act(i % 2 ? BLUE_GRABBER : RED_GRABBER, { type: 'grab', cardId: card.id });
    });
    expect(game.solved).toBe(true);
    const teams = game.score().teams!;
    expect(Object.keys(teams)).toEqual(['team-1', 'team-2']);
    expect(teams['team-1']!.elapsedMs).toBeGreaterThan(0);
  });
});
