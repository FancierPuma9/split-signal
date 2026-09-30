import { createRng, transformPcm, type ClipTransform } from '@split-signal/shared';

// One Web Audio context for the whole client, unlocked by the player's taps.
//
// Phones only let a page start making sound inside a user gesture: iOS Safari keeps an
// AudioContext that was created or resumed anywhere else suspended, and refuses play() on media
// elements. Sounds here are usually triggered by server messages (a teammate's clip, a chime), so
// the client calls unlockAudio() from every tap and all puzzle audio goes through audioContext().

let context: AudioContext | null = null;
const listeners = new Set<() => void>();
/** Media elements whose play() was refused; retried on the next tap. */
const blocked = new Set<HTMLMediaElement>();

const notify = () => {
  for (const listener of listeners) listener();
};

/** The shared context, or null where Web Audio doesn't exist. Resumed if it can be. */
export function audioContext(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  if (!context) {
    context = new AudioContext();
    context.onstatechange = notify;
  }
  if (context.state !== 'running') void context.resume().catch(() => {});
  return context;
}

/**
 * Resolves true once the shared context is running. Inside a tap that's almost immediate;
 * outside one, phones leave it suspended and this gives up after `timeoutMs`.
 */
export async function ensureAudio(timeoutMs = 400): Promise<boolean> {
  const ctx = audioContext();
  if (!ctx) return false;
  if (ctx.state === 'running') return true;
  await Promise.race([
    ctx.resume().catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]);
  return (ctx.state as AudioContextState) === 'running';
}

/** Whether sound can play right now (false until the first tap on phones). */
export function audioReady(): boolean {
  return context?.state === 'running';
}

/** Calls `listener` whenever audioReady() may have changed. Returns an unsubscribe function. */
export function onAudioChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Call synchronously from a user gesture (a tap's pointerup/click, or a key press). Starts the
 * shared context with a silent sample, which is what iOS wants, and retries refused media.
 */
export function unlockAudio(): void {
  const ctx = audioContext();
  if (ctx && ctx.state !== 'running') {
    const source = ctx.createBufferSource();
    source.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
    source.connect(ctx.destination);
    source.start();
  }
  for (const el of blocked) {
    el.play().then(
      () => blocked.delete(el),
      () => {},
    );
  }
  notify();
}

/** play() that, if the browser refuses without a gesture, tries again on the next tap. */
export function playWhenAllowed(el: HTMLMediaElement): void {
  el.play().then(
    () => blocked.delete(el),
    () => {
      blocked.add(el);
      notify();
    },
  );
}

/** Forget a media element (it was removed). */
export function forgetMedia(el: HTMLMediaElement): void {
  blocked.delete(el);
}

/** Whether some media is waiting for a tap before it can play. */
export function mediaBlocked(): boolean {
  return blocked.size > 0;
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** Decodes a base64 audio clip (as sent by the server) with the shared context. */
export async function decodeClip(data: string): Promise<AudioBuffer> {
  const ctx = audioContext();
  if (!ctx) throw new Error('No Web Audio');
  return ctx.decodeAudioData(base64ToArrayBuffer(data));
}

/** Something playing through the shared context. */
export interface Playback {
  /** Resolves when it finishes or is stopped. */
  done: Promise<void>;
  stop(): void;
}

/** Plays mono PCM through the shared context (e.g. a replayed utterance). Null while locked. */
export function playPcm(pcm: Float32Array, sampleRate: number, gain = 1): Playback | null {
  const ctx = audioContext();
  if (!ctx || ctx.state !== 'running' || pcm.length === 0) return null;
  const buffer = ctx.createBuffer(1, pcm.length, sampleRate);
  buffer.copyToChannel(pcm as Float32Array<ArrayBuffer>, 0);
  return startBuffer(ctx, buffer, gain);
}

function startBuffer(
  ctx: AudioContext,
  buffer: AudioBuffer,
  gain: number,
  maxMs?: number,
): Playback {
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  const level = ctx.createGain();
  level.gain.value = gain;
  source.connect(level).connect(ctx.destination);
  const done = new Promise<void>((resolve) => {
    source.onended = () => resolve();
  });
  source.start(0, 0, maxMs !== undefined ? maxMs / 1000 : undefined);
  return {
    done,
    stop: () => {
      try {
        source.stop();
      } catch {
        // Already stopped.
      }
    },
  };
}

/**
 * Plays a delivered clip the way the server asked: scrambled with its seeded transform (clip
 * rules with transform) and cut off at playMs (budgets and hard caps). Resolves to null while
 * sound is locked; rejects if this device can't decode the clip.
 */
export async function playClip(
  clip: { data: string; params: unknown },
  gain = 1,
): Promise<Playback | null> {
  if (!(await ensureAudio())) return null;
  const decoded = await decodeClip(clip.data);
  const ctx = audioContext();
  if (!ctx) return null;
  const params = (clip.params ?? {}) as {
    playMs?: unknown;
    transform?: ClipTransform;
    transformSeed?: unknown;
  };
  let buffer = decoded;
  if (params.transform) {
    const mono = new Float32Array(decoded.length);
    for (let c = 0; c < decoded.numberOfChannels; c++) {
      const channel = decoded.getChannelData(c);
      for (let i = 0; i < mono.length; i++)
        mono[i] = (mono[i] ?? 0) + (channel[i] ?? 0) / decoded.numberOfChannels;
    }
    const seed = typeof params.transformSeed === 'string' ? params.transformSeed : 'clip';
    const scrambled = transformPcm(mono, decoded.sampleRate, params.transform, createRng(seed));
    buffer = ctx.createBuffer(1, scrambled.length, decoded.sampleRate);
    buffer.copyToChannel(scrambled as Float32Array<ArrayBuffer>, 0);
  }
  const maxMs = typeof params.playMs === 'number' ? params.playMs : undefined;
  return startBuffer(ctx, buffer, gain, maxMs);
}
