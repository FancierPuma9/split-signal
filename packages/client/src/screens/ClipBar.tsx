import { audioContext, decodeClip, ensureAudio } from '@split-signal/puzzles/audio';
import type { ClipDelivery, CommsRule, CommsState } from '@split-signal/shared';
import { useEffect, useRef } from 'react';

type ClipRule = Extract<CommsRule, { type: 'delayed-clips' | 'budget-clips' }>;

interface ClipBarProps {
  rule: ClipRule;
  comms: CommsState;
  meId: string;
  nameOf: (id: string) => string;
  recording: boolean;
  /** Who is being heard right now (a clip playing), if anyone. */
  hearing: string | null;
  onRecord: () => void;
  onStop: () => void;
}

const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

/**
 * Push-to-talk for clip rules: hold the button (or V) to record, release to send. Shows mic
 * budgets for budget-clips and clips in flight for delayed-clips.
 */
export function ClipBar({
  rule,
  comms,
  meId,
  nameOf,
  recording,
  hearing,
  onRecord,
  onStop,
}: ClipBarProps) {
  const budgetMs = rule.type === 'budget-clips' ? rule.budgetSeconds * 1000 : null;
  const mine = comms.budgets?.[meId];
  const outOfTime = budgetMs !== null && mine !== undefined && mine <= 0;

  // Hold V to talk, unless typing somewhere.
  const held = useRef(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'v' || e.repeat || held.current || outOfTime) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      held.current = true;
      onRecord();
    };
    const up = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'v' || !held.current) return;
      held.current = false;
      onStop();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [onRecord, onStop, outOfTime]);

  return (
    <div className="clip-bar">
      <button
        className={`talk ${recording ? 'talking' : ''}`}
        disabled={outOfTime}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          onRecord();
        }}
        onPointerUp={onStop}
        onPointerCancel={onStop}
        onLostPointerCapture={onStop}
        // A long press on a phone would otherwise open the context menu and cancel the hold.
        onContextMenu={(e) => e.preventDefault()}
      >
        {outOfTime ? (
          'Out of mic time'
        ) : recording ? (
          '● Recording… release to send'
        ) : (
          <>
            🎙 Hold to talk<span className="key-hint"> (or V)</span>
          </>
        )}
      </button>

      {hearing && (
        <span className="clip-hearing" role="status">
          ▶ {nameOf(hearing)}
        </span>
      )}

      {rule.type === 'delayed-clips' && (
        <span className="small muted">
          {rule.delayMs !== undefined
            ? `Clips arrive ${secs(rule.delayMs)} after you start talking.`
            : 'Each clip arrives after a random delay.'}
          {(comms.pendingDeliveries ?? 0) > 0 && ` ${comms.pendingDeliveries} in flight.`}
        </span>
      )}

      {budgetMs !== null && comms.budgets && (
        <ul className="budgets" aria-label="Mic time left">
          {Object.entries(comms.budgets).map(([id, left]) => (
            <li key={id}>
              <span>{id === meId ? 'You' : nameOf(id)}</span>
              <span className="budget-track">
                <span className="budget-fill" style={{ width: `${(left / budgetMs) * 100}%` }} />
              </span>
              <span className="small muted">{secs(left)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Plays delayed and budget clips as they arrive, clean, cut short at playMs if the budget ran out.
 * Clips that arrive while another is playing play over it rather than cutting it off or waiting:
 * when a clip arrives is part of the puzzle. Plays through the shared Web Audio context, which
 * taps unlock, because phones refuse to start an <audio> element outside a gesture.
 */
export function ClipAutoPlayer({
  clips,
  onHearing,
}: {
  clips: ClipDelivery[];
  /** Who is being heard now: the sender of the latest clip still playing, or null. */
  onHearing?: (from: string | null) => void;
}) {
  const heard = useRef(clips.at(-1)?.id ?? 0);
  const playing = useRef(new Map<AudioBufferSourceNode, string>());
  const ended = useRef(false);

  // Stop everything when the round (and this component) ends.
  useEffect(() => {
    const current = playing.current;
    ended.current = false;
    return () => {
      ended.current = true;
      for (const source of current.keys()) source.stop();
      current.clear();
    };
  }, []);

  useEffect(() => {
    const fresh = clips.filter((c) => c.id > heard.current);
    if (fresh.length === 0) return;
    heard.current = Math.max(...fresh.map((c) => c.id));
    const current = playing.current;
    const report = () => onHearing?.([...current.values()].at(-1) ?? null);
    const play = async (clip: ClipDelivery) => {
      // Still locked (no tap yet on a phone): the "tap to turn on sound" prompt covers it.
      if (!(await ensureAudio())) return;
      const buffer = await decodeClip(clip.data);
      const ctx = audioContext();
      if (!ctx || ended.current) return;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      source.onended = () => {
        current.delete(source);
        report();
      };
      current.set(source, clip.from);
      report();
      const playMs = (clip.params as { playMs?: unknown } | null)?.playMs;
      source.start(0, 0, typeof playMs === 'number' ? playMs / 1000 : undefined);
    };
    for (const clip of fresh) {
      play(clip).catch((error: unknown) => {
        console.warn('[clips] could not play a clip', error);
      });
    }
  }, [clips, onHearing]);

  return null;
}
