import { useEffect, useState } from 'react';

/**
 * Counts down locally from the server's last reported remaining time. The server stays the
 * authority on when a round ends; this is only for display.
 */
export function useCountdown(remainingMs: number, receivedAt: number, running: boolean): number {
  const [now, setNow] = useState(() => performance.now());

  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(id);
  }, [running]);

  return Math.max(0, remainingMs - Math.max(0, now - receivedAt));
}

export function formatTime(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
