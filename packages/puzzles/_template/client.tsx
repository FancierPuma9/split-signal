import { useState, type CSSProperties } from 'react';
import type { PuzzleClientProps } from '@split-signal/shared';
import { MAX_NUMBER, type Action, type View } from './types';

// Render the view and call send(). No network code, no knowledge of other teams.
export default function GuessTheNumber({ view, send }: PuzzleClientProps<View, Action>) {
  const [value, setValue] = useState('');

  const history = view.guesses.length > 0 && (
    <p style={styles.muted}>Guesses so far: {view.guesses.join(', ')}</p>
  );

  if (view.role === 'knower') {
    return (
      <div style={styles.panel}>
        <p style={styles.muted}>The number is</p>
        <p style={styles.big}>{view.secret}</p>
        <p>Get your team to guess it.</p>
        {history}
      </div>
    );
  }

  return (
    <div style={styles.panel}>
      <p>Guess a number from 1 to {MAX_NUMBER}.</p>
      <form
        style={styles.row}
        onSubmit={(e) => {
          e.preventDefault();
          send({ type: 'guess', value: Number(value) });
          setValue('');
        }}
      >
        <input
          type="number"
          min={1}
          max={MAX_NUMBER}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          style={styles.input}
        />
        <button type="submit" disabled={!value || view.solved}>
          Guess
        </button>
      </form>
      {history}
    </div>
  );
}

const styles = {
  panel: { display: 'grid', gap: 12, justifyItems: 'center', textAlign: 'center' },
  row: { display: 'flex', gap: 8 },
  input: { width: 80, fontSize: 18, padding: '6px 8px' },
  big: { fontSize: 72, fontWeight: 700, margin: 0 },
  muted: { opacity: 0.7, margin: 0 },
} satisfies Record<string, CSSProperties>;
