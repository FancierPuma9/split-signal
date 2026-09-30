import type { ClipDelivery, PuzzleClientProps } from '@split-signal/shared';
import { useRef, useState } from 'react';
import { playClip, type Playback } from '../lib/audio';
import { CompositeSvg } from '../lib/CompositeSvg';
import styles from './client.module.css';
import type { Action, Item, View } from './types';

type Props = PuzzleClientProps<View, Action>;

export default function Overdraft({ view, send, clips, team, me }: Props) {
  const nameOf = (id: string) => team.players.find((p) => p.id === id)?.name ?? 'someone';
  const [confirming, setConfirming] = useState(false);
  if (view.result) return <Result view={view} nameOf={nameOf} meId={me.id} />;

  const picked = new Set(view.picked);
  const byOwner = new Map<string, typeof view.holding>();
  for (const h of view.holding) byOwner.set(h.owner, [...(byOwner.get(h.owner) ?? []), h]);

  return (
    <div className={styles.root}>
      <section className={styles.panel}>
        <h4>Your board</h4>
        <p className={styles.note}>
          Your teammates know which of these to pick. You don&apos;t know how many.
        </p>
        <div className={styles.board}>
          {view.board.map((item) => (
            <button
              key={item.id}
              className={`${styles.item} ${picked.has(item.id) ? styles.picked : ''}`}
              disabled={view.submitted}
              onClick={() => send({ type: 'toggle', itemId: item.id })}
              aria-pressed={picked.has(item.id)}
            >
              <CompositeSvg look={item.look} size={56} />
              {picked.has(item.id) && <span className={styles.check}>✓</span>}
            </button>
          ))}
        </div>
        {view.submitted ? (
          <p className={styles.done}>Submitted.</p>
        ) : confirming ? (
          <div className={styles.actions}>
            <button onClick={() => send({ type: 'submit' })}>Yes, lock my picks</button>
            <button className="link" onClick={() => setConfirming(false)}>
              Not yet
            </button>
          </div>
        ) : (
          <button className={styles.submit} onClick={() => setConfirming(true)}>
            Submit my picks
          </button>
        )}
        <p className={styles.note}>
          {view.teammatesDone.length === 0
            ? 'Nobody else has submitted.'
            : `${view.teammatesDone.map(nameOf).join(' and ')} submitted.`}
        </p>
      </section>

      <section className={styles.panel}>
        <h4>Answers you hold</h4>
        {view.holding.length === 0 ? (
          <p className={styles.note}>None. Listen for your own.</p>
        ) : (
          [...byOwner].map(([owner, items]) => (
            <div key={owner} className={styles.holding}>
              <span>On {nameOf(owner)}&apos;s board:</span>
              <div className={styles.row}>
                {items.map((h, i) => (
                  <CompositeSvg key={i} look={h.look} size={48} />
                ))}
              </div>
            </div>
          ))
        )}
        <p className={styles.note}>
          Every clip goes to both teammates, so say whose board it&apos;s for.
        </p>
      </section>

      {clips && clips.incoming.length > 0 && <Heard clips={clips.incoming} nameOf={nameOf} />}
    </div>
  );
}

/** Clips you've been sent, to hear again (replays are free; only sending costs). */
function Heard({ clips, nameOf }: { clips: ClipDelivery[]; nameOf: (id: string) => string }) {
  const current = useRef<Playback | null>(null);
  const play = async (clip: ClipDelivery) => {
    current.current?.stop();
    current.current = await playClip(clip);
  };
  return (
    <section className={styles.panel}>
      <h4>Heard</h4>
      <ol className={styles.heard} reversed>
        {[...clips].reverse().map((clip) => (
          <li key={clip.id}>
            <span>{nameOf(clip.from)}</span>
            <button className="secondary" onClick={() => void play(clip).catch(() => {})}>
              ▶ Again
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function Result({
  view,
  nameOf,
  meId,
}: {
  view: View;
  nameOf: (id: string) => string;
  meId: string;
}) {
  const result = view.result!;
  const correct = new Set(result.correct);
  const board = (owner: string, items: Item[]) => {
    const picks = new Set(result.picks[owner] ?? []);
    return (
      <div key={owner} className={styles.holding}>
        <span>{owner === meId ? 'Your board' : `${nameOf(owner)}'s board`}</span>
        <div className={styles.row}>
          {items.map((item) => (
            <span
              key={item.id}
              className={[
                styles.item,
                correct.has(item.id) && styles.answer,
                picks.has(item.id) && styles.picked,
              ]
                .filter(Boolean)
                .join(' ')}
            >
              <CompositeSvg look={item.look} size={40} />
              {picks.has(item.id) && (
                <span className={styles.check}>{correct.has(item.id) ? '✓' : '✗'}</span>
              )}
            </span>
          ))}
        </div>
      </div>
    );
  };
  return (
    <div className={styles.root}>
      <p className={styles.score}>
        <strong>{result.points}</strong> points: {result.tally.correct} right, {result.tally.missed}{' '}
        missed, {result.tally.surplus} extra (of {result.quota} answers)
      </p>
      {Object.entries(result.boards).map(([owner, items]) => board(owner, items))}
      <p className={styles.note}>Green outline: an answer. ✓/✗: what was picked.</p>
    </div>
  );
}
