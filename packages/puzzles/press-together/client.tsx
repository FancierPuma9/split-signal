import type { PuzzleClientProps } from '@split-signal/shared';
import type { Action, View } from './types';

export default function PressTogether({ view, send }: PuzzleClientProps<View, Action>) {
  return (
    <div style={{ display: 'grid', gap: 18, justifyItems: 'center' }}>
      <button
        onClick={() => send({ type: 'press' })}
        disabled={view.iPressed}
        style={{ width: 160, height: 160, borderRadius: '50%', fontSize: 22 }}
      >
        {view.iPressed ? 'Pressed' : 'Press'}
      </button>
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 6 }}>
        {view.teams.map((t) => (
          <li key={t.id}>
            <strong>{t.id === view.myTeam ? 'Your team' : t.id}</strong>: {t.pressed} of {t.size}
            {t.done && ' ✓'}
          </li>
        ))}
      </ul>
    </div>
  );
}
