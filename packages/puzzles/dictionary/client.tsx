import type { PuzzleClientProps } from '@split-signal/shared';
import { useEffect, useRef, useState } from 'react';
import styles from './client.module.css';
import { playSound } from './sounds';
import type {
  Action,
  Controls,
  ReceiverView,
  RevealView,
  SenderView,
  Shape,
  Task,
  View,
} from './types';

type Props = PuzzleClientProps<View, Action>;

const COLOR_HEX: Record<string, string> = {
  red: '#e5484d',
  blue: '#0090ff',
  yellow: '#ffc53d',
  green: '#30a46c',
};

export default function Dictionary(props: Props) {
  const { view } = props;
  if (view.role === 'reveal') return <Reveal view={view} />;
  const elapsed = props.timer.totalMs - props.timer.remainingMs;
  const lockedFor = view.lockedUntil === null ? 0 : Math.max(0, view.lockedUntil - elapsed);
  return (
    <div className={styles.root}>
      <p className={styles.stage}>
        {view.done ? 'All stages cleared!' : `Stage ${view.stage + 1} of ${view.stages}`}
      </p>
      {view.role === 'sender' ? (
        <Sender view={view} signals={props.signals} lockedFor={lockedFor} />
      ) : (
        <Receiver
          view={view}
          send={props.send}
          signals={props.signals}
          lockedFor={lockedFor}
          meId={props.me.id}
        />
      )}
    </div>
  );
}

function ShapeSvg({ shape, size = 56 }: { shape: Shape; size?: number }) {
  const fill = COLOR_HEX[shape.color] ?? '#999';
  const paths: Record<string, string> = {
    square: 'M8 8h32v32H8z',
    triangle: 'M24 6l20 36H4z',
    diamond: 'M24 4l18 20-18 20L6 24z',
    star: 'M24 4l5.9 13 14.1 1.5-10.6 9.4 3.1 13.9L24 34.6l-12.5 7.2 3.1-13.9L4 18.5 18.1 17z',
    heart: 'M24 42S6 30 6 17a9 9 0 0118-2 9 9 0 0118 2c0 13-18 25-18 25z',
  };
  return (
    <svg viewBox="0 0 48 48" width={size} height={size} aria-label={`${shape.color} ${shape.form}`}>
      {shape.form === 'circle' ? (
        <circle cx="24" cy="24" r="18" fill={fill} />
      ) : (
        <path d={paths[shape.form]} fill={fill} />
      )}
    </svg>
  );
}

function Tile({ tile, turns = 0, big }: { tile: string; turns?: number; big?: boolean }) {
  return (
    <span
      className={`${styles.tile} ${big ? styles.bigTile : ''}`}
      style={{ transform: `rotate(${turns * 90}deg)` }}
    >
      {tile}
    </span>
  );
}

/** What the Receiver's controls look like right now (read-only, for the Sender). */
function ControlsPreview({ task, controls }: { task: Task; controls: Controls }) {
  if (task.kind === 'pick' && controls.kind === 'pick') {
    return (
      <div className={styles.row}>
        {task.shapes.map((shape, i) => (
          <span
            key={i}
            className={`${styles.option} ${controls.selected === i ? styles.selected : ''}`}
          >
            <ShapeSvg shape={shape} size={40} />
          </span>
        ))}
      </div>
    );
  }
  if (controls.kind === 'order' || controls.kind === 'rotate') {
    return (
      <div className={styles.row}>
        {controls.tiles.map((tile) => (
          <Tile
            key={tile}
            tile={tile}
            turns={controls.kind === 'rotate' ? controls.turns[tile] : 0}
          />
        ))}
      </div>
    );
  }
  if (controls.kind === 'dials') {
    return (
      <div className={styles.row}>
        {controls.values.map((v, i) => (
          <span key={i} className={styles.dialValue}>
            {v}
          </span>
        ))}
      </div>
    );
  }
  return null;
}

function Answer({ task }: { task: Task }) {
  switch (task.kind) {
    case 'pick':
      return (
        <div className={styles.row}>
          {task.shapes.map((shape, i) => (
            <span key={i} className={`${styles.option} ${i === task.answer ? styles.answer : ''}`}>
              <ShapeSvg shape={shape} />
            </span>
          ))}
        </div>
      );
    case 'order':
      return (
        <div className={styles.row}>
          {task.answer.map((tile) => (
            <Tile key={tile} tile={tile} big />
          ))}
        </div>
      );
    case 'dials':
      return (
        <div className={styles.row}>
          {task.answer.map((v, i) => (
            <span key={i} className={`${styles.dialValue} ${styles.big}`}>
              {v}
            </span>
          ))}
        </div>
      );
    case 'rotate':
      return (
        <div className={styles.row}>
          {task.answer.map((tile) => (
            <Tile key={tile} tile={tile} turns={task.turns[tile]} big />
          ))}
        </div>
      );
  }
}

const TASK_LINES: Record<Task['kind'], string> = {
  pick: 'They have to pick the outlined one.',
  order: 'They have to put the tiles in this order.',
  dials: 'They have to set the dials to this.',
  rotate: 'They have to put the tiles in this order, turned like this.',
};

