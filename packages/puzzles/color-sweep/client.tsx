import type { PuzzleClientProps } from '@split-signal/shared';
import { useEffect, useRef } from 'react';
import { useRoundClock } from '../lib/useRoundClock';
import styles from './client.module.css';
import { colorAt, sweepAt, sweepT, toCss, type Rgb } from './gradient';
import type { Action, LockerView, Result, SpotterView, View } from './types';

export default function ColorSweep({ view, send, timer }: PuzzleClientProps<View, Action>) {
  if (view.role === 'reveal') return <Reveal stops={view.stops} result={view.result} />;
  return <Sweeping view={view} send={send} timer={timer} />;
}

function Sweeping({
  view,
  send,
  timer,
}: {
  view: LockerView | SpotterView;
  send: (action: Action) => void;
  timer: { remainingMs: number; totalMs: number };
}) {
  const clock = useRoundClock(timer);
  const live = useRef<HTMLDivElement>(null);
  const { lock, stops } = view;

  // Paint the moving swatch every frame, outside React: it changes far faster than views do.
  useEffect(() => {
    let frame = 0;
    const paint = () => {
      frame = requestAnimationFrame(paint);
      const t = lock ? lock.t : sweepT(clock());
      if (live.current) live.current.style.background = toCss(colorAt(stops, t));
    };
    paint();
    return () => cancelAnimationFrame(frame);
  }, [clock, lock, stops]);

  const { sweep, forward } = sweepAt(timer.totalMs - timer.remainingMs);
  const counter = lock ? 'Locked' : `Sweep ${sweep} of ${view.sweeps} ${forward ? '→' : '←'}`;

  return (
    <div className={styles.root}>
      <p className={styles.hint}>
        {view.role === 'spotter'
          ? 'Tell the Locker when to press. Your messages take 2-8 seconds to arrive, and not always in order.'
          : "Press Lock when the swatch matches your Spotter's colour. One press, five sweeps."}
      </p>
      <p className={styles.counter}>{counter}</p>
      {view.role === 'spotter' ? (
        <div className={styles.pair}>
          <figure>
            <div
              className={styles.swatch}
              style={{ background: toCss(colorAt(stops, view.target)) }}
            />
            <figcaption>Target</figcaption>
          </figure>
          <figure>
            <div ref={live} className={styles.swatch} />
            <figcaption>{lock ? 'Their lock' : 'Now'}</figcaption>
          </figure>
        </div>
      ) : (
        <>
          <div ref={live} className={`${styles.swatch} ${styles.big}`} />
          <button
            className={styles.lock}
            disabled={lock !== null}
            onClick={() => send({ type: 'lock' })}
          >
            {lock ? 'Locked' : 'Lock'}
          </button>
        </>
      )}
      {view.result && <Outcome result={view.result} />}
    </div>
  );
}

function Outcome({ result }: { result: Result }) {
  return (
    <p className={styles.outcome}>
      {result.lockT === null ? 'No lock: no points' : `${result.points} points`}
    </p>
  );
}

function Reveal({ stops, result }: { stops: Rgb[]; result: Result }) {
  const gradient = `linear-gradient(to right, ${stops
    .map((c, i) => `${toCss(c)} ${(i / (stops.length - 1)) * 100}%`)
    .join(', ')})`;
  return (
    <div className={styles.root}>
      <Outcome result={result} />
      <div className={styles.track}>
        <div className={styles.bar} style={{ background: gradient }} />
        <span
          className={`${styles.marker} ${styles.targetMark}`}
          style={{ left: `${result.target * 100}%` }}
        >
          ▼ target
        </span>
        {result.lockT !== null && (
          <span
            className={`${styles.marker} ${styles.lockMark}`}
            style={{ left: `${result.lockT * 100}%` }}
          >
            ▲ lock
          </span>
        )}
      </div>
      <div className={styles.pair}>
        <figure>
          <div
            className={styles.swatch}
            style={{ background: toCss(colorAt(stops, result.target)) }}
          />
          <figcaption>Target</figcaption>
        </figure>
        {result.lockT !== null && (
          <figure>
            <div
              className={styles.swatch}
              style={{ background: toCss(colorAt(stops, result.lockT)) }}
            />
            <figcaption>Locked</figcaption>
          </figure>
        )}
      </div>
    </div>
  );
}
