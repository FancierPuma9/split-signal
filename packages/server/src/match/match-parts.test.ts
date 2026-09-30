import {
  ROOM_CODE_ALPHABET,
  createRng,
  type AnyPuzzleServerModule,
  type PuzzleManifest,
} from '@split-signal/shared';
import { describe, expect, it } from 'vitest';
import { generateRoomCode } from '../rooms/room-codes';
import { eligiblePuzzles, excludedPuzzles, pickPuzzles } from './catalog';
import { PausableClock } from './clock';
import { resolveRound } from './resolution';
import { onePointPerRound, rankByScore } from './scoring';

function fakePuzzle(id: string, teams: [number, number], players: [number, number]) {
  const manifest: PuzzleManifest = {
    id,
    name: id,
    description: id,
    teams: { min: teams[0], max: teams[1] },
    playersPerTeam: { min: players[0], max: players[1] },
    winCondition: 'race',
    timeLimitSeconds: 60,
    comms: { type: 'none' },
  };
  return { manifest } as AnyPuzzleServerModule;
}

describe('catalog', () => {
  it('explains why puzzles are left out', () => {
    const make = (name: string, teams: [number, number], sizes: [number, number]) =>
      ({
        manifest: {
          name,
          teams: { min: teams[0], max: teams[1] },
          playersPerTeam: { min: sizes[0], max: sizes[1] },
        },
      }) as unknown as AnyPuzzleServerModule;
    const catalog = [
      make('Scavenge', [3, 4], [2, 2]),
      make('Trio', [1, 3], [3, 3]),
      make('Duo', [1, 3], [2, 4]),
    ];
    expect(excludedPuzzles(catalog, [2, 2])).toEqual([
      { name: 'Scavenge', reason: 'needs 3+ teams' },
      { name: 'Trio', reason: 'needs 3 players per team' },
    ]);
    expect(excludedPuzzles(catalog, [])).toEqual([]);
  });

  const duo = fakePuzzle('duo', [1, 3], [2, 2]);
  const flexible = fakePuzzle('flexible', [2, 3], [2, 4]);
  const solo = fakePuzzle('solo', [1, 1], [1, 4]);
  const catalog = [duo, flexible, solo];

  it('filters by team count and every team size', () => {
    expect(eligiblePuzzles(catalog, [2, 2]).map((p) => p.manifest.id)).toEqual(['duo', 'flexible']);
    expect(eligiblePuzzles(catalog, [2, 3]).map((p) => p.manifest.id)).toEqual(['flexible']);
    expect(eligiblePuzzles(catalog, [3]).map((p) => p.manifest.id)).toEqual(['solo']);
    expect(eligiblePuzzles(catalog, [2, 0])).toEqual([]);
    expect(eligiblePuzzles(catalog, [])).toEqual([]);
  });

  it('picks each puzzle once before repeating, deterministically', () => {
    const picks = pickPuzzles(catalog, 3, createRng('seed'));
    expect(new Set(picks).size).toBe(3);
    expect(pickPuzzles(catalog, 3, createRng('seed'))).toEqual(picks);
  });

  it('repeats without back-to-back duplicates when the catalog is small', () => {
    for (let i = 0; i < 20; i++) {
      const picks = pickPuzzles([duo, flexible], 7, createRng(`s${i}`));
      expect(picks).toHaveLength(7);
      for (let j = 1; j < picks.length; j++) expect(picks[j]).not.toBe(picks[j - 1]);
    }
    expect(pickPuzzles([solo], 3, createRng('x'))).toEqual([solo, solo, solo]);
  });
});

describe('PausableClock', () => {
  it('freezes while paused', () => {
    let t = 1000;
    const clock = new PausableClock(() => t);
    t = 1500;
    expect(clock.now()).toBe(500);
    clock.pause();
    t = 5000;
    expect(clock.now()).toBe(500);
    clock.resume();
    t = 5100;
    expect(clock.now()).toBe(600);
  });
});

