import { unlockAudio } from '@split-signal/puzzles/audio';
import type { VadConfig } from '@split-signal/shared';
import { useEffect, useRef, useState } from 'react';
import { watchMicLevel } from '../voice/mic-level';
import { ReplayBuffer, type Utterance } from '../voice/replay';

const DEFAULTS: VadConfig = { thresholdDb: -40, minUtteranceMs: 250, silenceMs: 400 };
const start = performance.now();
const clock = () => performance.now() - start;
const secs = (ms: number) => (ms / 1000).toFixed(1);

/**
 * /dev/vad: tune voice-replay's speech detection without a puzzle. Your own mic stands in for a
 * teammate's stream; talk, watch what counts as an utterance, and play them back.
 */
export function VadLab() {
  const [mic, setMic] = useState<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vad, setVad] = useState(DEFAULTS);
  const [level, setLevel] = useState(-100);
  const [utterances, setUtterances] = useState<readonly Utterance[]>([]);
  const buffer = useRef<ReplayBuffer | null>(null);

  const startMic = async () => {
    unlockAudio();
    try {
      setMic(await navigator.mediaDevices.getUserMedia({ audio: true }));
    } catch {
      setError('Microphone access was refused.');
    }
  };

  useEffect(() => {
    if (!mic) return;
    return watchMicLevel(mic, setLevel);
  }, [mic]);

  useEffect(() => {
    if (!mic) return;
    const b = new ReplayBuffer(vad, 60, clock, () => setUtterances([...b.all()]));
    b.attach('you', mic);
    buffer.current = b;
    return () => {
      b.dispose();
      buffer.current = null;
    };
  }, [mic, vad]);

  const slider = (key: keyof VadConfig, label: string, min: number, max: number, step: number) => (
    <label className="vad-slider">
      <span>
        {label}: <strong>{vad[key]}</strong>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={vad[key]}
        onChange={(e) => setVad({ ...vad, [key]: Number(e.target.value) })}
      />
    </label>
  );

  const loud = level > vad.thresholdDb;
  return (
    <main className="main vad-lab">
      <h2>Voice activity lab</h2>
      <p className="muted">
        Tunes voice-replay&apos;s speech detection. Your own mic stands in for a teammate: talk,
        pause, and see what counts as one utterance. Changing a setting starts a fresh buffer.
      </p>
      {!mic ? (
        <button onClick={() => void startMic()}>Start the microphone</button>
      ) : (
        <>
          <div className="vad-meter" aria-label="Mic level">
            <span
              className={loud ? 'loud' : ''}
              style={{ width: `${Math.max(0, Math.min(100, level + 100))}%` }}
            />
            <i style={{ left: `${vad.thresholdDb + 100}%` }} />
          </div>
          <p className="small muted">
            {level.toFixed(1)} dBFS · {loud ? 'speech' : 'quiet'}
          </p>
          {slider('thresholdDb', 'Threshold (dBFS)', -80, -10, 1)}
          {slider('minUtteranceMs', 'Minimum utterance (ms)', 50, 1500, 50)}
          {slider('silenceMs', 'Silence that ends it (ms)', 100, 2000, 50)}
          <div className="vad-actions">
            <button
              className="secondary"
              onClick={() => buffer.current?.replay('you', clock() - 10_000, clock())}
            >
              Replay the longest of the last 10s
            </button>
          </div>
          <ol className="vad-list">
            {[...utterances].reverse().map((u) => (
              <li key={u.startMs}>
                <span>
                  {secs(u.startMs)}s → {secs(u.endMs)}s ({secs(u.endMs - u.startMs)}s)
                </span>
                <button className="link" onClick={() => buffer.current?.play(u)}>
                  Play
                </button>
              </li>
            ))}
          </ol>
        </>
      )}
      {error && <p className="error-box">{error}</p>}
    </main>
  );
}
