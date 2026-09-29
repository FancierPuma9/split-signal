import { audioContext, decodeClip, ensureAudio } from '../lib/audio';
import type { Distortion } from './types';

// Applies Radio Tune's distortion to a clip and plays it, entirely in Web Audio. Kept as a
// standalone (clip, params) function so it could move server-side (e.g. ffmpeg) later.

function noiseBuffer(ctx: AudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  // Crackly radio static. Visual/audio noise only; nothing game-relevant depends on it.
  let seed = 12345;
  for (let i = 0; i < data.length; i++) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    data[i] = (seed / 0x7fffffff) * 2 - 1;
  }
  return buffer;
}

/** Thrown when sound is still locked: the player has to tap first (phones). */
export class AudioLockedError extends Error {}

/** Decodes a base64 clip, runs it through the distortion layers, and plays it. */
export async function playDistorted(data: string, params: Distortion): Promise<void> {
  // A suspended context never finishes playing, so don't start what can't be heard.
  if (!(await ensureAudio())) throw new AudioLockedError('Tap to turn on sound');
  const buffer = await decodeClip(data);
  const ctx = audioContext();
  if (!ctx) return;

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  // Pitch drift (detune on a buffer source also changes speed, which reads as "off-tuned").
  source.detune.value = params.pitch * 100;
  const duration = buffer.duration / 2 ** (params.pitch / 12);

  // Band: from wide open to a thin, telephone-like sliver.
  const band = ctx.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.value = 1400;
  band.Q.value = 0.2 + params.narrow * 14;

  // Chop: a square-wave LFO pumping the volume.
  const chop = ctx.createGain();
  chop.gain.value = 1 - 0.5 * params.chop;
  let lfo: OscillatorNode | null = null;
  if (params.chop > 0) {
    lfo = ctx.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 9;
    const depth = ctx.createGain();
    depth.gain.value = 0.5 * params.chop;
    lfo.connect(depth).connect(chop.gain);
  }

  // Makeup gain: a narrow band loses a lot of volume.
  const makeup = ctx.createGain();
  makeup.gain.value = 1 + params.narrow * 3;
  source.connect(band).connect(chop).connect(makeup).connect(ctx.destination);

  let noise: AudioBufferSourceNode | null = null;
  if (params.noise > 0) {
    noise = ctx.createBufferSource();
    noise.buffer = noiseBuffer(ctx);
    noise.loop = true;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = params.noise * 0.3;
    noise.connect(noiseGain).connect(ctx.destination);
  }

  const start = ctx.currentTime + 0.05;
  source.start(start);
  lfo?.start(start);
  noise?.start(start);
  lfo?.stop(start + duration);
  noise?.stop(start + duration);
  await new Promise<void>((resolve) => {
    source.onended = () => resolve();
  });
}
