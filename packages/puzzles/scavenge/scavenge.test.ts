import { createRng } from '@split-signal/shared';
import { describe, expect, it } from 'vitest';
import { startPuzzle } from '../harness';
import { lookKey } from '../lib/composite';
import {
  CLUSTERS,
  NEEDED,
  SHARED_PER_PAIR,
  VARIANTS,
  generateBin,
  generateSchematics,
} from './bin';
import scavenge, { GRABS, TICK_MS } from './server';
import type { State } from './types';

// Three teams of two. Round 0: seat 0 of each team reads, seat 1 grabs.
const GRABBER = [1, 3, 5];

describe('scavenge bin', () => {
  it('holds one of each of 8 families x 5 variants', () => {
    const parts = generateBin(createRng('bin'));
    expect(parts).toHaveLength(CLUSTERS * VARIANTS);
    expect(new Set(parts.map((p) => lookKey(p.look))).size).toBe(parts.length);
    const families = new Set(parts.map((p) => `${p.look.shape}/${p.look.color}`));
    expect(families.size).toBe(CLUSTERS);
  });

  it('always gives every pair of teams exactly two shared parts, and nobody else those', () => {
    const parts = generateBin(createRng('bin'));
    for (const count of [3, 4]) {
      const teams = Array.from({ length: count }, (_, i) => `t${i}`);
      for (let seed = 0; seed < 50; seed++) {
        const required = generateSchematics(teams, parts, createRng(`s${seed}`));
        for (const t of teams) {
          expect(new Set(required[t]).size).toBe(NEEDED);
        }
        for (let i = 0; i < count; i++) {
          for (let j = i + 1; j < count; j++) {
            const shared = required[teams[i]!]!.filter((id) => required[teams[j]!]!.includes(id));
            expect(shared).toHaveLength(SHARED_PER_PAIR);
          }
        }
        const counts = new Map<string, number>();
        for (const ids of Object.values(required))
          for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
        expect(Math.max(...counts.values())).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe('scavenge', () => {
  const start = () =>
    startPuzzle(scavenge, {
      teams: [2, 2, 2],
      hidden: [
        {
          name: 'the schematics',
          hiddenFrom: (p) => p.seat === 1,
          change: (s: State) => ({
            ...s,
            required: Object.fromEntries(
              Object.entries(s.required).map(([t, ids]) => [
                t,
                [...ids].reverse().map((id) => (id === 'p0' ? 'p1' : id === 'p1' ? 'p0' : id)),
              ]),
            ),
          }),
        },
        {
          name: "the other teams' picks",
          hiddenFrom: (p) => !p.id.startsWith('t3-'),
          change: (s: State) => ({
            ...s,
            hover: { ...s.hover, 'team-3': { part: 'p7', committed: true } },
          }),
          until: () => false,
        },
      ],
    });

  it('resolves grabs together: uncontested land, contested stay, passing costs nothing', () => {
    const game = start();
    game.act(GRABBER[0]!, { type: 'hover', partId: 'p0' });
    game.act(GRABBER[1]!, { type: 'hover', partId: 'p5' });
    game.act(GRABBER[2]!, { type: 'hover', partId: 'p5' });
    game.advance(TICK_MS);
    expect(game.state.trays['team-1']).toEqual(['p0']);
    expect(game.state.trays['team-2']).toEqual([]);
    expect(game.state.bin).toContain('p5');
    expect(game.state.grabsLeft).toEqual({
      'team-1': GRABS - 1,
      'team-2': GRABS - 1,
      'team-3': GRABS - 1,
    });
    expect(game.state.last?.results['team-2']?.outcome).toBe('contested');
    // Next tick nobody picks: nothing spent.
    game.advance(TICK_MS);
    expect(game.state.grabsLeft['team-1']).toBe(GRABS - 1);
    expect(game.state.last?.results['team-1']?.outcome).toBe('pass');
  });

  it('locks a committed pick and keeps readers off the bin', () => {
    const game = start();
    expect(game.act(0, { type: 'hover', partId: 'p0' }).ok).toBe(false);
    game.act(GRABBER[0]!, { type: 'hover', partId: 'p0' });
    game.act(GRABBER[0]!, { type: 'commit' });
    expect(game.act(GRABBER[0]!, { type: 'hover', partId: 'p1' }).ok).toBe(false);
    game.advance(TICK_MS);
    expect(game.act(GRABBER[0]!, { type: 'hover', partId: 'p1' }).ok).toBe(true);
    expect(game.act(GRABBER[0]!, { type: 'hover', partId: 'p0' }).ok).toBe(false); // taken
  });

  it('ends when a team has all eight, scoring parts with grabs left as the tiebreak', () => {
    const game = start();
    const needed = game.state.required['team-1']!;
    for (const part of needed) {
      game.act(GRABBER[0]!, { type: 'hover', partId: part });
      game.advance(TICK_MS);
    }
    expect(game.solved).toBe(true);
    const teams = game.score().teams!;
    expect(teams['team-1']).toEqual({
      solved: true,
      points: 8,
      tiebreak: GRABS - 8,
      elapsedMs: TICK_MS * 8,
    });
    expect(teams['team-2']).toMatchObject({ solved: false, points: 0, tiebreak: GRABS });
  });

  it('needs three or more teams', () => {
    expect(scavenge.manifest.teams.min).toBe(3);
  });
});