function Sender({
  view,
  signals,
  lockedFor,
}: {
  view: SenderView;
  signals: Props['signals'];
  lockedFor: number;
}) {
  return (
    <>
      {view.task && view.controls && (
        <section className={styles.panel}>
          <p className={styles.hint}>{TASK_LINES[view.task.kind]}</p>
          <Answer task={view.task} />
          <p className={styles.hint}>What they have now:</p>
          <ControlsPreview task={view.task} controls={view.controls} />
          {lockedFor > 0 && (
            <p className={styles.locked}>
              Wrong! They're locked for {Math.ceil(lockedFor / 1000)}s
            </p>
          )}
        </section>
      )}
      <section className={styles.panel}>
        <p className={styles.hint}>You have no mic. These are all you can say:</p>
        <div className={styles.pad}>
          {view.sounds.map((sound) => (
            <button
              key={sound}
              className={styles.sound}
              disabled={view.done}
              onClick={() => {
                playSound(sound, 0.35);
                signals.send(sound);
              }}
            >
              {sound}
            </button>
          ))}
        </div>
        {view.nextSounds.length > 0 && (
          <p className={styles.note}>Next stage adds: {view.nextSounds.join(', ')}</p>
        )}
      </section>
    </>
  );
}

function Receiver({
  view,
  send,
  signals,
  lockedFor,
  meId,
}: {
  view: ReceiverView;
  send: Props['send'];
  signals: Props['signals'];
  lockedFor: number;
  meId: string;
}) {
  const heard = useRef(signals.incoming.at(-1)?.at ?? 0);
  useEffect(() => {
    const fresh = signals.incoming.filter((s) => s.at > heard.current && s.from !== meId);
    if (fresh.length === 0) return;
    heard.current = fresh.at(-1)!.at;
    for (const s of fresh) playSound(s.signal);
  }, [signals.incoming, meId]);

  const log = signals.incoming
    .filter((s) => s.from !== meId)
    .slice(-8)
    .reverse();
  const locked = lockedFor > 0 || view.done;
  return (
    <>
      {view.task && view.controls && (
        <section className={styles.panel}>
          <p className={styles.hint}>
            Ask out loud; they can only answer in sounds. Their sounds: {view.sounds.join(', ')}.
          </p>
          <ReceiverControls view={view} controls={view.controls} send={send} disabled={locked} />
          <button
            className={styles.submit}
            disabled={locked}
            onClick={() => send({ type: 'submit' })}
          >
            {lockedFor > 0 ? `Locked for ${Math.ceil(lockedFor / 1000)}s` : 'Submit'}
          </button>
        </section>
      )}
      <section className={styles.panel}>
        <p className={styles.hint}>What they said:</p>
        {log.length === 0 ? (
          <p className={styles.note}>Nothing yet.</p>
        ) : (
          <ol className={styles.log}>
            {log.map((s) => (
              <li key={s.at}>
                <button className="link" onClick={() => playSound(s.signal)}>
                  {s.signal}
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}

function ReceiverControls({
  view,
  controls,
  send,
  disabled,
}: {
  view: ReceiverView;
  controls: Controls;
  send: Props['send'];
  disabled: boolean;
}) {
  const [held, setHeld] = useState<number | null>(null);
  const tap = (i: number) => {
    if (held === null) return setHeld(i);
    if (held !== i) send({ type: 'swap', a: held, b: i });
    setHeld(null);
  };

  if (view.task?.kind === 'pick' && controls.kind === 'pick') {
    return (
      <div className={styles.row}>
        {view.task.shapes.map((shape, i) => (
          <button
            key={i}
            className={`${styles.option} ${controls.selected === i ? styles.selected : ''}`}
            disabled={disabled}
            onClick={() => send({ type: 'pick', index: i })}
          >
            <ShapeSvg shape={shape} />
          </button>
        ))}
      </div>
    );
  }
  if (controls.kind === 'order' || controls.kind === 'rotate') {
    return (
      <>
        <div className={styles.row}>
          {controls.tiles.map((tile, i) => (
            <div key={tile} className={styles.tileSlot}>
              <button
                className={`${styles.option} ${held === i ? styles.selected : ''}`}
                disabled={disabled}
                onClick={() => tap(i)}
              >
                <Tile
                  tile={tile}
                  turns={controls.kind === 'rotate' ? controls.turns[tile] : 0}
                  big
                />
              </button>
              {controls.kind === 'rotate' && (
                <button
                  className={styles.turn}
                  disabled={disabled}
                  onClick={() => send({ type: 'rotate', position: i })}
                  aria-label={`Turn ${tile}`}
                >
                  ↻
                </button>
              )}
            </div>
          ))}
        </div>
        <p className={styles.note}>Tap two tiles to swap them.</p>
      </>
    );
  }
  if (controls.kind === 'dials') {
    return (
      <div className={styles.row}>
        {controls.values.map((value, dial) => (
          <div key={dial} className={styles.dial}>
            <button
              className="secondary"
              disabled={disabled}
              onClick={() => send({ type: 'setDial', dial, value: (value + 1) % 10 })}
            >
              ▲
            </button>
            <span className={`${styles.dialValue} ${styles.big}`}>{value}</span>
            <button
              className="secondary"
              disabled={disabled}
              onClick={() => send({ type: 'setDial', dial, value: (value + 9) % 10 })}
            >
              ▼
            </button>
          </div>
        ))}
      </div>
    );
  }
  return null;
}

function Reveal({ view }: { view: RevealView }) {
  return (
    <div className={styles.root}>
      <p className={styles.stage}>
        Cleared {view.cleared} of {view.stages} stages
        {view.wrongSubmits > 0 && ` with ${view.wrongSubmits} wrong answers`}.
      </p>
    </div>
  );
}
