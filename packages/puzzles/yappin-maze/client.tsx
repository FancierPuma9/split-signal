import type { PuzzleClientProps } from '@split-signal/shared';
import { useEffect, useRef } from 'react';
import { useHoldRepeat } from '../lib/useHoldRepeat';
import styles from './client.module.css';
import type { Dir } from './maze';
import type { Action, View } from './types';

type Props = PuzzleClientProps<View, Action>;

const KEYS: Record<string, Dir> = {
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
const REPEAT_MS = 140;
const BITS = { n: 1, e: 2, s: 4, w: 8 };

/** Draws a maze: walls on closed sides, unseen cells dark, an optional route and markers. */
function MazeSvg({
  size,
  cells,
  pos,
  exit,
  path,
  cellPx = 20,
}: {
  size: number;
  cells: Array<number | null>;
  pos: number;
  exit: number | null;
  path?: number[];
  cellPx?: number;
}) {
  const px = size * cellPx;
  const xy = (cell: number) => [(cell % size) * cellPx, Math.floor(cell / size) * cellPx] as const;
  const walls: string[] = [];
  const fogged: number[] = [];
  cells.forEach((bits, cell) => {
    if (bits === null) {
      fogged.push(cell);
      return;
    }
    const [x, y] = xy(cell);
    if (!(bits & BITS.n)) walls.push(`M${x} ${y}h${cellPx}`);
    if (!(bits & BITS.s)) walls.push(`M${x} ${y + cellPx}h${cellPx}`);
    if (!(bits & BITS.w)) walls.push(`M${x} ${y}v${cellPx}`);
    if (!(bits & BITS.e)) walls.push(`M${x + cellPx} ${y}v${cellPx}`);
  });
  const centre = (cell: number) => {
    const [x, y] = xy(cell);
    return `${x + cellPx / 2} ${y + cellPx / 2}`;
  };
  return (
    <svg viewBox={`-2 -2 ${px + 4} ${px + 4}`} className={styles.maze} aria-hidden="true">
      <rect x="0" y="0" width={px} height={px} fill="#1b1e25" />
      {fogged.map((cell) => {
        const [x, y] = xy(cell);
        return <rect key={cell} x={x} y={y} width={cellPx} height={cellPx} fill="#07080a" />;
      })}
      {path && path.length > 1 && (
        <path
          d={`M${path.map(centre).join('L')}`}
          fill="none"
          stroke="#3ddc84"
          strokeWidth={cellPx * 0.3}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.55}
        />
      )}
      <path d={walls.join('')} stroke="#c9cfdb" strokeWidth={2} strokeLinecap="square" />
      {exit !== null && (
        <text
          x={xy(exit)[0] + cellPx / 2}
          y={xy(exit)[1] + cellPx * 0.72}
          textAnchor="middle"
          fontSize={cellPx * 0.7}
        >
          🚪
        </text>
      )}
      <circle
        cx={xy(pos)[0] + cellPx / 2}
        cy={xy(pos)[1] + cellPx / 2}
        r={cellPx * 0.32}
        fill="#4cc9f0"
        stroke="#06121a"
        strokeWidth={2}
      />
    </svg>
  );
}

export default function YappinMaze({ view, send, team, me }: Props) {
  const partnerName = team.players.find((p) => p.id !== me.id)?.name ?? 'Your partner';
  const hold = useHoldRepeat(REPEAT_MS);
  const move = (dir: Dir) => send({ type: 'move', dir });
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });
  useEffect(() => {
    let last = 0;
    const down = (e: KeyboardEvent) => {
      const dir = KEYS[e.key];
      if (!dir || e.target instanceof HTMLInputElement) return;
      e.preventDefault();
      const now = performance.now();
      if (now - last < REPEAT_MS) return;
      last = now;
      sendRef.current({ type: 'move', dir });
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, []);

  const mine = view.mine;
  return (
    <div className={styles.root}>
      <p className={styles.status}>
        {view.out === 2
          ? 'Both out!'
          : view.me.exited
            ? `You're out. Get ${partnerName} out.`
            : view.partner.exited
              ? `${partnerName} is out. Your turn.`
              : `${view.out} of 2 out`}
      </p>
      <div className={styles.mazes}>
        <figure>
          <figcaption>Your maze{mine ? '' : ' (you only see around you)'}</figcaption>
          {mine ? (
            <MazeSvg
              size={mine.maze.size}
              cells={mine.maze.cells}
              pos={view.me.pos}
              exit={mine.maze.exit}
              path={mine.path}
              cellPx={14}
            />
          ) : (
            <MazeSvg
              size={view.me.maze.size}
              cells={view.me.maze.cells}
              pos={view.me.pos}
              exit={view.me.maze.exit}
              cellPx={14}
            />
          )}
        </figure>
        <figure>
          <figcaption>{partnerName}&apos;s maze, with the way out</figcaption>
          <MazeSvg
            size={view.partner.maze.size}
            cells={view.partner.maze.cells}
            pos={view.partner.pos}
            exit={view.partner.maze.exit}
            path={view.partner.path}
            cellPx={14}
          />
        </figure>
      </div>
      {!mine && (
        <div className={styles.dpad}>
          {(
            [
              ['n', '▲', styles.up],
              ['w', '◀', styles.left],
              ['e', '▶', styles.right],
              ['s', '▼', styles.down],
            ] as const
          ).map(([dir, arrow, cls]) => (
            <button
              key={dir}
              className={`${styles.pad} ${cls}`}
              disabled={view.me.exited}
              aria-label={`Move ${dir}`}
              {...hold(() => move(dir))}
            >
              {arrow}
            </button>
          ))}
        </div>
      )}
      <p className={styles.note}>
        Tell {partnerName} which way to go in their maze while they tell you in yours.
        <span className={styles.keys}> Arrow keys or WASD work too.</span>
      </p>
    </div>
  );
}
