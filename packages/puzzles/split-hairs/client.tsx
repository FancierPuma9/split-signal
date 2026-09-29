import type { PuzzleClientProps } from '@split-signal/shared';
import { FadingCanvas } from '../lib/FadingCanvas';
import styles from './client.module.css';
import type { Action, DrawerView, GuesserView, RevealView, View } from './types';

type Draw = NonNullable<PuzzleClientProps<View, Action>['draw']>;

const pictureSrc = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export default function SplitHairs({ view, send, draw, timer }: PuzzleClientProps<View, Action>) {
  if (view.role === 'reveal') return <Reveal view={view} />;
  if (!draw) return null;
  // Round time now, from the shell's countdown (the server enforces lockouts either way).
  const elapsed = timer.totalMs - timer.remainingMs;
  const lockedFor = view.lockedUntil === null ? 0 : Math.max(0, view.lockedUntil - elapsed);
  return view.role === 'drawer' ? (
    <Drawer view={view} draw={draw} lockedFor={lockedFor} />
  ) : (
    <Guesser view={view} draw={draw} lockedFor={lockedFor} send={send} />
  );
}

function Drawer({ view, draw, lockedFor }: { view: DrawerView; draw: Draw; lockedFor: number }) {
  return (
    <div className={styles.root}>
      <div className={styles.drawerLayout}>
        <figure className={styles.pictureCard}>
          <img src={pictureSrc(view.picture)} alt="The picture to get across" />
          <figcaption>Get this across. You don't know the word either.</figcaption>
        </figure>
        <FadingCanvas canDraw draw={draw} className={styles.stage} />
      </div>
      {lockedFor > 0 ? (
        <p key={view.wrongCount} className={styles.wrongFlash} role="status">
          Wrong guess! They're locked out for {Math.ceil(lockedFor / 1000)}s
        </p>
      ) : (
        <p className={styles.hint}>
          {view.wrongCount === 0
            ? 'Your ink fades after a second. Keep drawing.'
            : `${view.wrongCount} wrong ${view.wrongCount === 1 ? 'guess' : 'guesses'} so far`}
        </p>
      )}
    </div>
  );
}

function Guesser({
  view,
  draw,
  lockedFor,
  send,
}: {
  view: GuesserView;
  draw: Draw;
  lockedFor: number;
  send: (action: Action) => void;
}) {
  const locked = lockedFor > 0;
  return (
    <div className={styles.root}>
      <FadingCanvas canDraw={false} draw={draw} className={styles.stage} />
      <p className={locked ? styles.lockout : styles.hint} role="status">
        {locked
          ? `Locked out: ${Math.ceil(lockedFor / 1000)}s`
          : 'Which word are they drawing? Wrong guesses lock you out.'}
      </p>
      <div className={styles.words}>
        {view.words.map((word) => {
          const tried = view.wrong.includes(word);
          return (
            <button
              key={word}
              className={tried ? styles.tried : styles.word}
              disabled={tried || locked || view.solved}
              onClick={() => send({ type: 'guess', word })}
            >
              {word}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Reveal({ view }: { view: RevealView }) {
  return (
    <div className={styles.root}>
      <h3 className={styles.answer}>
        The word was <strong>{view.word}</strong>
      </h3>
      <div className={styles.revealLayout}>
        <figure className={styles.pictureCard}>
          <img src={pictureSrc(view.picture)} alt={`A picture of "${view.word}"`} />
          <figcaption>What the Drawer saw</figcaption>
        </figure>
        <ul className={styles.revealWords}>
          {view.words.map((word) => (
            <li
              key={word}
              className={
                word === view.word ? styles.target : view.wrong.includes(word) ? styles.tried : ''
              }
            >
              {word}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
