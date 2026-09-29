import { describe, expect, it } from 'vitest';
import { createRng } from './rng';

const take = (seed: string, n: number) => {
  const rng = createRng(seed);
  return Array.from({ length: n }, () => rng.next());
};

describe('createRng', () => {
  it('is deterministic for a seed', () => {
    expect(take('abc', 20)).toEqual(take('abc', 20));
  });

  it('differs between seeds, including near-identical ones', () => {
    expect(take('abc', 5)).not.toEqual(take('abd', 5));
    expect(take('seed-1', 5)).not.toEqual(take('seed-2', 5));
  });

  it('produces floats in [0, 1)', () => {
    for (const x of take('range', 5000)) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it('int covers the inclusive range roughly uniformly', () => {
    const rng = createRng('ints');
    const counts = new Map<number, number>();
    for (let i = 0; i < 6000; i++) {
      const n = rng.int(1, 6);
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    expect([...counts.keys()].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    for (const count of counts.values()) expect(count).toBeGreaterThan(850);
  });

  it('int rejects bad bounds', () => {
    const rng = createRng('bad');
    expect(() => rng.int(3, 1)).toThrow(RangeError);
    expect(() => rng.int(0.5, 2)).toThrow(RangeError);
  });

  it('shuffle returns a permutation without touching the input', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = createRng('shuffle').shuffle(input);
    expect(input).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...out].sort()).toEqual(input);
    expect(out).not.toEqual(input);
  });

  it('pick throws on empty arrays', () => {
    expect(() => createRng('x').pick([])).toThrow(RangeError);
  });

  it('fork is independent of how much the parent has been used', () => {
    const a = createRng('parent');
    const b = createRng('parent');
    b.next();
    b.next();
    expect(a.fork('child').next()).toBe(b.fork('child').next());
    expect(a.fork('one').next()).not.toBe(a.fork('two').next());
  });
});
