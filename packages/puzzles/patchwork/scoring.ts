import type { DiffToken } from './types';

/** Lowercase words with punctuation stripped and whitespace collapsed. */
export function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Word-level edit distance with the edits that achieve it, so "math" for "mathematics" is one
 * wrong word rather than seven wrong letters.
 */
export function wordDiff(truth: string, guess: string): { distance: number; diff: DiffToken[] } {
  const a = words(truth);
  const b = words(guess);
  // cost[i][j]: edits to turn the first i truth words into the first j guess words.
  const cost = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const same = a[i - 1] === b[j - 1] ? 0 : 1;
      cost[i]![j] = Math.min(
        cost[i - 1]![j - 1]! + same,
        cost[i - 1]![j]! + 1,
        cost[i]![j - 1]! + 1,
      );
    }
  }
  const diff: DiffToken[] = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 || j > 0) {
    const here = cost[i]![j]!;
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1] && here === cost[i - 1]![j - 1]) {
      diff.push({ kind: 'same', word: a[i - 1]! });
      i -= 1;
      j -= 1;
    } else if (i > 0 && j > 0 && here === cost[i - 1]![j - 1]! + 1) {
      diff.push({ kind: 'wrong', truth: a[i - 1]!, guess: b[j - 1]! });
      i -= 1;
      j -= 1;
    } else if (i > 0 && here === cost[i - 1]![j]! + 1) {
      diff.push({ kind: 'missing', truth: a[i - 1]! });
      i -= 1;
    } else {
      diff.push({ kind: 'extra', guess: b[j - 1]! });
      j -= 1;
    }
  }
  return { distance: cost[a.length]![b.length]!, diff: diff.reverse() };
}

/**
 * How close a guess is, as a percentage: 1 - distance / the longer of the two, in words. An empty
 * guess scores 0.
 */
export function similarity(truth: string, guess: string): number {
  const longest = Math.max(words(truth).length, words(guess).length);
  if (longest === 0) return 0;
  const { distance } = wordDiff(truth, guess);
  return Math.max(0, Math.round(100 * (1 - distance / longest)));
}
