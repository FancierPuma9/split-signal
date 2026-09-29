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
