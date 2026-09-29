/**
 * How players may communicate during a puzzle. Declared by the puzzle manifest and enforced by the
 * server; the client never decides who it can talk to.
 */
export type CommsRule =
  | { type: 'voice'; scope: 'team' | 'all' }
  | { type: 'none' }
  | { type: 'signals'; signals: string[]; cooldownMs?: number }
  | {
      type: 'clips';
      maxSeconds: number;
      direction: 'one-way' | 'two-way';
      extraSignals?: string[];
    };

/** The discrete signals a player may send under this rule (empty if none). */
export function allowedSignals(rule: CommsRule): string[] {
  switch (rule.type) {
    case 'signals':
      return [...rule.signals];
    case 'clips':
      return [...(rule.extraSignals ?? [])];
    case 'voice':
    case 'none':
      return [];
  }
}

/** Short human-readable summary, shown on the round intro screen. */
export function describeComms(rule: CommsRule): string {
  switch (rule.type) {
    case 'voice':
      return rule.scope === 'team'
        ? 'Voice: talk with your teammates'
        : 'Voice: everyone in the room can hear you';
    case 'none':
      return 'No communication at all';
    case 'signals':
      return `Signals only: ${rule.signals.join(', ')}`;
    case 'clips':
      return `Recorded clips only (up to ${rule.maxSeconds}s, ${rule.direction})`;
  }
}
