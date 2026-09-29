import type { PuzzleClientProps } from '@split-signal/shared';
import type { CSSProperties } from 'react';
import styles from './client.module.css';
import { hunterOf, preyOf } from './scoring';
import type { Action, View } from './types';

const teamColor = (id: string): CSSProperties =>
  ({ '--team': `var(--team-${id}, #9aa1ad)` }) as CSSProperties;

export default function PickSix({ view, send, timer }: PuzzleClientProps<View, Action>) {
  const elapsed = timer.totalMs - timer.remainingMs;
  const secondsLeft = Math.max(0, Math.ceil((view.phaseEndsAt - elapsed) / 1000));
  const nameOf = (id: string) => view.players.find((p) => p.id === id)?.name ?? id;
  const picking = view.phase === 'pick' && !view.over;

  return (
    <div className={styles.root}>
      <p className={styles.status}>
        {view.over
          ? 'Final turn'
          : picking
            ? `Turn ${view.turn + 1} of ${view.turns} · pick in ${secondsLeft}s`
            : // turn counts resolved turns, so during a reveal it's the one just played.
              `Turn ${view.turn} of ${view.turns} · revealed`}
      </p>

      <div className={styles.numbers}>
        {[1, 2, 3, 4, 5, 6].map((n) => {
          const prey = preyOf(n);
          const hunter = hunterOf(n);
          return (
            <button
              key={n}
              className={[styles.number, view.myPick === n && styles.chosen]
                .filter(Boolean)
                .join(' ')}
              disabled={!picking}
              onClick={() => send({ type: 'pick', n })}
            >
              <span className={styles.face}>{n}</span>
              <small>{prey ? `hunts ${prey}` : `fears ${hunter}`}</small>
            </button>
          );
        })}
      </div>

      {picking && (
        <ul className={styles.picked} aria-label="Who has picked">
          {view.players.map((p) => (
            <li
              key={p.id}
              style={teamColor(p.teamId)}
              className={view.picked.includes(p.id) ? styles.in : ''}
            >
              {p.name} {view.picked.includes(p.id) ? '✓' : '…'}
            </li>
          ))}
        </ul>
      )}

      {view.last && (
        <section className={styles.last}>
          <h4>Last turn</h4>
          <div className={styles.teams}>
            {view.teams.map((t) => (
              <div key={t.id} className={styles.team} style={teamColor(t.id)}>
                <strong>
                  {t.name} +{view.last!.teams[t.id] ?? 0}
                </strong>
                {view.players
                  .filter((p) => p.teamId === t.id)
                  .map((p) => {
                    const pick = view.last!.picks[p.id];
                    const scored = view.last!.players[p.id] ?? 0;
                    return (
                      <span key={p.id} className={styles.row}>
                        {nameOf(p.id)}: <b>{pick ?? '–'}</b>
                        <span className={scored === 0 && pick ? styles.zeroed : styles.scored}>
                          {pick ? ` → ${scored}` : ''}
                        </span>
                      </span>
                    );
                  })}
              </div>
            ))}
          </div>
        </section>
      )}

      <div className={styles.totals}>
        {view.teams.map((t) => (
          <div key={t.id} className={styles.total} style={teamColor(t.id)}>
            <span>
              {t.name}
              {t.id === view.myTeam ? ' (you)' : ''}
            </span>
            <strong>{view.totals[t.id] ?? 0}</strong>
          </div>
        ))}
      </div>
    </div>
  );
}
