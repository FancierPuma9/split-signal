// Feedback sounds, synthesized with Web Audio so there are no audio assets to ship.

let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  context ??= new AudioContext();
  if (context.state === 'suspended') void context.resume();
  return context;
}

function tone(
  ctx: AudioContext,
  {
    freq,
    type,
    start,
    duration,
    peak,
  }: { freq: number; type: OscillatorType; start: number; duration: number; peak: number },
  destination: AudioNode,
): void {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  osc.connect(gain).connect(destination);
  osc.start(start);
  osc.stop(start + duration + 0.05);
}

/** A bright two-note bell. */
export function playChime(): void {
  const ctx = audio();
  if (!ctx) return;
  const t = ctx.currentTime;
  tone(ctx, { freq: 1046.5, type: 'sine', start: t, duration: 1.2, peak: 0.25 }, ctx.destination);
  tone(
    ctx,
    { freq: 1568, type: 'sine', start: t + 0.08, duration: 1.1, peak: 0.18 },
    ctx.destination,
  );
}

/** A low, dull buzz. */
export function playBuzz(): void {
  const ctx = audio();
  if (!ctx) return;
  const t = ctx.currentTime;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 700;
  filter.connect(ctx.destination);
  tone(ctx, { freq: 92, type: 'sawtooth', start: t, duration: 0.4, peak: 0.22 }, filter);
  tone(ctx, { freq: 95, type: 'square', start: t, duration: 0.4, peak: 0.08 }, filter);
}
