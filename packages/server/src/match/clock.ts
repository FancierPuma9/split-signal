/** A millisecond clock that can be paused. Timers built on it freeze while a match is paused. */
export class PausableClock {
  private readonly source: () => number;
  private readonly origin: number;
  private pausedTotal = 0;
  private pausedAt: number | null = null;

  constructor(source: () => number) {
    this.source = source;
    this.origin = source();
  }

  /** Running time since creation, excluding paused time. */
  now(): number {
    return (this.pausedAt ?? this.source()) - this.origin - this.pausedTotal;
  }

  get paused(): boolean {
    return this.pausedAt !== null;
  }

  pause(): void {
    if (this.pausedAt === null) this.pausedAt = this.source();
  }

  resume(): void {
    if (this.pausedAt === null) return;
    this.pausedTotal += this.source() - this.pausedAt;
    this.pausedAt = null;
  }
}
