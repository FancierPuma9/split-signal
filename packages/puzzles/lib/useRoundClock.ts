import { useCallback, useEffect, useRef } from 'react';

/** How far past the last timer update to run on. Any longer and the round is probably paused. */
const MAX_EXTRAPOLATE_MS = 400;

/**
 * Smooth round time for animation. The shell's timer prop only updates a few times a second;
 * this returns a function giving the round's elapsed ms right now, for use inside
 * requestAnimationFrame. Display only: the server decides what time an action happened.
 */
export function useRoundClock(timer: { remainingMs: number; totalMs: number }): () => number {
  const elapsed = timer.totalMs - timer.remainingMs;
  const last = useRef<{ elapsed: number; at: number } | null>(null);
  useEffect(() => {
    last.current = { elapsed, at: performance.now() };
  }, [elapsed]);
  return useCallback(() => {
    const l = last.current;
    return l ? l.elapsed + Math.min(MAX_EXTRAPOLATE_MS, performance.now() - l.at) : 0;
  }, []);
}
