import type { ClipTransform } from '../comms';
import type { Rng } from '../rng';

// Pure audio helpers on raw mono PCM (Float32Array, -1..1). They run in the browser (scrambling a
// received clip) and on the server (building Patchwork's masked clips), so they never touch Web
// Audio or the file system.

/** Short fades at slice edges so cuts don't click. */
const EDGE_FADE_MS = 5;

const samples = (ms: number, sampleRate: number) =>
  Math.max(1, Math.round((ms / 1000) * sampleRate));

/** Fades the first and last `n` samples of a range in place. */
function fadeEdges(out: Float32Array, start: number, end: number, n: number): void {
  const len = end - start;
  const fade = Math.min(n, Math.floor(len / 2));
  for (let i = 0; i < fade; i++) {
    const g = i / fade;
    out[start + i] = (out[start + i] ?? 0) * g;
    out[end - 1 - i] = (out[end - 1 - i] ?? 0) * g;
  }
}

/**
 * Applies a clip transform: shuffle chops the clip into sliceMs pieces and plays them in a seeded
 * random order (the last piece may be shorter); reverse plays it backwards. Returns a new array
 * the same length as the input.
 */
export function transformPcm(
  pcm: Float32Array,
  sampleRate: number,
  transform: ClipTransform,
  rng: Rng,
): Float32Array {
  if (transform.kind === 'reverse') return pcm.slice().reverse();

  const sliceLen = samples(transform.sliceMs, sampleRate);
  const count = Math.ceil(pcm.length / sliceLen);
  const order = rng.shuffle(Array.from({ length: count }, (_, i) => i));
  const out = new Float32Array(pcm.length);
  const edge = samples(EDGE_FADE_MS, sampleRate);
  let at = 0;
  for (const index of order) {
    const piece = pcm.subarray(index * sliceLen, Math.min(pcm.length, (index + 1) * sliceLen));
    out.set(piece, at);
    fadeEdges(out, at, at + piece.length, edge);
    at += piece.length;
  }
  return out;
}

/** Root mean square of a range of samples (the whole clip by default). */
export function rms(pcm: Float32Array, start = 0, end = pcm.length): number {
  let sum = 0;
  for (let i = start; i < end; i++) sum += (pcm[i] ?? 0) ** 2;
  return end > start ? Math.sqrt(sum / (end - start)) : 0;
}

/**
 * Seeded pink noise (Paul Kellet's filter over white noise), scaled to the given RMS. Pink rather
 * than white because it sounds like a bad line rather than a hiss.
 */
export function pinkNoise(length: number, targetRms: number, rng: Rng): Float32Array {
  const out = new Float32Array(length);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  for (let i = 0; i < length; i++) {
    const white = rng.next() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    out[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
    b6 = white * 0.115926;
  }
  const current = rms(out);
  const scale = current > 0 ? targetRms / current : 0;
  for (let i = 0; i < length; i++) out[i] = (out[i] ?? 0) * scale;
  return out;
}

export interface ClipSlice {
  /** Sample range [start, end). */
  start: number;
  end: number;
  /** Which of the two players has this slice. */
  owner: 0 | 1;
}

/**
 * Cuts a clip into seeded random-length slices and deals them between two players. Not strict
 * alternation: the same player may get two or three slices in a row, never four.
 */
export function splitClip(
  length: number,
  sampleRate: number,
  rng: Rng,
  { minSliceMs, maxSliceMs }: { minSliceMs: number; maxSliceMs: number },
): ClipSlice[] {
  const min = samples(minSliceMs, sampleRate);
  const max = Math.max(min, samples(maxSliceMs, sampleRate));
  const slices: ClipSlice[] = [];
  let start = 0;
  let owner: 0 | 1 = rng.chance(0.5) ? 0 : 1;
  let run = 0;
  while (start < length) {
    let end = Math.min(length, start + rng.int(min, max));
    // Don't leave a sliver too short to hear at the end: fold it into this slice.
    if (length - end < min) end = length;
    const switchOwner = run >= 3 || (run >= 1 && rng.chance(0.55));
    if (switchOwner) {
      owner = owner === 0 ? 1 : 0;
      run = 0;
    }
    slices.push({ start, end, owner });
    run += 1;
    start = end;
  }
  // Both players must get something.
  if (slices.length > 1 && slices.every((s) => s.owner === slices[0]?.owner)) {
    const last = slices[slices.length - 1] as ClipSlice;
    last.owner = last.owner === 0 ? 1 : 0;
  }
  return slices;
}

/**
 * One player's version of a split clip: their slices as they are, everyone else's replaced by
 * pink noise at the clip's loudness, with a crossfade wherever the owner changes, so neither the
 * seams nor the slice lengths give anything away.
 */
export function maskedClip(
  pcm: Float32Array,
  sampleRate: number,
  slices: readonly ClipSlice[],
  owner: 0 | 1,
  rng: Rng,
  crossfadeMs = 20,
): Float32Array {
  const noise = pinkNoise(pcm.length, Math.max(rms(pcm), 0.02), rng);
  // mask: 1 where this player hears the clip, 0 where they hear noise.
  const mask = new Float32Array(pcm.length);
  for (const slice of slices) {
    if (slice.owner === owner) mask.fill(1, slice.start, slice.end);
  }
  const half = Math.floor(samples(crossfadeMs, sampleRate) / 2);
  const smooth = mask.slice();
  for (let i = 1; i < mask.length; i++) {
    if (mask[i] === mask[i - 1]) continue;
    const from = mask[i - 1] ?? 0;
    const to = mask[i] ?? 0;
    // A linear ramp centred on the boundary.
    for (let k = -half; k < half; k++) {
      const j = i + k;
      if (j < 0 || j >= mask.length) continue;
      const t = (k + half) / (2 * half);
      smooth[j] = from + (to - from) * t;
    }
  }
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    const m = smooth[i] ?? 0;
    out[i] = m * (pcm[i] ?? 0) + (1 - m) * (noise[i] ?? 0);
  }
  return out;
}
