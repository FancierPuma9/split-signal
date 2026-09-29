import type { PuzzleClientProps } from '@split-signal/shared';
import { useEffect, useState, type CSSProperties } from 'react';
import styles from './client.module.css';
import type { Action, Dir, TileView, View } from './types';

const PLAYER_COLORS = ['#f5b041', '#b388ff', '#4dd0e1', '#f48fb1'];
const ARROWS: Record<Dir, string> = { up: '↑', down: '↓', left: '←', right: '→' };
const KEY_DIRS: Record<string, Dir> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

const onTarget = (t: TileView) => t.x === t.targetX && t.y === t.targetY;

export default function SlidingGrid({ view, send, timer }: PuzzleClientProps<View, Action>) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected =
    view.tiles.find((t) => t.id === selectedId) ??
    view.tiles.find((t) => !onTarget(t)) ??
    view.tiles[0];

  const move = (dir: Dir) => {
    if (selected && !view.solved) send({ type: 'move', tileId: selected.id, dir });
  };
  const pass = () => {
    if (!view.solved) send({ type: 'pass' });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.metaKey || e.ctrlKey || e.altKey) return;
      const dir = KEY_DIRS[e.key];
      if (dir && selected && !view.solved) {
        e.preventDefault();
        send({ type: 'move', tileId: selected.id, dir });
      } else if (e.key === ' ' && !view.solved) {
        e.preventDefault();
        send({ type: 'pass' });
      } else {
        const tile = view.tiles.find((t) => t.label.toLowerCase() === e.key.toLowerCase());
        if (tile) setSelectedId(tile.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected, send, view.solved, view.tiles]);

  const cell = view.size <= 4 ? 72 : 60;
  const gap = 6;
  const at = (x: number, y: number) =>
    `translate(calc(${x} * (var(--cell) + var(--gap))), calc(${y} * (var(--cell) + var(--gap))))`;
  const rootStyle = {
    // Shrinks on phones: the board, its gaps and the page padding have to fit the screen.
    '--cell': `min(${cell}px, (100vw - ${60 + gap * (view.size + 1)}px) / ${view.size})`,
    '--gap': `${gap}px`,
    '--player': PLAYER_COLORS[view.colorIndex % PLAYER_COLORS.length],
  } as CSSProperties;

  const roundElapsed = timer.totalMs - timer.remainingMs;
  const turnLeft = Math.max(0, view.turnStartedAt + view.turnMs - roundElapsed);
  const plan = view.myPlan;
  const planText =
    plan === null
      ? 'Pick a tile and a direction, or pass.'
      : plan === 'pass'
        ? 'You are passing this turn.'
        : `You chose ${view.tiles.find((t) => t.id === plan.tileId)?.label ?? '?'} ${ARROWS[plan.dir]}.`;
  const waiting = view.teammates - view.teammatesReady;

  return (
    <div className={styles.root} style={rootStyle}>
      <p className={styles.status}>
        Turn {view.turns + 1} · {planText}
        {waiting > 0 && ` Waiting on ${waiting} teammate${waiting === 1 ? '' : 's'}.`}
      </p>
      <div className={styles.turnBar} aria-label="Time left this turn">
        <div className={styles.turnFill} style={{ width: `${(turnLeft / view.turnMs) * 100}%` }} />
      </div>

      <div
        className={styles.board}
        style={{ gridTemplateColumns: `repeat(${view.size}, var(--cell))` }}
      >
        {Array.from({ length: view.size * view.size }, (_, i) => (
          <div key={i} className={styles.cell} />
        ))}
        {view.tiles.map((t) => (
          <div
            key={`target-${t.id}`}
            className={styles.target}
            style={{ transform: at(t.targetX, t.targetY) }}
          >
            {t.label}
          </div>
        ))}
        {view.tiles.map((t) => {
          const bumped = view.last?.bumped.includes(t.id);
          const planned = plan !== null && plan !== 'pass' && plan.tileId === t.id;
          const classes = [
            styles.tile,
            t.id === selected?.id && styles.selected,
            onTarget(t) && styles.placed,
            bumped && ((view.last?.turn ?? 0) % 2 ? styles.bumpA : styles.bumpB),
          ].filter(Boolean);
          return (
            <button
              key={t.id}
              className={classes.join(' ')}
              style={{ transform: at(t.x, t.y) }}
              onClick={() => setSelectedId(t.id)}
              aria-label={`Tile ${t.label}${onTarget(t) ? ', on target' : ''}`}
            >
              {t.label}
              {planned && <span className={styles.planned}>{ARROWS[plan.dir]}</span>}
            </button>
          );
        })}
      </div>

      <div className={styles.controls}>
        {(Object.keys(ARROWS) as Dir[]).map((dir) => (
          <button
            key={dir}
            className={`secondary ${styles[dir]}`}
            onClick={() => move(dir)}
            disabled={view.solved}
            aria-label={`Move ${selected?.label ?? ''} ${dir}`}
          >
            {ARROWS[dir]}
          </button>
        ))}
      </div>
      <button className="secondary" onClick={pass} disabled={view.solved}>
        Pass
      </button>
      <p className={styles.hint}>
        Tap a tile, then an arrow.
        <span className={styles.keys}>
          {' '}
          Or use the keyboard: letters pick a tile, arrow keys move it, space passes.
        </span>{' '}
        Tiles you bump into belong to your teammates.
      </p>
    </div>
  );
}
