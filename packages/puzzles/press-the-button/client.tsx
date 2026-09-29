import type { CSSProperties } from 'react';
import type { PuzzleClientProps } from '@split-signal/shared';
import type { Action, ButtonColor, View } from './types';

const COLORS: Record<ButtonColor, string> = {
  red: '#e5484d',
  orange: '#f76b15',
  yellow: '#ffc53d',
  green: '#30a46c',
  blue: '#0090ff',
  purple: '#8e4ec6',
};

export default function PressTheButton({ view, send }: PuzzleClientProps<View, Action>) {
  const button: CSSProperties = {
    width: 180,
    height: 180,
    borderRadius: '50%',
    border: 'none',
    background: COLORS[view.color],
    color: '#fff',
    fontSize: 24,
    fontWeight: 700,
    cursor: view.pressed ? 'default' : 'pointer',
    opacity: view.pressed ? 0.45 : 1,
    boxShadow: view.pressed ? 'inset 0 6px 12px rgba(0,0,0,0.4)' : '0 8px 0 rgba(0,0,0,0.35)',
    transform: view.pressed ? 'translateY(6px)' : 'none',
  };

  return (
    <div style={{ display: 'grid', gap: 20, justifyItems: 'center' }}>
      <button style={button} disabled={view.pressed} onClick={() => send({ type: 'press' })}>
        {view.pressed ? 'Pressed' : 'Press'}
      </button>
      <p style={{ margin: 0 }}>
        {view.teamPressed} of {view.teamSize} pressed
      </p>
    </div>
  );
}
