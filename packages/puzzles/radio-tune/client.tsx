import type { ClipDelivery, PuzzleClientProps } from '@split-signal/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './client.module.css';
import { AudioLockedError, playDistorted } from './distort';
import {
  KNOB_MAX,
  type Action,
  type Distortion,
  type Knob,
  type Panel,
  type Switch,
  type View,
} from './types';

type Props = PuzzleClientProps<View, Action>;

const KNOBS: Array<{ id: Knob; label: string }> = [
  { id: 'band', label: 'Band' },
  { id: 'tuning', label: 'Tuning' },
];
const SWITCHES: Array<{ id: Switch; label: string }> = [
  { id: 'filter', label: 'Filter' },
  { id: 'squelch', label: 'Squelch' },
];

export default function RadioTune(props: Props) {
  return props.view.role === 'sender' ? <Sender {...props} /> : <Receiver {...props} />;
}

function PanelDisplay({
  panel,
  onKnob,
  onSwitch,
}: {
  panel: Panel;
  onKnob?: (knob: Knob, value: number) => void;
  onSwitch?: (sw: Switch, on: boolean) => void;
}) {
  return (
    <div className={styles.radio}>
      <div className={styles.row}>
        {KNOBS.map(({ id, label }) => (
          <div key={id} className={styles.control}>
            <span className={styles.label}>{label}</span>
            <div className={styles.knob}>
              {onKnob && (
                <button
                  className="secondary"
                  aria-label={`Turn ${label} down`}
                  disabled={panel[id] <= 0}
                  onClick={() => onKnob(id, panel[id] - 1)}
                >
                  −
                </button>
              )}
              <span className={styles.value} aria-label={`${label} ${panel[id]}`}>
                {panel[id]}
              </span>
              {onKnob && (
                <button
                  className="secondary"
                  aria-label={`Turn ${label} up`}
                  disabled={panel[id] >= KNOB_MAX}
                  onClick={() => onKnob(id, panel[id] + 1)}
                >
                  +
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      <div className={styles.row}>
        {SWITCHES.map(({ id, label }) => (
          <div key={id} className={styles.control}>
            <span className={styles.label}>{label}</span>
            <button
              className={`${styles.switch} ${panel[id] ? styles.switchOn : ''}`}
              disabled={!onSwitch}
              aria-pressed={panel[id]}
              aria-label={`${label} switch`}
              onClick={() => onSwitch?.(id, !panel[id])}
            >
              {panel[id] ? 'ON' : 'OFF'}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function Sender({ view, clips, signals, me }: Props) {
  if (view.role !== 'sender') return null;
  const repeats = signals.incoming.filter((s) => s.signal === 'repeat' && s.from !== me.id).length;
  return (
    <div className={styles.root}>
      <p className={styles.note}>
        <strong>You are the Sender.</strong> These are the right settings. Record short clips
        telling your Receiver what to set; they hear them through the static.
      </p>
      <PanelDisplay panel={view.target} />
      {clips && (
        <button
          className={`${styles.record} ${clips.recording ? styles.recording : ''}`}
          disabled={view.solved}
          onClick={() => (clips.recording ? clips.stop() : void clips.record())}
        >
          {clips.recording ? '● Recording… tap to send' : '🎙 Record a clip'}
        </button>
      )}
      <p className={styles.note}>
        Clips are up to 5 seconds, one every few seconds.
        {repeats > 0 &&
          ` Your Receiver asked for a repeat ${repeats} time${repeats === 1 ? '' : 's'}; they hear your last clip again automatically.`}
      </p>
      {view.solved && <strong>Tuned in!</strong>}
    </div>
  );
}

function Receiver({ view, send, clips, signals }: Props) {
  const latest = clips?.incoming.at(-1);
  const heard = useRef(latest?.id ?? 0);
  const [playing, setPlaying] = useState(false);
  // Why the latest clip couldn't be heard: sound not unlocked yet (phones), or undecodable.
  const [problem, setProblem] = useState<'locked' | 'undecodable' | null>(null);

  const play = useCallback((clip: ClipDelivery, isCancelled: () => boolean = () => false) => {
    setPlaying(true);
    setProblem(null);
    playDistorted(clip.data, clip.params as Distortion)
      .catch((error: unknown) => {
        if (!isCancelled())
          setProblem(error instanceof AudioLockedError ? 'locked' : 'undecodable');
      })
      .finally(() => {
        if (!isCancelled()) setPlaying(false);
      });
  }, []);

  // Play each new clip once as it arrives (not old ones after a reconnect).
  useEffect(() => {
    if (!latest || latest.id <= heard.current) return;
    heard.current = latest.id;
    let cancelled = false;
    const start = setTimeout(() => play(latest, () => cancelled), 0);
    return () => {
      cancelled = true;
      clearTimeout(start);
    };
  }, [latest, play]);

  if (view.role !== 'receiver') return null;
  return (
    <div className={styles.root}>
      <p className={styles.note}>
        <strong>You are the Receiver.</strong> Your Sender knows the right settings. Their clips get
        clearer as your panel gets closer.
      </p>
      <p className={styles.onAir} role="status">
        {playing
          ? '📻 Incoming transmission…'
          : problem === 'undecodable'
            ? "This device couldn't play that clip."
            : latest
              ? ''
              : 'Waiting for the first transmission…'}
      </p>
      {problem === 'locked' && latest && !playing && (
        <button onClick={() => play(latest)}>🔊 Tap to hear the transmission</button>
      )}
      <PanelDisplay
        panel={view.panel}
        onKnob={
          view.solved ? undefined : (control, value) => send({ type: 'knob', control, value })
        }
        onSwitch={view.solved ? undefined : (control, on) => send({ type: 'switch', control, on })}
      />
      <button
        className="secondary"
        disabled={!latest || view.solved}
        onClick={() => signals.send('repeat')}
      >
        Hear the last clip again
      </button>
      {view.solved && <strong>Tuned in!</strong>}
    </div>
  );
}
