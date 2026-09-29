import type { PuzzleClientProps } from '@split-signal/shared';
import { useCallback, useEffect, useRef, type CSSProperties } from 'react';
import styles from './client.module.css';
import { DELAY_MS } from './manifest';
import { GRAB_RADIUS, TOY_RADIUS } from './physics';
import type { Action, Point, View } from './types';

const at = (p: Point): CSSProperties => ({ left: `${p.x * 100}%`, top: `${p.y * 100}%` });

type Dir = 'up' | 'down' | 'left' | 'right';
const KEYS: Record<string, Dir> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  w: 'up',
  s: 'down',
  a: 'left',
  d: 'right',
  W: 'up',
  S: 'down',
  A: 'left',
  D: 'right',
};

export default function EchoClaw({ view, send }: PuzzleClientProps<View, Action>) {
  const delay = DELAY_MS / 1000;
  return (
    <div className={styles.root}>
      <p className={styles.hint}>
        {view.role === 'spotter'
          ? `You can see the toy. Everything you say arrives ${delay}s late: tell them where it will be.`
          : `You can't see the toy. Arrow keys or WASD to move, Space to drop. Your Spotter's words arrive ${delay}s late.`}
      </p>
      <div
        className={styles.machine}
        style={
          {
            '--claw': `${GRAB_RADIUS * 200}%`,
            '--toy': `${TOY_RADIUS * 200}%`,
            '--drop': `${view.dropMs}ms`,
            '--rise': `${view.busyMs - view.dropMs}ms`,
          } as CSSProperties
        }
      >
        {view.role === 'spotter' && (
          <div key={view.grabs} className={styles.toy} style={at(view.toy)} aria-label="Toy">
            🧸
          </div>
        )}
        <div
          key={view.dropping?.at ?? 'free'}
          className={[styles.claw, view.dropping && styles.dropping].filter(Boolean).join(' ')}
          style={at(view.claw)}
          aria-label="Claw"
        />
        {view.lastDrop && (
          <div
            key={view.lastDrop.at}
            className={view.lastDrop.hit ? styles.hit : styles.miss}
            role="status"
          >
            {view.lastDrop.hit ? 'Got it!' : 'Missed'}
          </div>
        )}
      </div>
      <p className={styles.grabs}>
        Grabs: <strong>{view.grabs}</strong>
      </p>
      {view.role === 'operator' && <Controls send={send} busy={view.dropping !== null} />}
    </div>
  );
}

function Controls({ send, busy }: { send: (action: Action) => void; busy: boolean }) {
  const held = useRef(new Set<Dir>());
  const lastSent = useRef('0,0');
  const busyRef = useRef(busy);
  useEffect(() => {
    busyRef.current = busy;
  }, [busy]);

  const update = useCallback(() => {
    const h = held.current;
    const dx = (h.has('right') ? 1 : 0) - (h.has('left') ? 1 : 0);
    const dy = (h.has('down') ? 1 : 0) - (h.has('up') ? 1 : 0);
    const key = `${dx},${dy}`;
    if (key === lastSent.current) return;
    lastSent.current = key;
    send({ type: 'move', dx, dy });
  }, [send]);

  const drop = useCallback(() => {
    if (!busyRef.current) send({ type: 'drop' });
  }, [send]);

  useEffect(() => {
    const typing = (e: KeyboardEvent) =>
      e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement;
    const down = (e: KeyboardEvent) => {
      if (typing(e)) return;
      if (e.key === ' ') {
        e.preventDefault();
        if (!e.repeat) drop();
        return;
      }
      const dir = KEYS[e.key];
      if (!dir) return;
      e.preventDefault();
      held.current.add(dir);
      update();
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === ' ') e.preventDefault();
      const dir = KEYS[e.key];
      if (!dir) return;
      held.current.delete(dir);
      update();
    };
    const release = () => {
      held.current.clear();
      update();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', release);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', release);
    };
  }, [drop, update]);

  const pad = (dir: Dir, label: string, arrow: string) => (
    <button
      className={`${styles.pad} ${styles[dir]}`}
      aria-label={label}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        held.current.add(dir);
        update();
      }}
      onPointerUp={() => {
        held.current.delete(dir);
        update();
      }}
      onPointerCancel={() => {
        held.current.delete(dir);
        update();
      }}
    >
      {arrow}
    </button>
  );

  return (
    <div className={styles.controls}>
      <div className={styles.dpad}>
        {pad('up', 'Up', '▲')}
        {pad('left', 'Left', '◀')}
        {pad('right', 'Right', '▶')}
        {pad('down', 'Down', '▼')}
      </div>
      <button className={styles.drop} disabled={busy} onClick={drop}>
        {busy ? 'Dropping…' : 'Drop'}
      </button>
    </div>
  );
}
