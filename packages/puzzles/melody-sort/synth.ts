// A tiny Web Audio synth: no audio files, and it only ever runs on the Listener's device.

let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  context ??= new AudioContext();
  if (context.state === 'suspended') void context.resume();
  return context;
}

const frequency = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** Plays a sequence of MIDI notes, one every `noteMs`. */
export function playMelody(pitches: readonly number[], noteMs: number): void {
  const ctx = audio();
  if (!ctx) return;
  const start = ctx.currentTime + 0.05;
  const length = (noteMs / 1000) * 0.8;
  pitches.forEach((pitch, i) => {
    const t = start + (i * noteMs) / 1000;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = frequency(pitch);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.3, t + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + length);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + length + 0.05);
  });
}
