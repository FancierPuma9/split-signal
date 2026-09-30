import { audioContext } from '../lib/audio';

// Dictionary's twelve sounds, synthesized with Web Audio so there are no files to ship. Each is
// short and unlike the others; the labels are what players see.

type Recipe = (ctx: AudioContext, out: AudioNode, t: number) => void;

let noise: AudioBuffer | null = null;
let offset = 0;

/** One second of white noise (a fixed pseudo-random sequence; nothing depends on it). */
function noiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noise && noise.sampleRate === ctx.sampleRate) return noise;
  noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = noise.getChannelData(0);
  let seed = 22222;
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    data[i] = (seed / 0x7fffffff) * 2 - 1;
  }
  return noise;
}

function envelope(
  ctx: AudioContext,
  t: number,
  attack: number,
  hold: number,
  release: number,
  peak: number,
) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.setValueAtTime(peak, t + attack + hold);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + release);
  return g;
}

function tone(
  ctx: AudioContext,
  out: AudioNode,
  t: number,
  opts: {
    type: OscillatorType;
    from: number;
    to?: number;
    dur: number;
    peak: number;
    attack?: number;
  },
) {
  const osc = ctx.createOscillator();
  osc.type = opts.type;
  osc.frequency.setValueAtTime(opts.from, t);
  if (opts.to !== undefined) osc.frequency.exponentialRampToValueAtTime(opts.to, t + opts.dur);
  const g = envelope(ctx, t, opts.attack ?? 0.005, 0, opts.dur, opts.peak);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + opts.dur + 0.05);
}

function burst(
  ctx: AudioContext,
  out: AudioNode,
  t: number,
  opts: {
    dur: number;
    peak: number;
    filter: BiquadFilterType;
    freq: number;
    to?: number;
    q?: number;
  },
) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = opts.filter;
  filter.frequency.setValueAtTime(opts.freq, t);
  if (opts.to !== undefined) filter.frequency.exponentialRampToValueAtTime(opts.to, t + opts.dur);
  filter.Q.value = opts.q ?? 1;
  const g = envelope(ctx, t, 0.003, 0, opts.dur, opts.peak);
  src.connect(filter).connect(g).connect(out);
  // Start somewhere different in the noise each time, so repeats don't sound identical.
  offset = (offset + 0.137) % 0.5;
  src.start(t, offset);
  src.stop(t + opts.dur + 0.05);
}

const RECIPES: Record<string, Recipe> = {
  DING: (ctx, out, t) => {
    tone(ctx, out, t, { type: 'sine', from: 1320, dur: 0.9, peak: 0.3 });
    tone(ctx, out, t, { type: 'sine', from: 2640, dur: 0.5, peak: 0.08 });
  },
  BUZZ: (ctx, out, t) => {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    lp.connect(out);
    tone(ctx, lp, t, { type: 'sawtooth', from: 110, dur: 0.45, peak: 0.35, attack: 0.01 });
  },
  BOOM: (ctx, out, t) => {
    tone(ctx, out, t, { type: 'sine', from: 160, to: 38, dur: 0.7, peak: 0.6 });
    burst(ctx, out, t, { dur: 0.4, peak: 0.25, filter: 'lowpass', freq: 400 });
  },
  CLAP: (ctx, out, t) => {
    for (const dt of [0, 0.012, 0.024]) {
      burst(ctx, out, t + dt, { dur: 0.06, peak: 0.4, filter: 'bandpass', freq: 1500, q: 0.8 });
    }
  },
  TICK: (ctx, out, t) =>
    burst(ctx, out, t, { dur: 0.02, peak: 0.5, filter: 'highpass', freq: 3000 }),
  WHOOSH: (ctx, out, t) =>
    burst(ctx, out, t, { dur: 0.55, peak: 0.35, filter: 'bandpass', freq: 400, to: 3500, q: 2 }),
  ZAP: (ctx, out, t) =>
    tone(ctx, out, t, { type: 'square', from: 1400, to: 180, dur: 0.25, peak: 0.18 }),
  POW: (ctx, out, t) => {
    burst(ctx, out, t, { dur: 0.15, peak: 0.45, filter: 'lowpass', freq: 2000 });
    tone(ctx, out, t, { type: 'triangle', from: 220, to: 90, dur: 0.2, peak: 0.4 });
  },
  HONK: (ctx, out, t) => {
    tone(ctx, out, t, { type: 'square', from: 330, dur: 0.35, peak: 0.12, attack: 0.02 });
    tone(ctx, out, t, { type: 'square', from: 415, dur: 0.35, peak: 0.1, attack: 0.02 });
  },
  SPLAT: (ctx, out, t) => {
    burst(ctx, out, t, { dur: 0.3, peak: 0.45, filter: 'lowpass', freq: 1200, to: 150 });
    tone(ctx, out, t, { type: 'sine', from: 300, to: 60, dur: 0.25, peak: 0.25 });
  },
  RIBBIT: (ctx, out, t) => {
    for (const dt of [0, 0.22]) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(240, t + dt);
      osc.frequency.linearRampToValueAtTime(180, t + dt + 0.14);
      const trem = ctx.createGain();
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 30;
      const depth = ctx.createGain();
      depth.gain.value = 0.5;
      lfo.connect(depth).connect(trem.gain);
      const g = envelope(ctx, t + dt, 0.01, 0.06, 0.08, 0.3);
      osc.connect(trem).connect(g).connect(out);
      osc.start(t + dt);
      lfo.start(t + dt);
      osc.stop(t + dt + 0.2);
      lfo.stop(t + dt + 0.2);
    }
  },
  CRUNCH: (ctx, out, t) => {
    for (let i = 0; i < 9; i++) {
      burst(ctx, out, t + i * 0.035, {
        dur: 0.03,
        peak: 0.35,
        filter: 'bandpass',
        freq: 900 + i * 180,
        q: 1.5,
      });
    }
  },
};

/** Plays one of the sounds by its label (quietly, for the Sender's own echo). */
export function playSound(name: string, volume = 1): void {
  const ctx = audioContext();
  const recipe = RECIPES[name];
  if (!ctx || !recipe || ctx.state !== 'running') return;
  const out = ctx.createGain();
  out.gain.value = volume;
  out.connect(ctx.destination);
  recipe(ctx, out, ctx.currentTime + 0.01);
}
