import type { PuzzleClientProps } from '@split-signal/shared';
import type { CSSProperties } from 'react';
import styles from './client.module.css';
import type { Dir } from './grid';
import type { Action, Board, Move, View } from './types';

const ARROW: Record<Dir, string> = { up: '↑', down: '↓', left: '←', right: '→' };
const DIRS: Dir[] = ['up', 'left', 'right', 'down'];
const teamColor = (id: string): CSSProperties =>
  ({ '--team': `var(--team-${id}, #9aa1ad)` }) as CSSProperties;

export default function BadAdvice({ view, send, signals, timer }: PuzzleClientProps<View, Action>) {
  const elapsed = timer.totalMs - timer.remainingMs;
  const secondsLeft = Math.max(0, Math.ceil((view.phaseEndsAt - elapsed) / 1000));
  const player = (id: string) => view.players.find((p) => p.id === id)!;
  const mine = view.boards.find((b) => b.playerId === view.me)!;
  const others = view.boards.filter((b) => b.playerId !== view.me);
  const hinting = view.phase === 'hint' && !view.over;
  const moving = view.phase === 'move' && !view.over && !mine.home;

  return (
    <div className={`${styles.root} ${hinting ? styles.hinting : ''}`}>
      <p className={styles.status}>
        Turn {Math.min(view.turn + 1, view.turnCap)} of {view.turnCap} ·{' '}
        {view.over ? 'over' : hinting ? `send hints: ${secondsLeft}s` : `move: ${secondsLeft}s`}
      </p>

      <section className={styles.mine}>
        <h4>You {mine.home ? '· home! Keep hinting.' : '· find your target (you can’t see it)'}</h4>
        <Grid grid={view.grid} board={mine} teamId={view.myTeam} large />
        {view.received && !mine.home && (
          <div className={styles.received} aria-label="Hints you got">
            {view.received.length === 0 ? (
              <span className={styles.muted}>No hints this turn</span>
            ) : (
              view.received.map((d, i) => (
                <span key={i} className={styles.hint}>
                  {ARROW[d]}
                </span>
              ))
            )}
          </div>
        )}
        {moving && (
          <div className={styles.moves}>
            {(['up', 'left', 'right', 'down', 'stay'] as Move[]).map((m) => (
              <button
                key={m}
                className={view.myMove === m ? styles.chosen : styles.move}
                onClick={() => send({ type: 'move', dir: m })}
              >
                {m === 'stay' ? 'Stay' : ARROW[m]}
              </button>
            ))}
          </div>
        )}
      </section>

      <section className={styles.others}>
        {others.map((b) => {
          const p = player(b.playerId);
          const teammate = p.teamId === view.myTeam;
          return (
            <div key={b.playerId} className={styles.other} style={teamColor(p.teamId)}>
              <h5>
                {p.name}
                <span className={styles.tag}>{teammate ? 'partner' : 'opponent'}</span>
                {b.home && <span className={styles.home}>home</span>}
                {view.phase === 'move' && !b.home && view.moved.includes(b.playerId) && ' ✓'}
              </h5>
              <Grid grid={view.grid} board={b} teamId={p.teamId} />
              {hinting && !b.home && (
                <div className={styles.hintPad}>
                  {DIRS.map((d) => (
                    <button
                      key={d}
                      className={`${view.sent[b.playerId] === d ? styles.chosen : styles.move} ${styles[d]}`}
                      aria-label={`Tell ${p.name} ${d}`}
                      onClick={() => signals.send(d, b.playerId)}
                    >
                      {ARROW[d]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </section>
    </div>
  );
}

function Grid({
  grid,
  board,
  teamId,
  large,
}: {
  grid: string[];
  board: Board;
  teamId: string;
  large?: boolean;
}) {
  return (
    <div className={`${styles.grid} ${large ? styles.large : ''}`} style={teamColor(teamId)}>
      {grid.map((row, y) =>
        [...row].map((t, x) => {
          const piece = board.piece.x === x && board.piece.y === y;
          const target = board.target?.x === x && board.target?.y === y;
          return (
            <div key={`${x}:${y}`} className={t === '#' ? styles.wall : styles.cell}>
              {target && <span className={styles.target}>★</span>}
              {piece && <span className={styles.piece} />}
            </div>
          );
        }),
      )}
    </div>
  );
}
