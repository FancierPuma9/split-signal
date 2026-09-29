import type { PuzzleClientProps } from '@split-signal/shared';
import { useEffect, useRef } from 'react';
import { useHoldRepeat } from '../lib/useHoldRepeat';
import styles from './client.module.css';
import type { Action, Dir, NavigatorView, WalkerView, View } from './types';

const TILE = 20;
const FLOOR_NAMES = ['Ground floor', 'First floor', 'Second floor'];
const floorName = (f: number) => FLOOR_NAMES[f] ?? `Floor ${f}`;

const FILL: Record<string, string> = {
  '#': '#14161c',
  '.': '#3a404d',
  ',': '#56607a',
  '+': '#a0714f',
  '^': '#3a404d',
  v: '#3a404d',
  E: '#2e7d4f',
};

export default function Airtime({ view, send }: PuzzleClientProps<View, Action>) {
  return view.role === 'navigator' ? <Navigator view={view} /> : <Walker view={view} send={send} />;
}

function Navigator({ view }: { view: NavigatorView }) {
  return (
    <div className={styles.root}>
      <p className={styles.hint}>
        Guide the Walker to each objective in order, then back to the exit.
        {view.walker ? '' : " You can't see them: ask where they are."}
      </p>
      <div className={styles.floors}>
        {view.floors.map((rows, f) => (
          <figure key={f} className={styles.floor}>
            <figcaption>{floorName(f)}</figcaption>
            <svg
              viewBox={`0 0 ${rows[0]!.length * TILE} ${rows.length * TILE}`}
              role="img"
              aria-label={`Map of the ${floorName(f).toLowerCase()}`}
            >
              {rows.map((row, y) =>
                [...row].map((t, x) => (
                  <rect
                    key={`${x}:${y}`}
                    x={x * TILE}
                    y={y * TILE}
                    width={TILE}
                    height={TILE}
                    fill={FILL[t]}
                  />
                )),
              )}
              {rows.map((row, y) =>
                [...row].map((t, x) =>
                  t === '^' || t === 'v' || t === 'E' ? (
                    <text
                      key={`s${x}:${y}`}
                      x={x * TILE + TILE / 2}
                      y={y * TILE + TILE * 0.72}
                      className={styles.mark}
                    >
                      {t === '^' ? '▲' : t === 'v' ? '▼' : 'EXIT'}
                    </text>
                  ) : null,
                ),
              )}
              {view.rooms
                .filter((r) => r.floor === f)
                .map((r) => (
                  <text
                    key={r.name}
                    x={r.x * TILE + 3}
                    y={r.y * TILE + 9}
                    className={styles.roomName}
                  >
                    {r.name}
                  </text>
                ))}
              {view.objectives.map((o, i) =>
                o.floor === f ? (
                  <g
                    key={i}
                    className={o.done ? styles.done : i === view.current ? styles.current : ''}
                  >
                    <circle cx={o.x * TILE + TILE / 2} cy={o.y * TILE + TILE / 2} r={TILE * 0.42} />
                    <text x={o.x * TILE + TILE / 2} y={o.y * TILE + TILE * 0.68}>
                      {o.done ? '✓' : i + 1}
                    </text>
                  </g>
                ) : null,
              )}
              {view.walker?.floor === f && (
                <circle
                  className={styles.walkerDot}
                  cx={view.walker.x * TILE + TILE / 2}
                  cy={view.walker.y * TILE + TILE / 2}
                  r={TILE * 0.3}
                />
              )}
            </svg>
          </figure>
        ))}
      </div>
      <Objectives items={view.objectives} current={view.current} numbered />
    </div>
  );
}

function Objectives({
  items,
  current,
  numbered,
}: {
  items: Array<{ label: string; done: boolean }>;
  current: number;
  numbered?: boolean;
}) {
  const allDone = current >= items.length;
  return (
    <ol className={styles.objectives}>
      {items.map((o, i) => (
        <li key={i} className={o.done ? styles.doneItem : i === current ? styles.currentItem : ''}>
          {numbered ? `${i + 1}. ` : ''}
          {o.label}
          {o.done && ' ✓'}
        </li>
      ))}
      <li className={allDone ? styles.currentItem : ''}>Get back out</li>
    </ol>
  );
}

