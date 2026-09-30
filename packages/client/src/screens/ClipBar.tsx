import { playClip, type Playback } from '@split-signal/puzzles/audio';
import { RecordButton } from '@split-signal/puzzles/record-button';
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
 * budgets (time and sends) for budget-clips and clips in flight for delayed-clips.
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
  const budgetMs =
    rule.type === 'budget-clips' && rule.budgetSeconds !== undefined
      ? rule.budgetSeconds * 1000
      : null;
  const teamBudget = rule.type === 'budget-clips' && rule.budgetScope === 'team';
  const mine = comms.budgets?.[teamBudget ? 'team' : meId];
  const outOfTime = budgetMs !== null && mine !== undefined && mine <= 0;
  const outOfSends = comms.sends !== undefined && comms.sends.left <= 0;
  const blocked = outOfTime || outOfSends;

  // Hold V to talk, unless typing somewhere.
  const held = useRef(false);
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'v' || e.repeat || held.current || blocked) return;
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
  }, [onRecord, onStop, blocked]);

  return (
    <div className="clip-bar">
      <RecordButton
        recording={recording}
        disabled={blocked}
        maxSeconds={rule.maxSeconds}
        onRecord={onRecord}
        onStop={onStop}
      >
        {outOfSends ? (
          'Out of sends'
        ) : outOfTime ? (
          'Out of mic time'
        ) : (
          <>
            🎙 Hold to talk<span className="key-hint"> (or V)</span>
          </>
        )}
      </RecordButton>

      {comms.sends && (
        <span className="sends" aria-label="Sends left">
          <strong>{comms.sends.left}</strong> of {comms.sends.total}{' '}
          {comms.sends.scope === 'team' ? 'team sends' : 'sends'} left · {rule.maxSeconds}s each
        </span>
      )}

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
              <span>{id === 'team' ? 'Team' : id === meId ? 'You' : nameOf(id)}</span>
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
  const playing = useRef(new Map<Playback, string>());
  const ended = useRef(false);

  // Stop everything when the round (and this component) ends.
  useEffect(() => {
    const current = playing.current;
    ended.current = false;
    return () => {
      ended.current = true;
      for (const playback of current.keys()) playback.stop();
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
      // Null while sound is still locked (no tap yet on a phone): the sound prompt covers it.
      const playback = await playClip(clip);
      if (!playback) return;
      if (ended.current) return playback.stop();
      current.set(playback, clip.from);
      report();
      await playback.done;
      current.delete(playback);
      report();
    };
    for (const clip of fresh) {
      play(clip).catch((error: unknown) => {
        console.warn('[clips] could not play a clip', error);
      });
    }
  }, [clips, onHearing]);

  return null;
}
