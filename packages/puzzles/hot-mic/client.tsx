import type { PuzzleClientProps } from '@split-signal/shared';
import { useEffect, useRef, useState } from 'react';
import styles from './client.module.css';
import type { Action, Hazard, LaneView, Move, View } from './types';

type Props = PuzzleClientProps<View, Action>;

/** How often a held Run repeats (the server stops you 300ms after the last). */
const RUN_EVERY_MS = 100;
/** Tiles shown behind and ahead of the runner. */
const BEHIND = 2;
const AHEAD = 12;

const LABEL: Record<Hazard['kind'], string> = {
  hurdle: 'hurdle',
  beam: 'beam',
  pitLeft: 'pit left',
  pitRight: 'pit right',
};

const MOVES: Array<{ move: Move; label: string; key: string }> = [
  { move: 'jump', label: '⤒ Jump', key: 'W' },
  { move: 'duck', label: '⤓ Duck', key: 'S' },
  { move: 'stepLeft', label: '↰ Step left', key: 'A' },
  { move: 'stepRight', label: '↱ Step right', key: 'D' },
];

/**
 * A top-down strip of lane around the runner, running rightwards: "left" is the top half.
 * Hazards are drawn only where given.
 */
function Lane({
  lane,
  length,
  hazards,
  elapsed,
  mine,
}: {
  lane: LaneView;
  length: number;
  hazards: Hazard[];
  elapsed: number;
  mine?: boolean;
}) {
  const from = lane.pos - BEHIND;
  const span = BEHIND + AHEAD;
  const x = (tile: number) => ((tile - from) / span) * 100;
  const stunned = lane.stunnedUntil !== null && lane.stunnedUntil > elapsed;
  return (
    <svg viewBox="0 0 100 24" className={styles.lane} preserveAspectRatio="none" aria-hidden="true">
      <rect x="0" y="0" width="100" height="24" fill="#20242c" />
      <line
        x1="0"
        y1="12"
        x2="100"
        y2="12"
        stroke="#2c313b"
        strokeWidth="0.3"
        strokeDasharray="1.5 1.5"
      />
      {Array.from({ length: span + 2 }, (_, i) => Math.floor(from) + i).map((tile) => (
        <line
          key={tile}
          x1={x(tile)}
          y1="0"
          x2={x(tile)}
          y2="24"
          stroke="#262a33"
          strokeWidth="0.25"
        />
      ))}
      {x(length) <= 100 && (
        <rect x={x(length)} y="0" width="1.5" height="24" fill="#f5f5f5" opacity="0.8" />
      )}
      {hazards.map((h) => {
        const hx = x(h.at);
        if (hx < -5 || hx > 105) return null;
        return (
          <g key={h.at}>
            {h.kind === 'hurdle' && (
              <rect x={hx - 0.7} y="2" width="1.4" height="20" fill="#f5b83d" />
            )}
            {h.kind === 'beam' && (
              <rect x={hx - 0.7} y="2" width="1.4" height="20" fill="#8e4ec6" opacity="0.6" />
            )}
            {h.kind === 'pitLeft' && (
              <rect x={hx - 3} y="1" width="6" height="10.5" fill="#07080a" />
            )}
            {h.kind === 'pitRight' && (
              <rect x={hx - 3} y="12.5" width="6" height="10.5" fill="#07080a" />
            )}
            <text
              x={hx}
              y={h.kind === 'pitLeft' ? 20 : 7}
              fontSize="3"
              textAnchor="middle"
              fill="#e8eaee"
            >
              {LABEL[h.kind]}
            </text>
          </g>
        );
      })}
      <circle
        cx={x(lane.pos)}
        cy="12"
        r="2.6"
        fill={stunned ? '#e5484d' : mine ? '#4cc9f0' : '#f72585'}
        stroke="#06121a"
        strokeWidth="0.6"
      />
    </svg>
  );
}

