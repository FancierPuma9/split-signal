import type { PuzzleClientProps } from '@split-signal/shared';
import styles from './client.module.css';
import type { Material } from './tower';
import type { Action, BuilderView, SorterView, View } from './types';

const MATERIAL_LABEL: Record<Material, string> = {
  wood: 'Wood',
  iron: 'Iron',
  steel: 'Steel',
  concrete: 'Concrete',
};

export default function SwapStack({ view, send, timer }: PuzzleClientProps<View, Action>) {
  const elapsed = timer.totalMs - timer.remainingMs;
  const secondsLeft = Math.max(0, Math.ceil((view.phaseEndsAt - elapsed) / 1000));
  const sorter = view.role === 'sorter';
  const myTurn = sorter
    ? view.phase === 'sort'
    : view.phase === 'build' && view.activeBuilder === view.me;

  const status = view.done
    ? 'Tower finished'
    : view.phase === 'sort'
      ? sorter
        ? `Swap the next two, or keep them? ${secondsLeft}s`
        : 'Waiting for the Sorter…'
      : myTurn
        ? `Place it: ${secondsLeft}s (or it goes on the shortest column)`
        : sorter
          ? 'The Builder is placing…'
          : 'Your partner Builder is placing…';

  return (
    <div className={styles.root}>
      <p className={styles.status}>
        Piece {Math.min(view.placed + 1, view.total)} of {view.total} · {status}
      </p>

      <div className={styles.cues}>
        {view.lastSort && (
          <span
            key={`sort-${view.lastSort.piece}`}
            className={view.lastSort.swapped ? styles.swapped : styles.kept}
          >
            {view.lastSort.swapped ? '⇄ Swapped!' : 'Kept'}
          </span>
        )}
        {view.lastFall && (
          <span key={`fall-${view.lastFall.piece}`} className={styles.fell}>
            💥 {view.lastFall.count} {view.lastFall.count === 1 ? 'piece' : 'pieces'} fell
          </span>
        )}
      </div>

      <Queue view={view} />

      {sorter ? (
        <div className={styles.buttons}>
          <button disabled={!myTurn || view.done} onClick={() => send({ type: 'swap' })}>
            ⇄ Swap
          </button>
          <button
            className={styles.secondary}
            disabled={!myTurn || view.done}
            onClick={() => send({ type: 'keep' })}
          >
            Keep
          </button>
        </div>
      ) : null}

      <div className={styles.sets}>
        {view.columns.map((set, b) => (
          <div key={b} className={styles.set}>
            {view.columns.length > 1 && (
              <span className={styles.setLabel}>
                {view.role === 'builder' && b === view.me ? 'Your columns' : `Builder ${b + 1}`}
              </span>
            )}
            <div className={styles.columns}>
              {set.map((column, c) => {
                const canPlace = view.role === 'builder' && myTurn && b === view.me && !view.done;
                return (
                  <button
                    key={c}
                    className={`${styles.column} ${canPlace ? styles.placeable : ''}`}
                    disabled={!canPlace}
                    aria-label={`Column ${c + 1}, ${column.length} high`}
                    onClick={() => send({ type: 'place', column: c })}
                  >
                    {column.map((piece) => (
                      <Block key={piece.id} piece={piece} />
                    ))}
                    <span className={styles.height}>{column.length}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {sorter && <Legend />}
    </div>
  );
}

function Queue({ view }: { view: BuilderView | SorterView }) {
  const labels = ['Next', 'After that'];
  return (
    <div className={styles.queue}>
      {view.queue.map((piece, i) => (
        <figure key={piece.id} className={styles.queued}>
          <Block piece={piece} large />
          <figcaption>{labels[i]}</figcaption>
        </figure>
      ))}
    </div>
  );
}

function Block({
  piece,
  large,
}: {
  piece: { id: number; material?: Material; load?: number; strength?: number };
  large?: boolean;
}) {
  const material = piece.material ?? 'wood';
  const stress =
    piece.load !== undefined && piece.strength !== undefined ? piece.load / piece.strength : null;
  return (
    <span
      className={`${styles.block} ${styles[material]} ${large ? styles.large : ''}`}
      title={
        piece.material ? `${MATERIAL_LABEL[material]} ${piece.load}/${piece.strength}` : undefined
      }
    >
      {stress !== null && (
        <span
          className={`${styles.stress} ${stress > 0.99 ? styles.maxed : stress >= 0.75 ? styles.strained : ''}`}
          style={{ width: `${Math.min(1, stress) * 100}%` }}
        />
      )}
    </span>
  );
}

function Legend() {
  return (
    <ul className={styles.legend}>
      {(['wood', 'iron', 'steel', 'concrete'] as Material[]).map((m) => (
        <li key={m}>
          <span className={`${styles.swatch} ${styles[m]}`} /> {MATERIAL_LABEL[m]}
        </li>
      ))}
      <li className={styles.legendNote}>Bars: weight carried vs strength</li>
    </ul>
  );
}
