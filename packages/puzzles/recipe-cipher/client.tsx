import type { PuzzleClientProps } from '@split-signal/shared';
import { useEffect, useState } from 'react';
import { GlyphSvg } from '../lib/GlyphSvg';
import styles from './client.module.css';
import { HEATS, type Action, type Glyph, type Item, type StepResult, type View } from './types';

type Props = PuzzleClientProps<View, Action>;

const itemName = (item: Item) => `${item.method} ${item.ingredient}`;

export default function RecipeCipher({ view, send, timer }: Props) {
  const glyphById = new Map(view.glyphs.map((g) => [g.id, g]));
  const roundElapsed = timer.totalMs - timer.remainingMs;

  return (
    <div className={styles.root}>
      <p className={styles.progress}>
        {view.solved
          ? 'Dish served!'
          : `Cooking: ${view.progress} of ${view.totalSteps} steps done`}
        {view.mistakes > 0 && ` · ${view.mistakes} mistake${view.mistakes === 1 ? '' : 's'}`}
      </p>
      {!view.stove && <StepNote step={view.lastStep} who="The cook: " />}
      <div className={styles.panels}>
        {view.lines && <Instructions lines={view.lines} glyphById={glyphById} />}
        {view.key && <Key entries={view.key} glyphById={glyphById} />}
        {view.prep && <Prep view={view} send={send} now={roundElapsed} />}
        {view.stove && <Stove view={view} send={send} now={roundElapsed} />}
      </div>
    </div>
  );
}

