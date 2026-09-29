import { useEffect, useState } from 'react';

const GLYPHS: Record<string, string> = { up: '↑', down: '↓', left: '←', right: '→' };
const glyph = (signal: string) => GLYPHS[signal] ?? signal;
/** How long an incoming signal stays in the feed. */
const FEED_MS = 5000;

interface SignalBarProps {
  allowed: string[];
  cooldownMs: number;
  incoming: Array<{ from: string; signal: string; at: number }>;
  meId: string;
  nameOf: (playerId: string) => string;
  onSend: (signal: string) => void;
}

/** Buttons for the signals the current puzzle allows, plus a feed of what teammates sent. */
export function SignalBar({ allowed, cooldownMs, incoming, meId, nameOf, onSend }: SignalBarProps) {
  const [cooling, setCooling] = useState(false);
  const [now, setNow] = useState(() => performance.now());

  // Mirror the server's cooldown so the buttons don't look like they work when they won't.
  useEffect(() => {
    if (!cooling) return;
    const id = setTimeout(() => setCooling(false), cooldownMs);
    return () => clearTimeout(id);
  }, [cooling, cooldownMs]);

  // Tick the clock until the newest signal has faded from the feed.
  const newest = incoming.at(-1)?.at;
  useEffect(() => {
    if (newest === undefined) return;
    const id = setInterval(() => setNow(performance.now()), 250);
    const stop = setTimeout(() => clearInterval(id), FEED_MS + 500);
    return () => {
      clearInterval(id);
      clearTimeout(stop);
    };
  }, [newest]);

  if (allowed.length === 0) return null;
  const recent = incoming.filter((s) => s.from !== meId && now - s.at < FEED_MS).slice(-4);

  return (
    <div className="signal-bar">
      <span className="muted small">Signal your team</span>
      <div className="signal-buttons">
        {allowed.map((signal) => (
          <button
            key={signal}
            className="secondary"
            disabled={cooling}
            onClick={() => {
              onSend(signal);
              setCooling(true);
            }}
            aria-label={`Send signal ${signal}`}
          >
            {glyph(signal)}
          </button>
        ))}
      </div>
      <ul className="signal-feed" aria-live="polite">
        {recent.map((s) => (
          <li key={`${s.from}-${s.at}`}>
            <strong>{nameOf(s.from)}</strong>{' '}
            <span className="signal-glyph">{glyph(s.signal)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