export default function HotMic({ view, send, timer }: Props) {
  const elapsed = timer.totalMs - timer.remainingMs;
  const [running, setRunning] = useState(false);
  const runTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });

  const startRun = () => {
    if (runTimer.current) return;
    sendRef.current({ type: 'run' });
    runTimer.current = setInterval(() => sendRef.current({ type: 'run' }), RUN_EVERY_MS);
    setRunning(true);
  };
  const stopRun = () => {
    if (!runTimer.current) return;
    clearInterval(runTimer.current);
    runTimer.current = undefined;
    sendRef.current({ type: 'stop' });
    setRunning(false);
  };
  const startRef = useRef(startRun);
  const stopRef = useRef(stopRun);
  useEffect(() => {
    startRef.current = startRun;
    stopRef.current = stopRun;
  });

  useEffect(() => {
    const keys: Record<string, Move> = {
      w: 'jump',
      ArrowUp: 'jump',
      s: 'duck',
      ArrowDown: 'duck',
      a: 'stepLeft',
      ArrowLeft: 'stepLeft',
      d: 'stepRight',
      ArrowRight: 'stepRight',
    };
    const down = (e: KeyboardEvent) => {
      if (e.key === ' ') {
        e.preventDefault();
        if (!e.repeat) startRef.current();
        return;
      }
      const move = keys[e.key] ?? keys[e.key.toLowerCase()];
      if (move && !e.repeat) {
        e.preventDefault();
        sendRef.current({ type: move });
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === ' ') stopRef.current();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      clearInterval(runTimer.current);
    };
  }, []);

  const stunnedFor =
    view.me.stunnedUntil === null ? 0 : Math.max(0, view.me.stunnedUntil - elapsed);
  const done = view.me.finished;
  return (
    <div className={styles.root}>
      <p className={`${styles.mic} ${view.me.moving ? styles.off : styles.live}`} role="status">
        {done
          ? '🏁 Over the line'
          : view.me.moving
            ? '🔇 Running: you can’t talk or hear'
            : '🎙 Standing still: mic live'}
      </p>
      <section className={styles.panel}>
        <h4>
          {view.watched.name}&apos;s lane: warn them
          {view.watched.finished ? ' (over the line)' : ''}
        </h4>
        <Lane
          lane={view.watched}
          length={view.length}
          hazards={view.watched.hazards}
          elapsed={elapsed}
        />
        <p className={styles.note}>
          {view.watched.moving ? 'They’re running and can’t hear you.' : 'They’re standing still.'}
        </p>
      </section>
      <section className={styles.panel}>
        <h4>Your lane (you can&apos;t see its hazards)</h4>
        <Lane
          lane={view.me}
          length={view.length}
          hazards={view.myHazards ?? []}
          elapsed={elapsed}
          mine
        />
        <div className={styles.progress}>
          <span style={{ width: `${(view.me.pos / view.length) * 100}%` }} />
        </div>
        <p className={styles.note}>
          {stunnedFor > 0
            ? `Hit! Stunned for ${Math.ceil(stunnedFor / 1000)}s`
            : `${Math.round(view.me.pos)} of ${view.length} tiles · ${view.me.hits} hit${view.me.hits === 1 ? '' : 's'}`}
        </p>
      </section>
      {!view.myHazards && (
        <div className={styles.controls}>
          <button
            className={`${styles.run} ${running ? styles.running : ''}`}
            disabled={done}
            onPointerDown={(e) => {
              if (e.button !== 0) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              startRun();
            }}
            onPointerUp={stopRun}
            onPointerCancel={stopRun}
            onLostPointerCapture={stopRun}
            onContextMenu={(e) => e.preventDefault()}
          >
            {running ? 'Running…' : 'Hold to run'}
            <span className={styles.keys}> (Space)</span>
          </button>
          <div className={styles.moves}>
            {MOVES.map(({ move, label, key }) => (
              <button
                key={move}
                className="secondary"
                disabled={done}
                onClick={() => send({ type: move })}
              >
                {label}
                <span className={styles.keys}> {key}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <p className={styles.note}>
        {view.finished} of {view.total} over the line. Make the move just before you reach a hazard.
      </p>
    </div>
  );
}
