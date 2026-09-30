import type { CSSProperties, ReactNode } from 'react';

interface RecordButtonProps {
  recording: boolean;
  disabled?: boolean;
  /** The clip length cap; a ring around the button runs down over it while recording. */
  maxSeconds: number;
  onRecord: () => void;
  onStop: () => void;
  /** Shown while idle (defaults to "🎙 Hold to talk"). */
  children?: ReactNode;
  className?: string;
}

/**
 * Hold to record, release to send. Safe for long presses on phones (no context menu, no text
 * callout, releases even when the finger slides off), and shows the cutoff as a shrinking ring.
 * Styled by the client's .talk / .talking / .record-ring classes.
 */
export function RecordButton({
  recording,
  disabled,
  maxSeconds,
  onRecord,
  onStop,
  children,
  className,
}: RecordButtonProps) {
  return (
    <button
      className={['talk', recording && 'talking', className].filter(Boolean).join(' ')}
      disabled={disabled}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        try {
          e.currentTarget.setPointerCapture(e.pointerId);
        } catch {
          // Synthetic pointer: fine without capture.
        }
        onRecord();
      }}
      onPointerUp={onStop}
      onPointerCancel={onStop}
      onLostPointerCapture={onStop}
      onContextMenu={(e) => e.preventDefault()}
    >
      {recording && (
        // Remounted on each recording, so the CSS animation starts over.
        <span
          className="record-ring"
          aria-hidden="true"
          style={{ '--record-seconds': `${maxSeconds}s` } as CSSProperties}
        />
      )}
      {recording ? '● Recording… release to send' : (children ?? '🎙 Hold to talk')}
    </button>
  );
}
