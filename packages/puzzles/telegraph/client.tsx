import type { PuzzleClientProps } from '@split-signal/shared';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import styles from './client.module.css';
import { Tone } from './tone';
import type { Action, ReceiverView, RevealView, SenderView, View } from './types';

type Props = PuzzleClientProps<View, Action>;

export default function Telegraph(props: Props) {
  const { view } = props;
  if (view.role === 'reveal') return <Reveal view={view} />;
  const elapsed = props.timer.totalMs - props.timer.remainingMs;
  const lockedFor = view.lockedUntil === null ? 0 : Math.max(0, view.lockedUntil - elapsed);
  return view.role === 'sender' ? (
    <Sender view={view} signals={props.signals} lockedFor={lockedFor} />
  ) : (
    <Receiver
      view={view}
      send={props.send}
      signals={props.signals}
      lockedFor={lockedFor}
      meId={props.me.id}
    />
  );
}

function Board({
  size,
  region,
  cellClass,
  onCell,
  className,
}: {
  size: number;
  region: number[];
  cellClass: (cell: number) => string;
  onCell?: (cell: number) => void;
  className?: string;
}) {
  const cells = new Set(region);
  return (
    <div
      className={[styles.board, className].filter(Boolean).join(' ')}
      style={{ '--size': size } as CSSProperties}
    >
      {Array.from({ length: size * size }, (_, cell) =>
        cells.has(cell) ? (
          <button
            key={cell}
            className={`${styles.cell} ${cellClass(cell)}`}
            disabled={!onCell}
            onClick={() => onCell?.(cell)}
            aria-label={`Row ${Math.floor(cell / size) + 1}, column ${(cell % size) + 1}`}
          />
        ) : (
          <span key={cell} className={styles.gap} />
        ),
      )}
    </div>
  );
}

function Sender({
  view,
  signals,
  lockedFor,
}: {
  view: SenderView;
  signals: Props['signals'];
  lockedFor: number;
}) {
  const [holding, setHolding] = useState(false);
  const held = useRef(false);
  // A quiet local copy of the tone, so you can hear your own rhythm.
  const [sidetone] = useState(() => new Tone(660, 0.08));
  const target = new Set(view.target);

  const press = () => {
    if (held.current || view.solved) return;
    held.current = true;
    setHolding(true);
    sidetone.start();
    signals.send('down');
  };
  const release = () => {
    if (!held.current) return;
    held.current = false;
    setHolding(false);
    sidetone.stop();
    signals.send('up');
  };

  // Space works as the key too.
  const pressRef = useRef(press);
  const releaseRef = useRef(release);
  useEffect(() => {
    pressRef.current = press;
    releaseRef.current = release;
  });
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key !== ' ' || e.repeat) return;
      e.preventDefault();
      pressRef.current();
    };
    const up = (e: KeyboardEvent) => {
      if (e.key !== ' ') return;
      e.preventDefault();
      releaseRef.current();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      sidetone.stop();
    };
  }, [sidetone]);

  const halfOf = (cell: number) => view.halves?.findIndex((h) => h.includes(cell)) ?? -1;
  return (
    <div className={styles.root}>
      <p className={styles.hint}>
        Get this pattern across with nothing but the key. Invent a way to walk this board.
      </p>
      <Board
        size={view.size}
        region={view.region}
        cellClass={(cell) =>
          [target.has(cell) && styles.on, halfOf(cell) === 1 && styles.otherHalf]
            .filter(Boolean)
            .join(' ')
        }
      />
      <button
        className={`${styles.key} ${holding ? styles.keyDown : ''}`}
        disabled={view.solved}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          press();
        }}
        onPointerUp={release}
        onPointerCancel={release}
        onLostPointerCapture={release}
        onContextMenu={(e) => e.preventDefault()}
      >
        {holding ? 'Beeeep…' : 'Hold to beep'}
        <span className={styles.keyHint}> (or Space)</span>
      </button>
      {view.lastSubmit && (
        <section className={styles.feedback}>
          <h4>
            Their last try: {view.lastSubmit.wrong.length} wrong{' '}
            {view.lastSubmit.wrong.length === 1 ? 'cell' : 'cells'}
          </h4>
          <Board
            size={view.size}
            region={view.region}
            className={styles.small}
            cellClass={(cell) =>
              [
                view.lastSubmit!.cells.includes(cell) && styles.on,
                view.lastSubmit!.wrong.includes(cell) && styles.wrong,
              ]
                .filter(Boolean)
                .join(' ')
            }
          />
          <p className={styles.note}>
            {lockedFor > 0
              ? `They're locked out for ${Math.ceil(lockedFor / 1000)}s.`
              : 'Tap them corrections, or start over from the top.'}
          </p>
        </section>
      )}
    </div>
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
  const [tone] = useState(() => new Tone());
  const [beeping, setBeeping] = useState(false);
  const lastAt = useRef(signals.incoming.at(-1)?.at ?? 0);

  // Play the Sender's key: tone on at 'down', off at 'up'.
  useEffect(() => {
    const fresh = signals.incoming.filter((s) => s.at > lastAt.current && s.from !== meId);
    if (fresh.length === 0) return;
    lastAt.current = fresh.at(-1)!.at;
    const last = fresh.at(-1)!;
    if (last.signal === 'down') tone.start();
    else tone.stop();
    const flip = setTimeout(() => setBeeping(last.signal === 'down'), 0);
    return () => clearTimeout(flip);
  }, [signals.incoming, tone, meId]);

  useEffect(() => () => tone.stop(), [tone]);

  const mine = new Set(view.mine);
  const filled = new Set(view.filled);
  const locked = lockedFor > 0 || view.solved;
  return (
    <div className={styles.root}>
      <p className={styles.hint}>
        Listen to the beeps and fill in the cells they mean.
        {view.mine.length < view.region.length &&
          ' You fill the bright half; your partner the other.'}
      </p>
      <Board
        size={view.size}
        region={view.region}
        className={beeping ? styles.beeping : ''}
        cellClass={(cell) =>
          [filled.has(cell) && styles.on, !mine.has(cell) && styles.otherHalf]
            .filter(Boolean)
            .join(' ')
        }
        {...(locked
          ? {}
          : { onCell: (cell: number) => mine.has(cell) && send({ type: 'toggle', cell }) })}
      />
      <p className={styles.toneLine} role="status">
        {beeping ? '🔊 Beep' : '·'}
      </p>
      <button className={styles.submit} disabled={locked} onClick={() => send({ type: 'submit' })}>
        {lockedFor > 0 ? `Locked for ${Math.ceil(lockedFor / 1000)}s` : 'Submit'}
      </button>
      <p className={styles.note}>
        A wrong submit shows the Sender your board, locks you out for 8s and adds 8s to your time.
        {view.wrongSubmits > 0 && ` Wrong so far: ${view.wrongSubmits}.`}
      </p>
    </div>
  );
}

function Reveal({ view }: { view: RevealView }) {
  const target = new Set(view.target);
  const filled = new Set(view.filled);
  return (
    <div className={styles.root}>
      <p className={styles.hint}>
        The pattern{view.wrongSubmits > 0 ? `, after ${view.wrongSubmits} wrong submits` : ''}.
        Outlined cells are what was filled.
      </p>
      <Board
        size={view.size}
        region={view.region}
        className={styles.small}
        cellClass={(cell) =>
          [target.has(cell) && styles.on, filled.has(cell) && styles.marked]
            .filter(Boolean)
            .join(' ')
        }
      />
    </div>
  );
}