function Instructions({ lines, glyphById }: { lines: string[][]; glyphById: Map<string, Glyph> }) {
  // Pencilled-in guesses: pick a glyph, type a letter. Kept on this device only.
  const [guesses, setGuesses] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string | null>(null);

  const note = (letter: string) => {
    if (!selected) return;
    setGuesses((g) => ({ ...g, [selected]: letter }));
    setSelected(null);
  };

  useEffect(() => {
    if (!selected) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^[a-z]$/i.test(e.key)) {
        setGuesses((g) => ({ ...g, [selected]: e.key.toLowerCase() }));
        setSelected(null);
      } else if (e.key === 'Backspace' || e.key === 'Delete') {
        setGuesses((g) => ({ ...g, [selected]: '' }));
        setSelected(null);
      } else if (e.key === 'Escape') {
        setSelected(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  return (
    <section className={styles.panel}>
      <h4>The recipe</h4>
      <p className={styles.hint}>
        Only you can see this. Describe the glyphs to whoever has the key. Tap a glyph, then a
        letter, to note your guess.
      </p>
      <ol className={styles.lines}>
        {lines.map((line, i) => (
          <li key={i} className={styles.line}>
            {line.map((id, j) =>
              id === ' ' ? (
                <span key={j} className={styles.gap} />
              ) : (
                <button
                  key={j}
                  className={`${styles.glyphButton} ${selected === id ? styles.selected : ''}`}
                  onClick={() => setSelected(selected === id ? null : id)}
                  aria-label={`Glyph${guesses[id] ? `, noted as ${guesses[id]}` : ''}`}
                >
                  <GlyphSvg glyph={glyphById.get(id)} />
                  <span className={styles.guess}>{guesses[id] ?? ''}</span>
                </button>
              ),
            )}
          </li>
        ))}
      </ol>
      {selected && (
        // On-screen letters, so noting works without a keyboard (phones). Typing works too.
        <div className={styles.letterPicker} role="group" aria-label="Note a letter">
          {[...'abcdefghijklmnopqrstuvwxyz'].map((letter) => (
            <button key={letter} onClick={() => note(letter)}>
              {letter}
            </button>
          ))}
          <button className={styles.pickerWide} onClick={() => note('')}>
            Clear
          </button>
          <button className={styles.pickerWide} onClick={() => setSelected(null)}>
            Cancel
          </button>
        </div>
      )}
    </section>
  );
}

function Key({
  entries,
  glyphById,
}: {
  entries: Array<{ glyph: string; letter: string }>;
  glyphById: Map<string, Glyph>;
}) {
  return (
    <section className={styles.panel}>
      <h4>The key</h4>
      <p className={styles.hint}>
        Only you have this. Match the glyphs your teammate describes to letters.
      </p>
      <div className={styles.key}>
        {entries.map((entry) => (
          <div key={entry.glyph} className={styles.keyCell}>
            <GlyphSvg glyph={glyphById.get(entry.glyph)} size={34} />
            <span className={styles.keyLetter}>{entry.letter}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Prep({ view, send, now }: { view: View; send: Props['send']; now: number }) {
  const prep = view.prep;
  if (!prep) return null;
  const busy = now < prep.lockedUntil;
  const full = prep.tray.length >= prep.trayLimit;
  return (
    <section className={styles.panel}>
      <h4>Prep station</h4>
      <p className={styles.hint}>
        Prep ingredients the way the recipe says; they go straight to the cook's tray
        {prep.trayLimit ? ` (holds ${prep.trayLimit})` : ''}.
      </p>
      <div className={styles.pantry}>
        {prep.pantry.map(({ ingredient, methods }) => (
          <div key={ingredient} className={styles.ingredient}>
            <span className={styles.ingredientName}>{ingredient}</span>
            {methods.map((method) => (
              <button
                key={method}
                className={`secondary ${styles.small}`}
                disabled={busy || full || view.solved}
                onClick={() => send({ type: 'prep', ingredient, method })}
              >
                {method}
              </button>
            ))}
          </div>
        ))}
      </div>
      {busy && <p className={styles.hint}>Chopping…</p>}
      <Tray items={prep.tray} send={send} />
    </section>
  );
}

function Tray({
  items,
  send,
  onAdd,
}: {
  items: Item[];
  send: Props['send'];
  onAdd?: (item: Item) => void;
}) {
  if (items.length === 0) return <p className={styles.hint}>The tray is empty.</p>;
  return (
    <ul className={styles.tray} aria-label="Tray">
      {items.map((item) => (
        <li key={item.id} className={styles.item}>
          {itemName(item)}
          {onAdd && (
            <button className={styles.small} onClick={() => onAdd(item)}>
              Add
            </button>
          )}
          <button
            className={`secondary ${styles.small}`}
            onClick={() => send({ type: 'discard', itemId: item.id })}
            aria-label={`Throw away ${itemName(item)}`}
          >
            ✕
          </button>
        </li>
      ))}
    </ul>
  );
}

/** The cook's latest stove action, shown for a few seconds each time. */
function StepNote({ step, who = '' }: { step: StepResult | null; who?: string }) {
  if (!step) return null;
  return (
    <p
      key={step.id}
      className={`${styles.step} ${step.ok ? styles.stepOk : styles.stepBad}`}
      role="status"
    >
      {who}
      {step.ok ? '✓ ' : '💨 '}
      {step.text}
    </p>
  );
}

function Stove({ view, send, now }: { view: View; send: Props['send']; now: number }) {
  const stove = view.stove;
  if (!stove) return null;
  const smoky = now < stove.lockedUntil;
  const disabled = smoky || view.solved;
  return (
    <section className={styles.panel}>
      <h4>Stove</h4>
      <p className={styles.hint}>
        Follow the steps in order. A wrong step fills the kitchen with smoke for a few seconds.
      </p>
      <div className={styles.heat} role="group" aria-label="Heat">
        {HEATS.map((level) => (
          <button
            key={level}
            className={`${styles.small} ${stove.heat === level ? styles.heatOn : 'secondary'}`}
            disabled={disabled}
            aria-pressed={stove.heat === level}
            onClick={() => send({ type: 'heat', level })}
          >
            {level}
          </button>
        ))}
      </div>
      {/* Re-keyed on each stove action so the pan jolts: something happened. */}
      <div
        key={view.lastStep?.id ?? 0}
        className={`${styles.pan} ${stove.heat !== 'off' ? styles.hot : ''} ${view.lastStep ? styles.bump : ''}`}
        aria-label="Pan"
      >
        {stove.pan.length === 0 ? 'empty pan' : stove.pan.map(itemName).join(' · ')}
      </div>
      {smoky && (
        <div className={styles.smoke} role="status">
          Smoke! {Math.ceil((stove.lockedUntil - now) / 1000)}s
        </div>
      )}
      <Tray
        items={stove.tray}
        send={send}
        onAdd={disabled ? undefined : (item) => send({ type: 'add', itemId: item.id })}
      />
      <StepNote step={view.lastStep} />
      <div className={styles.actions}>
        <button className="secondary" disabled={disabled} onClick={() => send({ type: 'stir' })}>
          Stir
        </button>
        <button disabled={disabled} onClick={() => send({ type: 'plate' })}>
          Plate it
        </button>
      </div>
    </section>
  );
}
