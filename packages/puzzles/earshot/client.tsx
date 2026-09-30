import type { PuzzleClientProps } from '@split-signal/shared';
import { useEffect, useMemo, useRef } from 'react';
import { distancesFrom, type Dir, type Maze } from '../lib/maze';
import { useHoldRepeat } from '../lib/useHoldRepeat';
import styles from './client.module.css';
import type { Action, Catch, GhostMark, HunterMark, HunterView, View } from './types';

type Props = PuzzleClientProps<View, Action>;

const CELL = 20;
const BITS = { n: 1, e: 2, s: 4, w: 8 };
const teamColor = (id: string) => `var(--team-${id}, #9aa1ad)`;
const ROTATE: Record<Dir, number> = { n: 0, e: 90, s: 180, w: 270 };

function Board({
  size,
  cells,
  shade = [],
  lit = [],
  hunters,
  ghosts,
  me,
}: {
  size: number;
  cells: Array<number | null>;
  shade?: number[];
  lit?: number[];
  hunters: HunterMark[];
  ghosts: GhostMark[];
  me: number;
}) {
  const px = size * CELL;
  const xy = (cell: number) => [(cell % size) * CELL, Math.floor(cell / size) * CELL] as const;
  const walls: string[] = [];
  cells.forEach((bits, cell) => {
    if (bits === null) return;
    const [x, y] = xy(cell);
    if (!(bits & BITS.n)) walls.push(`M${x} ${y}h${CELL}`);
    if (!(bits & BITS.s)) walls.push(`M${x} ${y + CELL}h${CELL}`);
    if (!(bits & BITS.w)) walls.push(`M${x} ${y}v${CELL}`);
    if (!(bits & BITS.e)) walls.push(`M${x + CELL} ${y}v${CELL}`);
  });
  return (
    <svg viewBox={`-2 -2 ${px + 4} ${px + 4}`} className={styles.board} aria-hidden="true">
      <rect width={px} height={px} fill="#1b1e25" />
      {cells.map((bits, cell) => {
        if (bits !== null) return null;
        const [x, y] = xy(cell);
        return <rect key={cell} x={x} y={y} width={CELL} height={CELL} fill="#07080a" />;
      })}
      {shade.map((cell) => {
        const [x, y] = xy(cell);
        return (
          <rect
            key={`s${cell}`}
            x={x}
            y={y}
            width={CELL}
            height={CELL}
            fill="#4cc9f0"
            opacity="0.14"
          />
        );
      })}
      {lit.map((cell) => {
        const [x, y] = xy(cell);
        return (
          <rect
            key={`l${cell}`}
            x={x}
            y={y}
            width={CELL}
            height={CELL}
            fill="#ffe08a"
            opacity="0.45"
          />
        );
      })}
      <path d={walls.join('')} stroke="#c9cfdb" strokeWidth={2} strokeLinecap="square" />
      {ghosts.map((g) => {
        const [x, y] = xy(g.pos);
        return (
          <g key={`g${g.team}`} opacity={g.muted ? 0.4 : 1}>
            <circle
              cx={x + CELL / 2}
              cy={y + CELL / 2}
              r={CELL * 0.42}
              fill="none"
              stroke={teamColor(g.team)}
              strokeWidth={2.5}
            />
            <text x={x + CELL / 2} y={y + CELL * 0.72} textAnchor="middle" fontSize={CELL * 0.6}>
              👻
            </text>
          </g>
        );
      })}
      {hunters.map((h) => {
        const [x, y] = xy(h.pos);
        return (
          <g
            key={`h${h.team}`}
            transform={`translate(${x + CELL / 2} ${y + CELL / 2}) rotate(${ROTATE[h.facing]})`}
          >
            <path
              d={`M0 ${-CELL * 0.38}L${CELL * 0.3} ${CELL * 0.3}L${-CELL * 0.3} ${CELL * 0.3}Z`}
              fill={teamColor(h.team)}
              stroke={h.pos === me ? '#fff' : '#06121a'}
              strokeWidth={h.pos === me ? 2 : 1}
            />
          </g>
        );
      })}
    </svg>
  );
}

function Scores({ view }: { view: View }) {
  return (
    <ul className={styles.scores}>
      {Object.entries(view.scores).map(([team, score]) => (
        <li
          key={team}
          style={{ borderColor: teamColor(team) }}
          className={team === view.myTeam ? styles.mine : ''}
        >
          {view.teamNames[team] ?? team} <strong>{score}</strong>
        </li>
      ))}
    </ul>
  );
}

function catchLine(c: Catch, names: Record<string, string>) {
  const by = names[c.by] ?? c.by;
  return c.own
    ? `${by} caught their ghost: +5`
    : `${by} caught ${names[c.ghostTeam] ?? 'an enemy'}'s ghost: +3, and muted it`;
}

