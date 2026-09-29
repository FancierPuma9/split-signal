import type { PuzzleClientProps } from '@split-signal/shared';
import { useEffect, useRef, type CSSProperties } from 'react';
import { Blackout } from '../lib/Blackout';
import styles from './client.module.css';
import type { Action, LiveView, View } from './types';

const COLOR: Record<string, string> = {
  Red: '#e5484d',
  Blue: '#4c9aff',
  Green: '#3ddc84',
  Yellow: '#ffd23f',
  Purple: '#a78bfa',
  Orange: '#ff8b3d',
};

const KEYS: Record<string, 'n' | 's' | 'e' | 'w'> = {
  ArrowUp: 'n',
  ArrowDown: 's',
  ArrowLeft: 'w',
  ArrowRight: 'e',
  w: 'n',
  s: 's',
  a: 'w',
  d: 'e',
  W: 'n',
  S: 's',
  A: 'w',
  D: 'e',
};

export default function Walkie({ view, send }: PuzzleClientProps<View, Action>) {
  if (view.role === 'listening') {
    return (
      <Blackout
        label="Listen"
        detail="Your partner is live. You'll get control back without warning."
      />
    );
  }
  return <Room view={view} send={send} />;
}

function Room({ view, send }: { view: LiveView; send: (a: Action) => void }) {
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });
  useEffect(() => {
    let last = 0;
    const down = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const dir = KEYS[e.key];
      if (dir) {
        e.preventDefault();
        const now = performance.now();
        if (now - last < 120) return;
        last = now;
        sendRef.current({ type: 'move', dir });
      } else if (e.key === ' ' || e.key === 'e' || e.key === 'E' || e.key === 'Enter') {
        e.preventDefault();
        if (!e.repeat) sendRef.current({ type: 'flip' });
      }
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, []);

  const onSwitch = view.switches.find((s) => s.x === view.me.x && s.y === view.me.y);
  const width = view.rows[0]!.length;

  return (
    <div className={styles.root}>
      <p className={styles.live}>● You’re live: talk, move, flip</p>
      <div className={styles.room} style={{ gridTemplateColumns: `repeat(${width}, 1fr)` }}>
        {view.rows.map((row, y) =>
          [...row].map((t, x) => {
            const gate = t === 'G' ? view.gates.find((g) => g.x === x && g.y === y) : undefined;
            const sw = view.switches.find((s) => s.x === x && s.y === y);
            const me = view.me.x === x && view.me.y === y;
            const cls =
              t === '#'
                ? styles.wall
                : gate
                  ? gate.open
                    ? styles.gateOpen
                    : styles.gateShut
                  : t === 'X'
                    ? styles.exit
                    : styles.floor;
            return (
              <div key={`${x}:${y}`} className={`${styles.cell} ${cls}`}>
                {sw && (
                  <span
                    className={`${styles.switch} ${sw.on ? styles.on : ''}`}
                    style={{ '--c': COLOR[sw.color] ?? '#999' } as CSSProperties}
                    title={`${sw.color} ${sw.symbol}`}
                  >
                    {sw.symbol}
                  </span>
                )}
                {t === 'X' && !me && <span className={styles.exitSign}>EXIT</span>}
                {me && <span className={styles.me}>🧍</span>}
              </div>
            );
          }),
        )}
      </div>
      <div className={styles.controls}>
        <div className={styles.dpad}>
          <button
            className={`${styles.pad} ${styles.up}`}
            aria-label="Up"
            onClick={() => send({ type: 'move', dir: 'n' })}
          >
            ▲
          </button>
          <button
            className={`${styles.pad} ${styles.left}`}
            aria-label="Left"
            onClick={() => send({ type: 'move', dir: 'w' })}
          >
            ◀
          </button>
          <button
            className={`${styles.pad} ${styles.right}`}
            aria-label="Right"
            onClick={() => send({ type: 'move', dir: 'e' })}
          >
            ▶
          </button>
          <button
            className={`${styles.pad} ${styles.down}`}
            aria-label="Down"
            onClick={() => send({ type: 'move', dir: 's' })}
          >
            ▼
          </button>
        </div>
        <button className={styles.flip} disabled={!onSwitch} onClick={() => send({ type: 'flip' })}>
          {onSwitch
            ? `Flip ${onSwitch.color} ${onSwitch.symbol} ${onSwitch.on ? 'off' : 'on'}`
            : 'Stand on a switch'}
        </button>
      </div>
      <p className={styles.hint}>
        Your switches work your partner’s gates, and theirs work yours. Some open, some shut, some
        do nothing. Arrow keys or WASD to move, Space to flip.
      </p>
    </div>
  );
}
