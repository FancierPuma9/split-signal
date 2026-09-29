import type { PuzzleClientProps } from '@split-signal/shared';
import { useEffect, useRef, type CSSProperties } from 'react';
import styles from './client.module.css';
import { playBuzz, playChime } from './sounds';
import type { Action, TurnRecord, View } from './types';

const SEAT_COLORS = ['#f5b041', '#b388ff', '#4dd0e1', '#f48fb1'];

const describeMoves = (record: TurnRecord) =>
  record.moved.length === 0
    ? 'Everyone held'
    : record.moved.map((m) => `dial ${m.dial + 1} → ${m.to}`).join(', ');

export default function Padlock({ view, send, timer }: PuzzleClientProps<View, Action>) {
  const last = view.history.at(-1);

  // Play the feedback sound once per resolved turn. The first render only records where we are,
  // so rejoining mid-round doesn't replay an old sound.
  const heard = useRef(last?.turn ?? 0);
  useEffect(() => {
    if (!last || last.turn <= heard.current) return;
    heard.current = last.turn;
    if (last.sound === 'chime') playChime();
    else if (last.sound === 'buzz') playBuzz();
  }, [last]);

  const roundElapsed = timer.totalMs - timer.remainingMs;
  const turnLeft = Math.max(0, view.turnStartedAt + view.turnMs - roundElapsed);
  const choice = view.myChoice;
  const waiting = view.teammates - view.teammatesReady;
  const choiceText =
    choice === null
      ? 'Turn one of your dials, or hold.'
      : choice === 'hold'
        ? 'You are holding.'
        : `You're turning dial ${choice.dial + 1} ${choice.dir > 0 ? 'up' : 'down'}.`;
  const movedLast = new Set(last?.moved.map((m) => m.dial));

  return (
    <div className={styles.root}>
      <p className={styles.status}>
        {view.open ? (
          <strong>Unlocked in {view.turns} turns!</strong>
        ) : (
          <>
            Turn {view.turns + 1} · {choiceText}
            {waiting > 0 && ` Waiting on ${waiting} teammate${waiting === 1 ? '' : 's'}.`}
          </>
        )}
      </p>
      {!view.open && (
        <div className={styles.turnBar} aria-label="Time left this turn">
          <div
            className={styles.turnFill}
            style={{ width: `${(turnLeft / view.turnMs) * 100}%` }}
          />
        </div>
      )}

      <div className={`${styles.lock} ${view.open ? styles.open : ''}`}>
        {view.dials.map((value, dial) => {
          const mine = view.mine.includes(dial);
          const chosen = choice !== null && choice !== 'hold' && choice.dial === dial;
          const classes = [
            styles.dial,
            chosen && styles.chosen,
            movedLast.has(dial) && styles.moved,
          ].filter(Boolean);
          const owner = {
            '--owner': SEAT_COLORS[(view.dialSeats[dial] ?? 0) % 4],
          } as CSSProperties;
          return (
            <div key={dial} className={classes.join(' ')} style={owner}>
              {mine ? (
                <button
                  className="secondary"
                  aria-label={`Turn dial ${dial + 1} up`}
                  disabled={view.open}
                  onClick={() => send({ type: 'turn', dial, dir: 1 })}
                >
                  ▲
                </button>
              ) : (
                <div className={styles.spacer} />
              )}
              {/* Keyed by value so the roll animation replays when it changes. */}
              <div
                key={`${dial}-${value}`}
                className={styles.digit}
                aria-label={`Dial ${dial + 1}`}
              >
                {value}
              </div>
              {mine ? (
                <button
                  className="secondary"
                  aria-label={`Turn dial ${dial + 1} down`}
                  disabled={view.open}
                  onClick={() => send({ type: 'turn', dial, dir: -1 })}
                >
                  ▼
                </button>
              ) : (
                <div className={styles.spacer} />
              )}
            </div>
          );
        })}
      </div>

      <button className="secondary" onClick={() => send({ type: 'hold' })} disabled={view.open}>
        Hold
      </button>

      {/* Shown as text too, for anyone playing without sound. */}
      <p
        key={last?.turn}
        className={`${styles.flash} ${last?.sound === 'chime' ? styles.chime : styles.buzz}`}
        role="status"
      >
        {last?.sound === 'chime' ? '🔔 Chime!' : last?.sound === 'buzz' ? 'Bzzt.' : ''}
      </p>

      {view.history.length > 0 && (
        <ol className={styles.history} aria-label="Turn history">
          {[...view.history].reverse().map((record) => (
            <li key={record.turn}>
              <span>
                Turn {record.turn}: {describeMoves(record)}
              </span>
              <strong>
                {record.sound === 'chime' ? '🔔' : record.sound === 'buzz' ? 'bzzt' : '·'}
              </strong>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
