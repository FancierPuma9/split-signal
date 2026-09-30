import { audioContext, playPcm } from '@split-signal/puzzles/audio';
import type { VadConfig } from '@split-signal/shared';
import { levelDb } from './mic-level';

/** One stretch of speech from one teammate, with round times (ms). */
export interface Utterance {
  from: string;
  startMs: number;
  endMs: number;
  pcm: Float32Array;
  sampleRate: number;
}

/** Longest single utterance kept; anything longer is cut into pieces. */
const MAX_UTTERANCE_MS = 12_000;
const CHUNK = 2048;

interface Listening {
  source: MediaStreamAudioSourceNode;
  processor: ScriptProcessorNode;
  sink: GainNode;
  inSpeech: boolean;
  speechMs: number;
  silenceMs: number;
  /** Quiet-to-loud lead-in, so an utterance starts where the speech did. */
  preRoll: Float32Array[];
  current: Float32Array[];
  startMs: number;
}

/**
 * voice-replay's client half: voice activity detection on each teammate's incoming stream, a
 * rolling buffer of what they said (round-timed), and playback of the longest utterance inside a
 * window the server names. The server never gets the audio.
 */
export class ReplayBuffer {
  private readonly listening = new Map<string, Listening>();
  private utterances: Utterance[] = [];
  private readonly vad: VadConfig;
  private readonly keepMs: number;
  private readonly clock: () => number;
  private readonly onChange: (() => void) | undefined;

  /** clock: round time in ms now. onChange: called when an utterance is added (dev page). */
  constructor(vad: VadConfig, bufferSeconds: number, clock: () => number, onChange?: () => void) {
    this.vad = vad;
    this.keepMs = bufferSeconds * 1000;
    this.clock = clock;
    this.onChange = onChange;
  }

  /** Starts listening to a teammate's stream (replacing any earlier one of theirs). */
  attach(from: string, stream: MediaStream): void {
    this.detach(from);
    const ctx = audioContext();
    if (!ctx) return;
    const source = ctx.createMediaStreamSource(stream);
    // ScriptProcessor is deprecated but runs everywhere without a separate worklet file.
    const processor = ctx.createScriptProcessor(CHUNK, 1, 1);
    const sink = ctx.createGain();
    sink.gain.value = 0; // it only needs to be pulled, never heard
    source.connect(processor);
    processor.connect(sink).connect(ctx.destination);
    const state: Listening = {
      source,
      processor,
      sink,
      inSpeech: false,
      speechMs: 0,
      silenceMs: 0,
      preRoll: [],
      current: [],
      startMs: 0,
    };
    processor.onaudioprocess = (event) => {
      this.process(from, state, event.inputBuffer.getChannelData(0).slice(), ctx.sampleRate);
    };
    this.listening.set(from, state);
  }

  detach(from: string): void {
    const state = this.listening.get(from);
    if (!state) return;
    state.processor.onaudioprocess = null;
    state.source.disconnect();
    state.processor.disconnect();
    state.sink.disconnect();
    this.listening.delete(from);
  }

  dispose(): void {
    for (const from of [...this.listening.keys()]) this.detach(from);
    this.utterances = [];
  }

  /** Everything buffered, oldest first (for the dev page). */
  all(): readonly Utterance[] {
    return this.utterances;
  }

  /**
   * Plays the longest utterance from `from` that lies wholly inside the window, at `gain`.
   * Returns false if there was none (or sound is locked).
   */
  replay(from: string, windowStartMs: number, windowEndMs: number, gain = 1): boolean {
    const candidates = this.utterances.filter(
      (u) => u.from === from && u.startMs >= windowStartMs && u.endMs <= windowEndMs,
    );
    const best = candidates.reduce<Utterance | null>(
      (a, b) => (a && a.endMs - a.startMs >= b.endMs - b.startMs ? a : b),
      null,
    );
    return best !== null && playPcm(best.pcm, best.sampleRate, gain) !== null;
  }

  /** Plays one buffered utterance (dev page). */
  play(utterance: Utterance): void {
    playPcm(utterance.pcm, utterance.sampleRate);
  }

  private process(from: string, s: Listening, chunk: Float32Array, rate: number): void {
    const chunkMs = (chunk.length / rate) * 1000;
    const now = this.clock();
    const loud = levelDb(chunk) > this.vad.thresholdDb;

    if (!s.inSpeech) {
      s.preRoll.push(chunk);
      const keep = Math.ceil(this.vad.minUtteranceMs / chunkMs) + 1;
      if (s.preRoll.length > keep) s.preRoll.splice(0, s.preRoll.length - keep);
      s.speechMs = loud ? s.speechMs + chunkMs : 0;
      if (s.speechMs >= this.vad.minUtteranceMs && s.speechMs > 0) {
        const lead = Math.ceil(s.speechMs / chunkMs);
        s.current = s.preRoll.slice(-lead);
        s.startMs = now - s.current.length * chunkMs;
        s.inSpeech = true;
        s.silenceMs = 0;
        s.preRoll = [];
      }
      return;
    }

    s.current.push(chunk);
    s.silenceMs = loud ? 0 : s.silenceMs + chunkMs;
    const lengthMs = s.current.length * chunkMs;
    if (s.silenceMs >= this.vad.silenceMs || lengthMs >= MAX_UTTERANCE_MS) {
      // Trim the trailing quiet that ended it.
      const trailing = Math.min(s.current.length - 1, Math.floor(s.silenceMs / chunkMs));
      const kept = s.current.slice(0, s.current.length - trailing);
      const pcm = new Float32Array(kept.reduce((n, c) => n + c.length, 0));
      let at = 0;
      for (const c of kept) {
        pcm.set(c, at);
        at += c.length;
      }
      this.utterances.push({
        from,
        startMs: s.startMs,
        endMs: s.startMs + kept.length * chunkMs,
        pcm,
        sampleRate: rate,
      });
      this.utterances = this.utterances.filter((u) => u.endMs >= now - this.keepMs);
      s.inSpeech = false;
      s.speechMs = 0;
      s.silenceMs = 0;
      s.current = [];
      this.onChange?.();
    }
  }
}
