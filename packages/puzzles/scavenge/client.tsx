import type { PuzzleClientProps } from '@split-signal/shared';
import { CompositeSvg } from '../lib/CompositeSvg';
import styles from './client.module.css';
import type { Action, Part, Resolution, View } from './types';

type Props = PuzzleClientProps<View, Action>;

const teamColor = (id: string) => `var(--team-${id}, #9aa1ad)`;

function Countdown({ view, elapsed }: { view: View; elapsed: number }) {
  const left = Math.max(0, view.nextTickAt - elapsed);
  return (
    <p className={styles.tick}>
      Grabs land in <strong>{Math.ceil(left / 1000)}s</strong> · {view.grabsLeft[view.myTeam] ?? 0}{' '}
      grabs left
    </p>
  );
}

function LastGrab({ last, view }: { last: Resolution | null; view: View }) {
  if (!last) return null;
  const mine = last.results[view.myTeam];
  const text =
    !mine || mine.outcome === 'pass'
      ? 'Last grab: you passed.'
      : mine.outcome === 'got'
        ? 'Last grab: you got it!'
        : `Last grab: contested, nobody got it.`;
  return <p className={styles.note}>{text}</p>;
}

function Trays({ view }: { view: View }) {
  return (
    <section className={styles.trays}>
      {Object.entries(view.trays).map(([team, parts]) => (
        <div key={team} className={styles.tray} style={{ borderColor: teamColor(team) }}>
          <span>
            {view.teamNames[team] ?? team}
            {team === view.myTeam ? ' (you)' : ''}: {parts.length}
          </span>
          <div className={styles.row}>
            {parts.map((p) => (
              <CompositeSvg key={p.id} look={p.look} size={26} />
            ))}
          </div>
        </div>
      ))}
    </section>
  );
}

export default function Scavenge({ view, send, timer }: Props) {
  const elapsed = timer.totalMs - timer.remainingMs;
  const have = new Set(view.tray.map((p) => p.id));

  if (view.role === 'reveal') {
    return (
      <div className={styles.root}>
        {Object.entries(view.schematics).map(([team, parts]) => {
          const tray = new Set(view.trays[team]?.map((p) => p.id));
          return (
            <div key={team} className={styles.tray} style={{ borderColor: teamColor(team) }}>
              <span>{view.teamNames[team] ?? team} needed:</span>
              <div className={styles.row}>
                {parts.map((p) => (
                  <span key={p.id} className={tray.has(p.id) ? styles.got : styles.missing}>
                    <CompositeSvg look={p.look} size={32} />
                  </span>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <p className={styles.role}>
        {view.role === 'reader'
          ? 'You’re the Reader: describe the exact parts on your schematic. Your Grabber sees the bin.'
          : 'You’re the Grabber: pick what your Reader describes. Grabs land together every 5s; a part two teams pick stays in the bin.'}
      </p>
      <Countdown view={view} elapsed={elapsed} />
      <LastGrab last={view.last} view={view} />
      {view.role === 'reader' ? (
        <section className={styles.panel}>
          <h4>Your schematic: {view.schematic.filter((p) => have.has(p.id)).length} of 8</h4>
          <div className={styles.grid}>
            {view.schematic.map((p) => (
              <span key={p.id} className={`${styles.part} ${have.has(p.id) ? styles.got : ''}`}>
                <CompositeSvg look={p.look} size={52} />
                {have.has(p.id) && <span className={styles.check}>✓</span>}
              </span>
            ))}
          </div>
        </section>
      ) : (
        <section className={styles.panel}>
          <h4>The bin</h4>
          <div className={styles.bin}>
            {view.bin.map((p: Part) => {
              const picked = view.hover.part === p.id;
              return (
                <button
                  key={p.id}
                  className={`${styles.part} ${picked ? styles.picked : ''}`}
                  disabled={view.hover.committed}
                  onClick={() => send({ type: 'hover', partId: picked ? null : p.id })}
                  aria-pressed={picked}
                >
                  <CompositeSvg look={p.look} size={44} />
                </button>
              );
            })}
          </div>
          <div className={styles.actions}>
            <button
              disabled={view.hover.part === null || view.hover.committed}
              onClick={() => send({ type: 'commit' })}
            >
              {view.hover.committed ? 'Committed' : 'Commit'}
            </button>
            <span className={styles.note}>
              {view.hover.part === null
                ? 'Nothing picked: you’ll pass.'
                : 'Picked. It grabs when the timer runs out.'}
            </span>
          </div>
        </section>
      )}
      <Trays view={view} />
    </div>
  );
}