describe('resolveRound', () => {
  it('breaks equal points with the tiebreak before time', () => {
    expect(
      resolveRound('race', [
        { teamId: 'a', solved: false, points: 6, tiebreak: 2, elapsedMs: 100 },
        { teamId: 'b', solved: false, points: 6, tiebreak: 5 },
        { teamId: 'c', solved: false, points: 5, tiebreak: 9 },
      ]),
    ).toEqual({ outcome: 'won', winnerTeamId: 'b' });
  });

  it('race: fastest solver wins', () => {
    expect(
      resolveRound('race', [
        { teamId: 'a', solved: true, elapsedMs: 900 },
        { teamId: 'b', solved: true, elapsedMs: 800 },
        { teamId: 'c', solved: false },
      ]),
    ).toEqual({ outcome: 'won', winnerTeamId: 'b' });
  });

  it('compare: fewest moves, then time', () => {
    expect(
      resolveRound('compare', [
        { teamId: 'a', solved: true, moves: 10, elapsedMs: 100 },
        { teamId: 'b', solved: true, moves: 8, elapsedMs: 900 },
      ]),
    ).toEqual({ outcome: 'won', winnerTeamId: 'b' });
    expect(
      resolveRound('compare', [
        { teamId: 'a', solved: true, moves: 8, elapsedMs: 100 },
        { teamId: 'b', solved: true, moves: 8, elapsedMs: 900 },
      ]),
    ).toEqual({ outcome: 'won', winnerTeamId: 'a' });
  });

  it('race: falls back to points when nobody finishes', () => {
    expect(
      resolveRound('race', [
        { teamId: 'a', solved: false, points: 1.4 },
        { teamId: 'b', solved: false, points: 2.1 },
      ]),
    ).toEqual({ outcome: 'won', winnerTeamId: 'b' });
    // Finishing beats any amount of progress.
    expect(
      resolveRound('race', [
        { teamId: 'a', solved: true, elapsedMs: 170_000, points: 3 },
        { teamId: 'b', solved: false, points: 2.9 },
      ]),
    ).toEqual({ outcome: 'won', winnerTeamId: 'a' });
    expect(
      resolveRound('race', [
        { teamId: 'a', solved: false, points: 0 },
        { teamId: 'b', solved: false, points: 0 },
      ]).outcome,
    ).toBe('unsolved');
  });

  it('ties and unsolved rounds have no winner', () => {
    expect(
      resolveRound('race', [
        { teamId: 'a', solved: true, elapsedMs: 500 },
        { teamId: 'b', solved: true, elapsedMs: 500 },
      ]).outcome,
    ).toBe('tie');
    expect(resolveRound('compare', [{ teamId: 'a', solved: false }]).outcome).toBe('unsolved');
  });
});

describe('scoring', () => {
  it('awards one point to the round winner', () => {
    const round = {
      round: 0,
      puzzleId: 'p',
      puzzleName: 'P',
      winCondition: 'race' as const,
      outcome: 'won' as const,
      winnerTeamId: 'a',
      results: [
        { teamId: 'a', solved: true },
        { teamId: 'b', solved: false },
      ],
    };
    expect(onePointPerRound.onRoundResult(round)).toEqual({ a: 1, b: 0 });
    expect(
      onePointPerRound.onRoundResult({ ...round, outcome: 'tie', winnerTeamId: null }),
    ).toEqual({
      a: 0,
      b: 0,
    });
  });

  it('ranks with shared places', () => {
    expect(rankByScore({ a: 2, b: 3, c: 2, d: 0 })).toEqual([
      { teamId: 'b', score: 3, rank: 1 },
      { teamId: 'a', score: 2, rank: 2 },
      { teamId: 'c', score: 2, rank: 2 },
      { teamId: 'd', score: 0, rank: 4 },
    ]);
  });
});

describe('generateRoomCode', () => {
  it('uses the alphabet and skips taken codes', () => {
    let i = 0;
    const sequence = [0, 0, 0, 0, 1, 1, 1, 1];
    const code = generateRoomCode(
      (c) => c === 'BBBB',
      () => sequence[i++ % sequence.length]!,
    );
    expect(code).toBe('CCCC');
    expect([...generateRoomCode(() => false)].every((ch) => ROOM_CODE_ALPHABET.includes(ch))).toBe(
      true,
    );
  });
});
