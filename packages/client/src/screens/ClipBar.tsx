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
      >
        {outOfTime
          ? 'Out of mic time'
          : recording
            ? '● Recording… release to send'
            : '🎙 Hold to talk (or V)'}
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
 * when a clip arrives is part of the puzzle.
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
  const playing = useRef(new Map<HTMLAudioElement, string>());

  // Stop everything when the round (and this component) ends.
  useEffect(() => {
    const current = playing.current;
    return () => {
      for (const audio of current.keys()) audio.pause();
      current.clear();
    };
  }, []);

  useEffect(() => {
    const fresh = clips.filter((c) => c.id > heard.current);
    if (fresh.length === 0) return;
    heard.current = Math.max(...fresh.map((c) => c.id));
    const current = playing.current;
    const report = () => onHearing?.([...current.values()].at(-1) ?? null);
    for (const clip of fresh) {
      const audio = new Audio(`data:${clip.mime};base64,${clip.data}`);
      const playMs = (clip.params as { playMs?: unknown } | null)?.playMs;
      let stop: ReturnType<typeof setTimeout> | undefined;
      const done = () => {
        clearTimeout(stop);
        current.delete(audio);
        report();
      };
      audio.onplay = () => {
        current.set(audio, clip.from);
        report();
        if (typeof playMs === 'number') stop = setTimeout(() => audio.pause(), playMs);
      };
      audio.onended = done;
      audio.onpause = done;
      audio.play().catch(done);
    }
  }, [clips, onHearing]);

  return null;
}
