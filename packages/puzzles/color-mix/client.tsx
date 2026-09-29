import type { PuzzleClientProps } from '@split-signal/shared';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import styles from './client.module.css';
import { toCss } from './color';
import type { Action, Channel, View } from './types';

const CHANNEL_INFO: Record<Channel, { name: string; color: string }> = {
  r: { name: 'Red', color: '#ff5a5f' },
  g: { name: 'Green', color: '#3ddc84' },
  b: { name: 'Blue', color: '#4c9aff' },
};

/** Minimum gap between slider updates sent while dragging. */
const SEND_EVERY_MS = 60;

export default function ColorMix({ view, send, timer }: PuzzleClientProps<View, Action>) {
  // Local values keep dragging smooth; the server's values win whenever we're not dragging.
  const [dragging, setDragging] = useState<Partial<Record<Channel, number>>>({});
  // Throttle: send the first change right away, then at most one update per SEND_EVERY_MS,
  // always ending on the latest value.
  const throttle = useRef<{ timer?: ReturnType<typeof setTimeout>; queued?: Action }>({});
  useEffect(() => {
    const t = throttle.current;
    return () => clearTimeout(t.timer);
  }, []);

  const update = (channel: Channel, value: number, final: boolean) => {
    setDragging((d) => (final ? { ...d, [channel]: undefined } : { ...d, [channel]: value }));
    const t = throttle.current;
    const action: Action = { type: 'set', channel, value };
    if (final) {
      clearTimeout(t.timer);
      t.timer = undefined;
      t.queued = undefined;
      send(action);
      return;
    }
    if (t.timer) {
      t.queued = action;
      return;
    }
    send(action);
    const release = () => {
      if (!t.queued) {
        t.timer = undefined;
        return;
      }
      send(t.queued);
      t.queued = undefined;
      t.timer = setTimeout(release, SEND_EVERY_MS);
    };
    t.timer = setTimeout(release, SEND_EVERY_MS);
  };

  const roundElapsed = timer.totalMs - timer.remainingMs;
  const held = view.holdingSince === null ? 0 : roundElapsed - view.holdingSince;
  const holdProgress = Math.min(1, Math.max(0, held / view.holdMs));

  return (
    <div className={styles.root}>
      <p className={styles.label}>
        {view.role === 'target' ? (
          <>
            <strong>The target.</strong> Only you can see it; you can't see the mix.
          </>
        ) : (
          <>
            <strong>The current mix.</strong> You can't see the target.
          </>
        )}
      </p>
      <div
        className={styles.swatch}
        style={{ backgroundColor: toCss(view.swatch) }}
        role="img"
        aria-label={view.role === 'target' ? 'Target color' : 'Current mix'}
      />

      <div className={styles.sliders}>
        {view.controls.map((channel) => {
          const info = CHANNEL_INFO[channel];
          const value = dragging[channel] ?? view.sliders[channel];
          return (
            <label
              key={channel}
              className={styles.slider}
              style={{ '--channel': info.color } as CSSProperties}
            >
              <span className={styles.name}>{info.name}</span>
              <input
                type="range"
                aria-label={info.name}
                min={0}
                max={view.max}
                value={value}
                disabled={view.solved}
                onChange={(e) => update(channel, Number(e.target.value), false)}
                onPointerUp={(e) => update(channel, Number(e.currentTarget.value), true)}
                onKeyUp={(e) => update(channel, Number(e.currentTarget.value), true)}
              />
              <span className={styles.value}>{value}</span>
            </label>
          );
        })}
      </div>

      {view.solved ? (
        <div className={styles.hold}>Matched!</div>
      ) : (
        view.holdingSince !== null && (
          <div className={styles.hold} role="status">
            It matches! Hold still…
            <div className={styles.holdBar}>
              <div className={styles.holdFill} style={{ width: `${holdProgress * 100}%` }} />
            </div>
          </div>
        )
      )}
    </div>
  );
}
