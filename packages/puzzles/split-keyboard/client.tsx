import type { PuzzleClientProps } from '@split-signal/shared';
import { useEffect, useState } from 'react';
import styles from './client.module.css';
import type { Action, View } from './types';

const ROWS = ['qwertyuiop', "asdfghjkl'", 'zxcvbnm'];
/** Splits a phrase into words, each keeping its trailing spaces and its index in the phrase. */
function words(phrase: string): Array<{ start: number; text: string }> {
  return [...phrase.matchAll(/\S*\s*/g)]
    .filter((m) => m[0] !== '')
    .map((m) => ({ start: m.index, text: m[0] }));
}

/** How long a teammate's nudge stays on screen. */
const NUDGE_MS = 1800;

export default function SplitKeyboard({
  view,
  send,
  signals,
  me,
}: PuzzleClientProps<View, Action>) {
  const mine = new Set(view.myKeys);

  // Physical keyboard: any printable key goes to the server, which decides.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (view.solved || e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      e.preventDefault();
      send({ type: 'key', key: e.key });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [send, view.solved]);

  // A teammate's latest nudge, shown briefly.
  const nudge = signals.incoming.filter((s) => s.signal === 'nudge' && s.from !== me.id).at(-1);
  const [shownNudge, setShownNudge] = useState<number | null>(null);
  useEffect(() => {
    if (!nudge) return;
    const show = setTimeout(() => setShownNudge(nudge.at), 0);
    const hide = setTimeout(() => setShownNudge(null), NUDGE_MS);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [nudge]);

  const error = view.lastError;
  const message = error
    ? error.reason === 'not-yours'
      ? `“${error.key === ' ' ? 'space' : error.key}” isn't one of your keys`
      : `That's not the next letter`
    : null;

  return (
    <div className={styles.root}>
      <p className={styles.progress}>
        Phrase {Math.min(view.phraseIndex + 1, view.phraseCount)} of {view.phraseCount}
      </p>

      {/* Re-keyed on each mistake so the shake replays. */}
      <div key={error?.id ?? 0} className={`${styles.phrase} ${error ? styles.shake : ''}`}>
        {/* Each word (with the space after it) is kept together, so lines break between words. */}
        {words(view.phrase).map((word) => (
          <span key={word.start} className={styles.word}>
            {[...word.text].map((ch, j) => {
              const i = word.start + j;
              const state =
                i < view.typed ? styles.done : i === view.typed ? styles.next : styles.todo;
              // Nothing says whose key is next: working that out is the puzzle.
              return (
                <span
                  key={i}
                  className={`${styles.char} ${state} ${ch === ' ' && i >= view.typed ? styles.space : ''}`}
                >
                  {ch === ' ' ? '·' : ch}
                </span>
              );
            })}
          </span>
        ))}
      </div>

      <p
        className={`${styles.message} ${shownNudge !== null ? styles.nudge : styles.error}`}
        role="status"
      >
        {view.solved
          ? 'Done!'
          : shownNudge !== null
            ? 'Your teammate nudged you: it might be yours!'
            : message}
      </p>

      <div className={styles.keyboard}>
        {ROWS.map((row) => (
          <div key={row} className={styles.row}>
            {[...row].map((key) => (
              <button
                key={key}
                className={`${styles.key} ${mine.has(key) ? styles.owned : ''}`}
                onClick={() => send({ type: 'key', key })}
                disabled={view.solved}
                aria-label={`Key ${key}${mine.has(key) ? ' (yours)' : ''}`}
              >
                {key}
              </button>
            ))}
          </div>
        ))}
        <div className={styles.row}>
          <button
            className={`${styles.key} ${styles.spacebar} ${mine.has(' ') ? styles.owned : ''}`}
            onClick={() => send({ type: 'key', key: ' ' })}
            disabled={view.solved}
            aria-label={`Space${mine.has(' ') ? ' (yours)' : ''}`}
          >
            space
          </button>
        </div>
      </div>
    </div>
  );
}
