import type { Glyph } from './glyphs';

/** Draws a generated glyph at the given size, in the current text color. */
export function GlyphSvg({ glyph, size = 30 }: { glyph: Glyph | undefined; size?: number }) {
  if (!glyph) return null;
  return (
    <svg viewBox="0 0 30 30" width={size} height={size} aria-hidden>
      <path
        d={glyph.d}
        fill="none"
        stroke="currentColor"
        strokeWidth={2.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {glyph.dots.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={2.3} fill="currentColor" />
      ))}
    </svg>
  );
}
