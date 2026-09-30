import type { Rng } from '@split-signal/shared';
/** A procedurally drawn glyph: one SVG path plus a few dots, in a 30x30 box. */
export interface Glyph {
  id: string;
  d: string;
  dots: Array<[number, number]>;
}

// Glyphs are strokes between points on a 3x3 grid inside a 30x30 box: straight lines, curves,
// and dots. Random combinations come out abstract and hard to name, which is the point: "the one
// that looks like a P" shouldn't work.

const POINTS: Array<[number, number]> = [];
for (const y of [5, 15, 25]) for (const x of [5, 15, 25]) POINTS.push([x, y]);

type Stroke =
  | { kind: 'line'; a: number; b: number }
  | { kind: 'curve'; a: number; b: number; bend: number }
  | { kind: 'dot'; a: number };

const at = (i: number) => POINTS[i] as [number, number];

function strokeKey(s: Stroke): string {
  const [a, b] = s.kind === 'dot' ? [s.a, s.a] : [Math.min(s.a, s.b), Math.max(s.a, s.b)];
  return `${s.kind}:${a}-${b}${s.kind === 'curve' ? `:${s.bend}` : ''}`;
}

function randomStroke(rng: Rng): Stroke {
  const roll = rng.next();
  const a = rng.int(0, 8);
  if (roll < 0.15) return { kind: 'dot', a };
  let b = rng.int(0, 8);
  while (b === a) b = rng.int(0, 8);
  return roll < 0.6 ? { kind: 'line', a, b } : { kind: 'curve', a, b, bend: rng.pick([-1, 1]) };
}

function toSvg(strokes: Stroke[]): Pick<Glyph, 'd' | 'dots'> {
  const parts: string[] = [];
  const dots: Array<[number, number]> = [];
  for (const s of strokes) {
    if (s.kind === 'dot') {
      dots.push(at(s.a));
      continue;
    }
    const [x1, y1] = at(s.a);
    const [x2, y2] = at(s.b);
    if (s.kind === 'line') {
      parts.push(`M${x1} ${y1}L${x2} ${y2}`);
    } else {
      // Control point pushed out perpendicular to the chord.
      const mx = (x1 + x2) / 2;
      const my = (y1 + y2) / 2;
      const cx = Math.max(0, Math.min(30, mx + (y2 - y1) * 0.5 * s.bend));
      const cy = Math.max(0, Math.min(30, my - (x2 - x1) * 0.5 * s.bend));
      parts.push(`M${x1} ${y1}Q${cx} ${cy} ${x2} ${y2}`);
    }
  }
  return { d: parts.join(''), dots };
}

/** `count` distinct glyphs, each with 2-4 strokes and at least one line or curve. */
export function generateGlyphs(count: number, rng: Rng): Glyph[] {
  const seen = new Set<string>();
  const glyphs: Glyph[] = [];
  while (glyphs.length < count) {
    const strokes: Stroke[] = [];
    const keys = new Set<string>();
    const target = rng.int(2, 4);
    while (strokes.length < target) {
      const stroke = randomStroke(rng);
      const key = strokeKey(stroke);
      if (keys.has(key)) continue;
      keys.add(key);
      strokes.push(stroke);
    }
    if (strokes.every((s) => s.kind === 'dot')) continue;
    const signature = [...keys].sort().join('|');
    if (seen.has(signature)) continue;
    seen.add(signature);
    glyphs.push({ id: `g${glyphs.length}`, ...toSvg(strokes) });
  }
  return glyphs;
}