export default function Earshot(props: Props) {
  const { view } = props;
  return (
    <div className={styles.root}>
      <Scores view={view} />
      {view.role === 'ghost' && (
        <GhostPanel view={view} elapsed={props.timer.totalMs - props.timer.remainingMs} />
      )}
      {view.role === 'hunter' && (
        <HunterPanel
          view={view}
          send={props.send}
          elapsed={props.timer.totalMs - props.timer.remainingMs}
        />
      )}
      {view.role === 'reveal' && (
        <Board
          size={view.maze.size}
          cells={view.maze.cells}
          hunters={view.hunters}
          ghosts={view.ghosts}
          me={-1}
        />
      )}
      {view.catches.length > 0 && (
        <ol className={styles.feed} reversed>
          {[...view.catches].reverse().map((c) => (
            <li key={c.at} style={{ borderColor: teamColor(c.by) }}>
              {catchLine(c, view.teamNames)}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function GhostPanel({
  view,
  elapsed,
}: {
  view: Extract<View, { role: 'ghost' }>;
  elapsed: number;
}) {
  // Everywhere within earshot, by path: what the hunters would need to reach to hear you.
  const shade = useMemo(() => {
    const dist = distancesFrom(view.maze as Maze, view.me.pos);
    return dist.map((d, cell) => (d <= view.me.radius ? cell : -1)).filter((c) => c >= 0);
  }, [view.maze, view.me.pos, view.me.radius]);
  const mutedFor = view.me.mutedUntil === null ? 0 : Math.max(0, view.me.mutedUntil - elapsed);
  return (
    <>
      <p className={styles.role}>
        You&apos;re the <strong>Ghost</strong>. You drift on your own; all you control is how loud
        you talk. Louder carries farther, to every team&apos;s hunter.
      </p>
      <Board
        size={view.maze.size}
        cells={view.maze.cells}
        shade={mutedFor > 0 ? [] : shade}
        hunters={view.hunters}
        ghosts={view.ghosts}
        me={view.me.pos}
      />
      <p className={styles.note}>
        {mutedFor > 0
          ? `Caught by an enemy: muted for ${Math.ceil(mutedFor / 1000)}s`
          : `Heard ${view.me.radius.toFixed(1)} tiles away (shaded)`}
      </p>
    </>
  );
}

function HunterPanel({
  view,
  send,
  elapsed,
}: {
  view: HunterView;
  send: Props['send'];
  elapsed: number;
}) {
  const hold = useHoldRepeat(160);
  const sendRef = useRef(send);
  useEffect(() => {
    sendRef.current = send;
  });
  useEffect(() => {
    const keys: Record<string, Dir> = {
      ArrowUp: 'n',
      ArrowDown: 's',
      ArrowLeft: 'w',
      ArrowRight: 'e',
      w: 'n',
      s: 's',
      a: 'w',
      d: 'e',
    };
    const down = (e: KeyboardEvent) => {
      const dir = keys[e.key] ?? keys[e.key.toLowerCase()];
      if (dir) {
        e.preventDefault();
        sendRef.current({ type: 'move', dir });
      } else if (e.key === 'f' || e.key === 'F') {
        if (!e.repeat) sendRef.current({ type: 'flashlight' });
      } else if (e.key === ' ') {
        e.preventDefault();
        if (!e.repeat) sendRef.current({ type: 'catch' });
      }
    };
    window.addEventListener('keydown', down);
    return () => window.removeEventListener('keydown', down);
  }, []);

  const recharging = Math.max(0, view.me.catchReadyAt - elapsed);
  const mine = {
    team: view.myTeam,
    pos: view.me.pos,
    facing: view.me.facing,
    light: view.me.light,
  };
  return (
    <>
      <p className={styles.role}>
        You&apos;re the <strong>Hunter</strong>. Find your ghost by ear (louder is closer), then
        light it up and catch it. Enemy ghosts are worth catching too.
      </p>
      <Board
        size={view.maze.size}
        cells={view.maze.cells}
        lit={view.lit}
        hunters={[...view.hunters, mine]}
        ghosts={view.seen}
        me={view.me.pos}
      />
      <div className={styles.battery} aria-label="Flashlight battery">
        <span style={{ width: `${view.me.battery}%` }} />
      </div>
      <div className={styles.controls}>
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
              aria-label={`Move ${dir}`}
              {...hold(() => send({ type: 'move', dir }))}
            >
              {arrow}
            </button>
          ))}
        </div>
        <div className={styles.actions}>
          <button
            className={view.me.light ? styles.lightOn : 'secondary'}
            onClick={() => send({ type: 'flashlight' })}
          >
            🔦 {view.me.light ? 'Light off' : 'Light on'}
            <span className={styles.keys}> (F)</span>
          </button>
          <button disabled={recharging > 0} onClick={() => send({ type: 'catch' })}>
            {recharging > 0 ? `Catch in ${(recharging / 1000).toFixed(1)}s` : 'Catch!'}
            <span className={styles.keys}> (Space)</span>
          </button>
        </div>
      </div>
      <p className={styles.note}>Walking into a wall turns you, to aim the light.</p>
    </>
  );
}
