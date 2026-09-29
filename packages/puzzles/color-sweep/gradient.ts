export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** One direction of a sweep; a full sweep is there and back. */
export const SWEEP_MS = 6000;
export const SWEEPS = 5;
export const TOTAL_MS = SWEEP_MS * 2 * SWEEPS;

/** Where the sweep is along the gradient (0..1) at round time `ms`. */
export function sweepT(ms: number): number {
  const phase = ((ms % (SWEEP_MS * 2)) + SWEEP_MS * 2) % (SWEEP_MS * 2);
  return phase < SWEEP_MS ? phase / SWEEP_MS : 2 - phase / SWEEP_MS;
}

/** Which sweep (1-based) is running at `ms`, and which way it is going. */
export function sweepAt(ms: number): { sweep: number; forward: boolean } {
  const clamped = Math.min(Math.max(ms, 0), TOTAL_MS - 1);
  return {
    sweep: Math.floor(clamped / (SWEEP_MS * 2)) + 1,
    forward: clamped % (SWEEP_MS * 2) < SWEEP_MS,
  };
}

/** The colour at t along evenly spaced stops, blended in sRGB (as CSS gradients are). */
export function colorAt(stops: readonly Rgb[], t: number): Rgb {
  const span = stops.length - 1;
  const x = Math.min(Math.max(t, 0), 1) * span;
  const i = Math.min(span - 1, Math.floor(x));
  const u = x - i;
  const a = stops[i]!;
  const b = stops[i + 1]!;
  const mix = (p: number, q: number) => Math.round(p + (q - p) * u);
  return { r: mix(a.r, b.r), g: mix(a.g, b.g), b: mix(a.b, b.b) };
}

export const toCss = ({ r, g, b }: Rgb) => `rgb(${r} ${g} ${b})`;

export function hslToRgb(h: number, s: number, l: number): Rgb {
  const sat = s / 100;
  const light = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const f = (n: number) => light - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255) };
}
