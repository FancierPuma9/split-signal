import type { PuzzleClientProps } from '@split-signal/shared';
import { useEffect, useRef, useState } from 'react';
import styles from './client.module.css';
import { playMelody } from './synth';
import { NOTE_MS, type Action, type View } from './types';

type Props = PuzzleClientProps<View, Action>;
type RoleProps<R extends View['role']> = Omit<Props, 'view'> & {
  view: Extract<View, { role: R }>;
};

export default function MelodySort({ view, ...rest }: Props) {
  return view.role === 'listener' ? (
    <Listener view={view} {...rest} />
  ) : (
    <Arranger view={view} {...rest} />
  );
}

/**
 * Plays `pitches` whenever `id` goes up. The first render only records the current id, so
 * rejoining mid-round doesn't replay something already heard. Returns which note is sounding.
 */
function usePlayOnChange(id: number, pitches: readonly number[] | undefined): number | null {
  const heard = useRef(id);
  const [active, setActive] = useState<number | null>(null);
  useEffect(() => {
    if (id <= heard.current || !pitches) return;
    heard.current = id;
    playMelody(pitches, NOTE_MS);
    const timers = pitches.map((_, i) => setTimeout(() => setActive(i), i * NOTE_MS));
    timers.push(setTimeout(() => setActive(null), pitches.length * NOTE_MS));
    return () => timers.forEach(clearTimeout);
  }, [id, pitches]);
  return active;
}

function Wave({ count, active }: { count: number; active: number | null }) {
  return (
    <div className={styles.wave} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className={`${styles.bar} ${active === i ? styles.lit : ''}`}
          style={{ height: `${16 + ((i * 37) % 24)}px` }}
        />
      ))}
    </div>
  );
}

function Listener({ view, send }: RoleProps<'listener'>) {
  const targetNote = usePlayOnChange(view.targetPlays, view.target);
  const playbackNote = usePlayOnChange(view.playback?.id ?? 0, view.playback?.pitches);
  const left = view.maxTargetPlays - view.targetPlays;

  return (
    <div className={styles.root}>
      <p className={styles.note}>
        <strong>You are the Listener.</strong> Only you can hear anything. Describe the melody so
        your Arranger can put the notes in order.
      </p>
      <button
        className={styles.big}
        disabled={left <= 0 || view.solved}
        onClick={() => send({ type: 'replay' })}
      >
        {view.targetPlays === 0 ? 'Play the melody' : 'Replay the melody'} ({left} left)
      </button>
      <Wave count={view.target.length} active={targetNote} />
      <p className={styles.note}>
        {view.playback
          ? `Arranger's playback #${view.playback.id}${playbackNote !== null ? ' — listen!' : ''}`
          : "When your Arranger plays their order, you'll hear it here."}
      </p>
      <Wave count={view.target.length} active={playbackNote} />
      {view.solved && <strong>That's it! The melody is right.</strong>}
    </div>
  );
}

function Arranger({ view, send, timer }: RoleProps<'arranger'>) {
  const [selected, setSelected] = useState<number | null>(null);
  const roundElapsed = timer.totalMs - timer.remainingMs;
  const locked = roundElapsed < view.playLockedUntil;
  const shared = view.slots.some((s) => !s.mine);

  const choose = (index: number) => {
    if (view.solved) return;
    if (selected === null) {
      setSelected(index);
      return;
    }
    if (selected !== index) send({ type: 'swap', a: selected, b: index });
    setSelected(null);
  };

  return (
    <div className={styles.root}>
      <p className={styles.note}>
        <strong>You are the Arranger.</strong> You can't hear anything. Put the notes in order from
        your Listener's description; they'll hear it when you press Play.
        {shared && ' You can only move tiles with a purple border.'}
      </p>
      <div className={styles.slots}>
        {view.slots.map((slot, i) => {
          const classes = [
            styles.tile,
            shared && (slot.mine ? styles.mine : styles.theirs),
            selected === i && styles.selected,
          ].filter(Boolean);
          return (
            <div key={slot.id} className={styles.slot}>
              <span className={styles.index}>{i + 1}</span>
              <button
                className={classes.join(' ')}
                onClick={() => choose(i)}
                aria-label={`Slot ${i + 1}: ${slot.symbol}`}
                aria-pressed={selected === i}
              >
                {slot.symbol}
              </button>
            </div>
          );
        })}
      </div>
      <p className={styles.note}>Tap two tiles to swap them.</p>
      <button
        className={styles.big}
        disabled={locked || view.solved}
        onClick={() => send({ type: 'play' })}
      >
        {locked ? 'Playing to your Listener…' : 'Play this order'}
      </button>
      {view.plays > 0 && !view.solved && (
        <p className={styles.note}>Played {view.plays} times. Ask your Listener how it sounded.</p>
      )}
      {view.solved && <strong>Solved! That was the melody.</strong>}
    </div>
  );
}
