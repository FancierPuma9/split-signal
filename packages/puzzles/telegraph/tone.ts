import { audioContext } from '../lib/audio';

/** A steady beep that lasts exactly as long as it's held, like a telegraph key. */
export class Tone {
  private osc: OscillatorNode | null = null;
  private level: GainNode | null = null;
  private safety: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly frequency = 660,
    private readonly volume = 0.25,
  ) {}

  start(): void {
    const ctx = audioContext();
    if (!ctx || this.osc) return;
    const osc = ctx.createOscillator();
    const level = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = this.frequency;
    level.gain.setValueAtTime(0, ctx.currentTime);
    level.gain.linearRampToValueAtTime(this.volume, ctx.currentTime + 0.005);
    osc.connect(level).connect(ctx.destination);
    osc.start();
    this.osc = osc;
    this.level = level;
    // A lost 'up' mustn't leave it beeping forever.
    this.safety = setTimeout(() => this.stop(), 8000);
  }

  stop(): void {
    clearTimeout(this.safety);
    const ctx = audioContext();
    const { osc, level } = this;
    this.osc = null;
    this.level = null;
    if (!ctx || !osc || !level) return;
    level.gain.setValueAtTime(level.gain.value, ctx.currentTime);
    level.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.005);
    osc.stop(ctx.currentTime + 0.01);
  }

  get on(): boolean {
    return this.osc !== null;
  }
}
