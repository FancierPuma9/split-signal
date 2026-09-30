import type { PuzzleAsset, PuzzleClientProps } from '@split-signal/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { audioContext, ensureAudio } from '../lib/audio';
import { useAssetBuffer } from '../lib/useAssetBuffer';
import styles from './client.module.css';
import type { Action, DiffToken, View } from './types';

type Props = PuzzleClientProps<View, Action>;

export default function Patchwork({ view, send, assets }: Props) {
  if (view.result) return <Result result={view.result} />;
  return (
    <div className={styles.root}>
      <p className={styles.hint}>
        You hear only your pieces of the sentence; the rest is noise.{' '}
        {view.partnerName ?? 'Your partner'} has the other pieces. Talk it through and type it
        together.
      </p>
      <Clip asset={assets[view.clip]} />
      <SharedText view={view} send={send} />
      <button
        className={styles.submit}
        disabled={view.submitted || view.text.trim() === ''}
        onClick={() => send({ type: 'submit' })}
      >
        {view.submitted ? 'Submitted' : 'Submit our sentence'}
      </button>
      <p className={styles.note}>
        Either of you can submit, and that ends your team&apos;s round. You score for every word you
        get right.
      </p>
    </div>
  );
}

const COLUMNS = 240;

/** Your half of the clip as a waveform: tap anywhere to play from there. */
function Clip({ asset }: { asset: PuzzleAsset | undefined }) {
  const buffer = useAssetBuffer(asset?.data);
  const canvas = useRef<HTMLCanvasElement>(null);
  const playing = useRef<{ source: AudioBufferSourceNode; startedAt: number; from: number } | null>(
    null,
  );
  const [progress, setProgress] = useState<number | null>(null);

  const peaks = useMemo(() => {
    if (!buffer || buffer === 'error') return null;
    const data = buffer.getChannelData(0);
    const per = Math.max(1, Math.floor(data.length / COLUMNS));
    return Array.from({ length: COLUMNS }, (_, i) => {
      let peak = 0;
      for (let j = i * per; j < Math.min(data.length, (i + 1) * per); j++) {
        peak = Math.max(peak, Math.abs(data[j] ?? 0));
      }
      return peak;
    });
  }, [buffer]);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx || !peaks) return;
    const { width, height } = el;
    ctx.clearRect(0, 0, width, height);
    const bar = width / COLUMNS;
    const max = Math.max(0.05, ...peaks);
    peaks.forEach((peak, i) => {
      const h = Math.max(2, (peak / max) * (height - 6));
      ctx.fillStyle = progress !== null && i / COLUMNS <= progress ? '#4cc9f0' : '#5b6270';
      ctx.fillRect(i * bar, (height - h) / 2, Math.max(1, bar - 1), h);
    });
  }, [peaks, progress]);

  // Stop when the round (and this component) ends.
  useEffect(
    () => () => {
      playing.current?.source.stop();
    },
    [],
  );

  const stop = () => {
    const current = playing.current;
    playing.current = null;
    current?.source.stop();
    setProgress(null);
  };

  const play = async (fromFraction: number) => {
    if (!buffer || buffer === 'error' || !(await ensureAudio())) return;
    const ctx = audioContext();
    if (!ctx) return;
    stop();
    const from = fromFraction * buffer.duration;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const entry = { source, startedAt: ctx.currentTime, from };
    playing.current = entry;
    source.onended = () => {
      if (playing.current === entry) stop();
    };
    source.start(0, from);
    const frame = () => {
      if (playing.current !== entry) return;
      setProgress(Math.min(1, (entry.from + ctx.currentTime - entry.startedAt) / buffer.duration));
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  };

  if (buffer === 'error') {
    return <p className={styles.error}>This device couldn&apos;t play the clip.</p>;
  }
  return (
    <div className={styles.clip}>
      <button
        className={styles.play}
        disabled={!buffer}
        onClick={() => (progress === null ? void play(0) : stop())}
      >
        {!buffer ? 'Loading…' : progress === null ? '▶ Play' : '■ Stop'}
      </button>
      <canvas
        ref={canvas}
        className={styles.wave}
        width={720}
        height={96}
        aria-label="Your half of the clip. Tap to play from a point."
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          void play(Math.max(0, Math.min(0.999, (e.clientX - rect.left) / rect.width)));
        }}
      />
    </div>
  );
}

