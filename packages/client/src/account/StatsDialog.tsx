import type { AccountStats, PersonalBest } from '@split-signal/shared';
import { useEffect } from 'react';
import { formatTime } from '../puzzle/useCountdown';

function best(b: PersonalBest): string {
  if (b.fastestMs !== undefined) return `${formatTime(b.fastestMs)} fastest`;
  if (b.fewestMoves !== undefined) {
    return `${b.fewestMoves} ${b.fewestMoves === 1 ? 'move' : 'moves'}`;
  }
  if (b.mostPoints !== undefined) return `${b.mostPoints} pts`;
  return '—';
}

export function StatsDialog({
  name,
  stats,
  onClose,
}: {
  name: string;
  stats: AccountStats | null;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="card overlay-card stats-card"
        role="dialog"
        aria-label="Your stats"
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{name}</h3>
        {!stats ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            <div className="stat-tiles">
              <div>
                <strong>{stats.matchesPlayed}</strong>
                <span>matches</span>
              </div>
              <div>
                <strong>{stats.matchesWon}</strong>
                <span>won</span>
              </div>
              <div>
                <strong>{stats.roundsWon}</strong>
                <span>rounds won</span>
              </div>
            </div>
            {stats.bests.length === 0 ? (
              <p className="muted">
                Finish a match while signed in to start keeping personal bests.
              </p>
            ) : (
              <table className="bests">
                <thead>
                  <tr>
                    <th>Puzzle</th>
                    <th>Best</th>
                    <th>Played</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.bests.map((b) => (
                    <tr key={b.puzzleId}>
                      <td>{b.puzzleName}</td>
                      <td>{best(b)}</td>
                      <td>{b.plays}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        )}
        <p className="small muted">
          Signing in keeps your Google account ID, your name and your match results on this server.
          Nothing else.
        </p>
        <button className="secondary" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
