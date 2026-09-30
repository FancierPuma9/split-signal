import { audioContext } from '@split-signal/puzzles/audio';

/** Quietest level reported, in dBFS (silence would be -Infinity). */
export const SILENCE_DB = -100;

/** Loudness in dBFS of a block of samples. */
export function levelDb(samples: Float32Array): number {
  let sum = 0;
  for (const s of samples) sum += s * s;
  const rms = Math.sqrt(sum / Math.max(1, samples.length));
  return rms > 0 ? Math.max(SILENCE_DB, 20 * Math.log10(rms)) : SILENCE_DB;
}

/**
 * Measures the mic's loudness every `everyMs` (a 100ms window by default) and reports it in dBFS.
 * Reads the mic track itself, so muting reads as silence.
 */
export function watchMicLevel(
  mic: MediaStream,
  onLevel: (db: number) => void,
  everyMs = 100,
): () => void {
  const ctx = audioContext();
  if (!ctx) return () => {};
  const source = ctx.createMediaStreamSource(mic);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  source.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  const timer = setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    onLevel(Math.round(levelDb(samples) * 10) / 10);
  }, everyMs);
  return () => {
    clearInterval(timer);
    source.disconnect();
    analyser.disconnect();
  };
}
