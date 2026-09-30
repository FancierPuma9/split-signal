import { createRng } from '@split-signal/shared';
import { describe, expect, it } from 'vitest';
import { runPuzzleScript, startPuzzle } from '../harness';
import { FILL, REGION_CELLS, SIZE, generateRegion, generateTarget, splitBoard } from './board';
import telegraph, { PENALTY_MS } from './server';

describe('telegraph board', () => {
  it('makes an irregular board of 20-45 cells with a 30-40% pattern', () => {
    for (const seed of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']) {
      const region = generateRegion(createRng(seed));
      expect(region.length).toBeGreaterThanOrEqual(REGION_CELLS.min);
      expect(region.length).toBeLessThanOrEqual(REGION_CELLS.max);
      expect(new Set(region).size).toBe(region.length);
      for (const cell of region) expect(cell).toBeLessThan(SIZE * SIZE);
      const target = generateTarget(region, createRng(`${seed}-t`));
      expect(target.length / region.length).toBeGreaterThanOrEqual(FILL.min - 0.03);
      expect(target.length / region.length).toBeLessThanOrEqual(FILL.max + 0.03);
      for (const cell of target) expect(region).toContain(cell);
      expect(generateRegion(createRng(seed))).toEqual(region);
    }
  });

  it('has stray islands apart from the main blob', () => {
    // Find the connected pieces; there's one big one plus at least one small one.
    const region = generateRegion(createRng('islands'));
    const cells = new Set(region);
    const seen = new Set<number>();
    const sizes: number[] = [];
    for (const start of region) {
      if (seen.has(start)) continue;
      let size = 0;
      const queue = [start];
      seen.add(start);
      while (queue.length > 0) {
        const cell = queue.pop()!;
        size += 1;
        for (const n of [
          cell - SIZE,
          cell + SIZE,
          cell % SIZE ? cell - 1 : -1,
          (cell + 1) % SIZE ? cell + 1 : -1,
        ]) {
          if (cells.has(n) && !seen.has(n)) {
            seen.add(n);
            queue.push(n);
          }
        }
      }
      sizes.push(size);
    }
    sizes.sort((a, b) => b - a);
    expect(sizes.length).toBeGreaterThanOrEqual(2);
    expect(sizes.slice(1).every((s) => s <= 2)).toBe(true);
  });

  it('splits the board into two non-empty halves', () => {
    const region = generateRegion(createRng('split'));
    const [left, right] = splitBoard(region);
    expect(left.length).toBeGreaterThan(0);
    expect(right.length).toBeGreaterThan(0);
    expect([...left, ...right].sort((a, b) => a - b)).toEqual(region);
  });
});

describe('telegraph', () => {
  const start = (players = 2) =>
    startPuzzle(telegraph, {
      players,
      hidden: [
        {
          name: 'the pattern',
          hiddenFrom: (p) => p.seat !== 0, // round 0: seat 0 sends
          change: (s) => ({ ...s, target: s.region.filter((c) => !s.target.includes(c)) }),
          until: (s) => s.solvedAt !== null,
        },
      ],
    });

  it('lets only the Sender beep, and only Receivers fill', () => {
    const game = start();
    expect(game.signal(0, 'down').ok).toBe(true);
    expect(game.signal(1, 'down').ok).toBe(false);
    expect(game.act(0, { type: 'toggle', cell: game.state.region[0]! }).ok).toBe(false);
    expect(game.act(1, { type: 'toggle', cell: game.state.region[0]! }).ok).toBe(true);
    expect(game.act(1, { type: 'toggle', cell: -5 }).ok).toBe(false);
  });

  it('shows the Sender a wrong submit, and locks the Receiver for 8s', () => {
    const game = start();
    const wrongCell = game.state.region.find((c) => !game.state.target.includes(c))!;
    game.act(1, { type: 'toggle', cell: wrongCell });
    game.act(1, { type: 'submit' });
    const sender = game.view(0);
    expect(sender.role === 'sender' && sender.lastSubmit?.wrong).toContain(wrongCell);
    expect(sender.role === 'sender' && sender.lastSubmit?.wrong.length).toBe(
      game.state.target.length + 1,
    );
    expect(game.act(1, { type: 'toggle', cell: wrongCell }).ok).toBe(false);
    game.advance(PENALTY_MS);
    expect(game.act(1, { type: 'toggle', cell: wrongCell }).ok).toBe(true);
  });

  it('solves on an exact match, with wrong submits added to the time', () => {
    runPuzzleScript(telegraph, {
      players: 2,
      steps: (state) => [
        { seat: 1, action: { type: 'submit' } },
        { advance: PENALTY_MS },
        ...state.target.map((cell) => ({ seat: 1, action: { type: 'toggle' as const, cell } })),
        { advance: 2000 },
        { seat: 1, action: { type: 'submit' } },
      ],
      expectScore: { elapsedMs: PENALTY_MS + 2000 + PENALTY_MS },
    });
  });

  it('splits the board between two Receivers with three players', () => {
    const game = start(3);
    const a = game.view(1);
    const b = game.view(2);
    if (a.role !== 'receiver' || b.role !== 'receiver') throw new Error('expected receivers');
    expect(a.mine.length + b.mine.length).toBe(game.state.region.length);
    expect(game.act(1, { type: 'toggle', cell: b.mine[0]! }).ok).toBe(false);
    expect(game.act(2, { type: 'toggle', cell: b.mine[0]! }).ok).toBe(true);
    const sender = game.view(0);
    expect(sender.role === 'sender' && sender.halves).toHaveLength(2);
  });

  it('rotates the Sender with the round', () => {
    const game = startPuzzle(telegraph, { players: 2, roundIndex: 1 });
    expect(game.view(1).role).toBe('sender');
  });
});
