import type { Rng } from '@split-signal/shared';

// Procedural pictures made of four attributes: a shape, its color, a fill pattern and a small
// motif in the middle. Pictures that share two or three attributes are hard to tell apart in a
// few words, which is what Overdraft, Card Talk and Scavenge want. Rendered by CompositeSvg.

export const SHAPES = ['circle', 'square', 'triangle', 'hexagon', 'diamond'] as const;
export const COLORS = ['red', 'blue', 'yellow', 'green', 'purple'] as const;
export const PATTERNS = ['solid', 'striped', 'dotted', 'hollow'] as const;
export const MOTIFS = ['none', 'star', 'dot', 'cross', 'ring'] as const;

export interface Look {
  shape: (typeof SHAPES)[number];
  color: (typeof COLORS)[number];
  pattern: (typeof PATTERNS)[number];
  motif: (typeof MOTIFS)[number];
}

export const lookKey = (l: Look) => `${l.shape}/${l.color}/${l.pattern}/${l.motif}`;

/** How many of the four attributes two looks share. */
export function shared(a: Look, b: Look): number {
  return (
    Number(a.shape === b.shape) +
    Number(a.color === b.color) +
    Number(a.pattern === b.pattern) +
    Number(a.motif === b.motif)
  );
}

/** Every combination of the given attribute values. */
function combos(
  shapes: readonly Look['shape'][],
  colors: readonly Look['color'][],
  patterns: readonly Look['pattern'][],
  motifs: readonly Look['motif'][],
): Look[] {
  const out: Look[] = [];
  for (const shape of shapes)
    for (const color of colors)
      for (const pattern of patterns)
        for (const motif of motifs) out.push({ shape, color, pattern, motif });
  return out;
}

/**
 * A tight cluster: `count` distinct looks that all share one attribute and vary the other three
 * over two or three values each, so telling one apart takes two or three attributes.
 */
export function cluster(count: number, rng: Rng): Look[] {
  const shape = rng.pick(SHAPES);
  for (;;) {
    const colors = rng.shuffle(COLORS).slice(0, rng.int(2, 3));
    const patterns = rng.shuffle(PATTERNS).slice(0, rng.int(2, 3));
    const motifs = rng.shuffle(MOTIFS).slice(0, rng.int(2, 3));
    const all = combos([shape], colors, patterns, motifs);
    if (all.length >= count) return rng.shuffle(all).slice(0, count);
  }
}

/**
 * `count` distinct looks drawn from three values of each attribute, so most share two
 * attributes with several others: "the striped one" is never enough.
 */
export function similarLooks(count: number, rng: Rng): Look[] {
  const all = combos(
    rng.shuffle(SHAPES).slice(0, 3),
    rng.shuffle(COLORS).slice(0, 3),
    rng.shuffle(PATTERNS).slice(0, 3),
    rng.shuffle(MOTIFS).slice(0, 3),
  );
  if (count > all.length) throw new Error(`At most ${all.length} similar looks`);
  return rng.shuffle(all).slice(0, count);
}
