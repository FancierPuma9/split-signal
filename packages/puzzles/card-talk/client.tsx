import type { PuzzleClientProps } from '@split-signal/shared';
import type { CSSProperties } from 'react';
import { CompositeSvg } from '../lib/CompositeSvg';
import styles from './client.module.css';
import type { Action, Claim, KeyMark, View } from './types';

type Props = PuzzleClientProps<View, Action>;

const teamColor = (id: string) => `var(--team-${id}, #9aa1ad)`;

function keyLabel(key: KeyMark | undefined): { text: string; className: string } | null {
  if (key === undefined) return null;
  if (key === 'mine') return { text: '5', className: styles.mine! };
  if (key === 'contested') return { text: '10', className: styles.contested! };
  if (key === 'neutral') return { text: '✕', className: styles.neutral! };
  return { text: '', className: styles.theirs! };
}

function claimLine(claim: Claim, names: Record<string, string>): string {
  const by = names[claim.by] ?? claim.by;
  switch (claim.result) {
    case 'own':
      return `${by} grabbed one of theirs: +5`;
    case 'contested':
      return `${by} grabbed a contested card: +10`;
    case 'neutral':
      return `${by} grabbed a trap: -3`;
    case 'stolen':
      return `${by} grabbed ${names[claim.creditedTo ?? ''] ?? 'another team'}'s card: -3, and +5 to them`;
  }
}

export default function CardTalk({ view, send, timer }: Props) {
  const elapsed = timer.totalMs - timer.remainingMs;
  const coolingFor = view.cooldownUntil === null ? 0 : Math.max(0, view.cooldownUntil - elapsed);
  const claimed = new Map(view.claims.map((c) => [c.card, c]));
  const grabber = view.role === 'grabber';

  return (
    <div className={styles.root}>
      <p className={styles.role}>
        {view.role === 'caller'
          ? 'You’re the Caller: get your Grabber to your cards (5) and the contested ones (10). Every team can hear you.'
          : view.role === 'grabber'
            ? 'You’re the Grabber: listen for your Caller and grab. Wrong grabs cost 3.'
            : 'The key, and every claim.'}
      </p>
      <ul className={styles.scores}>
        {Object.entries(view.scores).map(([team, score]) => (
          <li
            key={team}
            className={team === view.myTeam ? styles.myScore : ''}
            style={{ '--team': teamColor(team) } as CSSProperties}
          >
            {view.teamNames[team] ?? team} <strong>{score}</strong>
          </li>
        ))}
      </ul>
      <div className={styles.board}>
        {view.cards.map((card) => {
          const claim = claimed.get(card.id);
          const key = keyLabel(card.key);
          const owner = typeof card.key === 'object' ? card.key.team : null;
          return (
            <button
              key={card.id}
              className={[styles.card, claim && styles.claimed, key?.className]
                .filter(Boolean)
                .join(' ')}
              style={
                {
                  '--claimer': claim ? teamColor(claim.by) : 'transparent',
                  '--owner': owner ? teamColor(owner) : teamColor(view.myTeam),
                } as CSSProperties
              }
              disabled={!grabber || !!claim || coolingFor > 0}
              onClick={() => send({ type: 'grab', cardId: card.id })}
            >
              <CompositeSvg look={card.look} size={52} />
              {key && key.text && <span className={styles.badge}>{key.text}</span>}
              {claim && (
                <span className={styles.taken}>{view.teamNames[claim.by]?.[0] ?? '·'}</span>
              )}
            </button>
          );
        })}
      </div>
      {grabber && (
        <p className={styles.cooldown} key={view.cooldownUntil ?? 0}>
          {coolingFor > 0 ? <span className={styles.ring} /> : 'Ready to grab'}
        </p>
      )}
      {view.claims.length > 0 && (
        <ol className={styles.feed} reversed>
          {[...view.claims]
            .reverse()
            .slice(0, 5)
            .map((claim) => (
              <li key={claim.card} style={{ '--team': teamColor(claim.by) } as CSSProperties}>
                {claimLine(claim, view.teamNames)}
              </li>
            ))}
        </ol>
      )}
      {view.role === 'caller' && (
        <p className={styles.legend}>
          <span className={styles.mine}>5</span> yours ·{' '}
          <span className={styles.contested}>10</span> contested ·{' '}
          <span className={styles.neutral}>✕</span> trap · coloured edge: another team&apos;s
        </p>
      )}
    </div>
  );
}
