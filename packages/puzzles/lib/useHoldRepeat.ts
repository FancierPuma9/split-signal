import { useCallback, useEffect, useRef, type MouseEvent, type PointerEvent } from 'react';

/**
 * Props for a button that acts once when pressed and keeps repeating while held, like a held
 * arrow key, so touch players don't have to tap once per step. Keyboard activation (Enter or
 * Space on the focused button) acts once.
 *
 *   const hold = useHoldRepeat(150);
 *   <button {...hold(() => move('n'))}>↑</button>
 */
export function useHoldRepeat(everyMs: number, delayMs = 300) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const stop = useCallback(() => clearTimeout(timer.current), []);
  useEffect(() => stop, [stop]);

  return useCallback(
    (action: () => void) => ({
      onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
        if (e.button !== 0 || e.currentTarget.disabled) return;
        try {
          // Keeps the release coming here even if the finger slides off the button.
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // Not an active pointer (synthetic events); the hold still works without capture.
        }
        stop();
        action();
        const tick = () => {
          action();
          timer.current = setTimeout(tick, everyMs);
        };
        timer.current = setTimeout(tick, delayMs);
      },
      onPointerUp: stop,
      onPointerCancel: stop,
      onLostPointerCapture: stop,
      // A long press would otherwise open the context menu on phones.
      onContextMenu: (e: MouseEvent) => e.preventDefault(),
      onClick: (e: MouseEvent) => {
        // detail is 0 for keyboard-triggered clicks; pointer presses already acted.
        if (e.detail === 0) action();
      },
    }),
    [stop, everyMs, delayMs],
  );
}