const TILE_CLASS: Record<string, string | undefined> = {
  '#': styles.wall,
  '.': styles.corridor,
  ',': styles.roomFloor,
  '+': styles.door,
  '^': styles.corridor,
  v: styles.corridor,
  E: styles.exit,
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
/** Held keys repeat at this pace. */
const REPEAT_MS = 150;

function Walker({ view, send }: { view: WalkerView; send: (action: Action) => void }) {
  const use = (): Action | null =>
    view.canInteract
      ? { type: 'interact' }
      : view.stairs
        ? { type: 'move', dir: view.stairs }
        : null;
  const useAction = use();

  // Keyboard: arrows or WASD to move, E, Enter or Space to use.
  const latest = useRef({ send, useAction });
  useEffect(() => {
    latest.current = { send, useAction };
  });
  useEffect(() => {
    let last = 0;
    const down = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const dir = KEYS[e.key];
      if (dir) {
        e.preventDefault();
        const now = performance.now();
        if (now - last < REPEAT_MS) return;
        last = now;
        latest.current.send({ type: 'move', dir });
      } else if (e.key === 'e' || e.key === 'E' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!e.repeat && latest.current.useAction) latest.current.send(latest.current.useAction);
      }
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, []);

  const move = (dir: Dir) => send({ type: 'move', dir });
  // Held pads repeat at the same pace as held keys.
  const hold = useHoldRepeat(REPEAT_MS);

  return (
    <div className={styles.root}>
      <p className={styles.hint}>
        {floorName(view.floor)}
        {view.floors > 1 ? ` of ${view.floors}` : ''}
        {view.room ? ` · ${view.room}` : ' · corridor'}
      </p>
      <div className={styles.fog} role="img" aria-label="What you can see">
        {view.around.map((row, dy) =>
          [...row].map((t, dx) => {
            const thing = view.things.find((o) => o.dx === dx - 1 && o.dy === dy - 1);
            const centre = dx === 1 && dy === 1;
            return (
              <div key={`${dx}:${dy}`} className={`${styles.cell} ${TILE_CLASS[t] ?? ''}`}>
                {t === '^' && <span className={styles.sign}>▲ stairs up</span>}
                {t === 'v' && <span className={styles.sign}>▼ stairs down</span>}
                {t === 'E' && <span className={styles.sign}>EXIT</span>}
                {thing && (
                  <span className={thing.current ? styles.thingCurrent : styles.thing}>
                    {thing.icon}
                  </span>
                )}
                {centre && <span className={styles.me}>🧍</span>}
              </div>
            );
          }),
        )}
      </div>
      <div className={styles.controls}>
        <div className={styles.dpad}>
          <button
            className={`${styles.pad} ${styles.up}`}
            aria-label="North"
            {...hold(() => move('n'))}
          >
            ▲
          </button>
          <button
            className={`${styles.pad} ${styles.left}`}
            aria-label="West"
            {...hold(() => move('w'))}
          >
            ◀
          </button>
          <button
            className={`${styles.pad} ${styles.right}`}
            aria-label="East"
            {...hold(() => move('e'))}
          >
            ▶
          </button>
          <button
            className={`${styles.pad} ${styles.down}`}
            aria-label="South"
            {...hold(() => move('s'))}
          >
            ▼
          </button>
        </div>
        <button
          className={styles.use}
          disabled={!useAction}
          onClick={() => useAction && send(useAction)}
        >
          {view.canInteract
            ? 'Do it'
            : view.stairs === 'up'
              ? 'Go up'
              : view.stairs === 'down'
                ? 'Go down'
                : 'Use'}
        </button>
      </div>
      <Objectives items={view.objectives} current={view.current} />
    </div>
  );
}
