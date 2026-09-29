import { useEffect } from 'react';

/**
 * Keeps the screen on while `active`. Phones otherwise dim and lock mid-round while you're talking
 * rather than touching the screen, which suspends the page and drops voice. The browser releases
 * the lock whenever the tab is hidden, so it's taken again when the tab comes back.
 */
export function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let stopped = false;
    const acquire = () => {
      if (document.visibilityState !== 'visible' || (lock && !lock.released)) return;
      navigator.wakeLock
        .request('screen')
        .then((l) => {
          if (stopped) void l.release();
          else lock = l;
        })
        .catch(() => {
          // Refused (battery saver, no user gesture yet): the screen just behaves as usual.
        });
    };
    acquire();
    document.addEventListener('visibilitychange', acquire);
    // Some browsers only grant it after a tap.
    window.addEventListener('pointerup', acquire);
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', acquire);
      window.removeEventListener('pointerup', acquire);
      void lock?.release();
    };
  }, [active]);
}