/**
 * One text box for both players. It's uncontrolled: typing sends edits, and whatever the server
 * says the text is replaces it (keeping your caret in place), so the two of you can't diverge.
 */
function SharedText({ view, send }: { view: View; send: Props['send'] }) {
  const box = useRef<HTMLTextAreaElement>(null);
  const known = useRef(view.text);
  const composing = useRef(false);
  const lastCursor = useRef<number | null>(null);
  const cursorTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    const el = box.current;
    if (!el || el.value === view.text) {
      known.current = view.text;
      return;
    }
    const old = el.value;
    const focused = document.activeElement === el;
    const caret = el.selectionStart;
    let prefix = 0;
    while (prefix < old.length && prefix < view.text.length && old[prefix] === view.text[prefix]) {
      prefix += 1;
    }
    el.value = view.text;
    known.current = view.text;
    if (focused) {
      const at = caret <= prefix ? caret : caret + view.text.length - old.length;
      const clamped = Math.max(0, Math.min(view.text.length, at));
      el.setSelectionRange(clamped, clamped);
    }
  }, [view.text]);

  useEffect(() => () => clearTimeout(cursorTimer.current), []);

  const reportCursor = () => {
    clearTimeout(cursorTimer.current);
    cursorTimer.current = setTimeout(() => {
      const at = box.current?.selectionStart;
      if (at === undefined || at === lastCursor.current) return;
      lastCursor.current = at;
      send({ type: 'cursor', index: at });
    }, 150);
  };

  const sync = () => {
    const el = box.current;
    if (!el || composing.current) return;
    const before = known.current;
    const after = el.value;
    if (before === after) return;
    let prefix = 0;
    while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) {
      prefix += 1;
    }
    let suffix = 0;
    while (
      suffix < before.length - prefix &&
      suffix < after.length - prefix &&
      before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
    ) {
      suffix += 1;
    }
    const removed = before.length - prefix - suffix;
    const inserted = after.slice(prefix, after.length - suffix);
    if (removed > 0) send({ type: 'edit', op: 'delete', index: prefix, count: removed });
    if (inserted) send({ type: 'edit', op: 'insert', index: prefix, text: inserted });
    known.current = after;
    reportCursor();
  };

  const partner = view.partnerCursor;
  return (
    <div className={styles.editor}>
      {partner !== null && (
        // A copy of the text laid over the box, only to show where the partner's caret is.
        <div className={styles.mirror} aria-hidden="true">
          {view.text.slice(0, partner)}
          <span className={styles.partnerCaret} data-name={view.partnerName ?? ''} />
          {view.text.slice(partner)}
        </div>
      )}
      <textarea
        ref={box}
        className={styles.text}
        defaultValue={view.text}
        maxLength={view.maxLength}
        rows={3}
        spellCheck={false}
        disabled={view.submitted}
        placeholder="Type the sentence here, together"
        aria-label="Your team's sentence"
        onInput={sync}
        onCompositionStart={() => (composing.current = true)}
        onCompositionEnd={() => {
          composing.current = false;
          sync();
        }}
        onSelect={reportCursor}
      />
    </div>
  );
}

function Result({ result }: { result: NonNullable<View['result']> }) {
  return (
    <div className={styles.root}>
      <p className={styles.score}>
        <strong>{result.points}%</strong> of the sentence
      </p>
      <p className={styles.diff}>
        {result.diff.map((token, i) => (
          <Token key={i} token={token} />
        ))}
      </p>
      <p className={styles.note}>
        The sentence: <em>{result.truth}</em>
      </p>
      {result.guess.trim() && (
        <p className={styles.note}>
          You typed: <em>{result.guess}</em>
        </p>
      )}
    </div>
  );
}

function Token({ token }: { token: DiffToken }) {
  switch (token.kind) {
    case 'same':
      return <span className={styles.same}>{token.word} </span>;
    case 'wrong':
      return (
        <span className={styles.wrong} title={`You typed "${token.guess}"`}>
          {token.truth} <del>{token.guess}</del>{' '}
        </span>
      );
    case 'missing':
      return <span className={styles.missing}>{token.truth} </span>;
    case 'extra':
      return (
        <span className={styles.extra}>
          <del>{token.guess}</del>{' '}
        </span>
      );
  }
}
