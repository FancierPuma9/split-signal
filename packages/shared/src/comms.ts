/**
 * How players may communicate during a puzzle. Declared by the puzzle manifest and enforced by the
 * server; the client never decides who it can talk to.
 */
export type CommsRule =
  | { type: 'voice'; scope: 'team' | 'all' }
  | { type: 'none' }
  | {
      type: 'signals';
      signals: string[];
      cooldownMs?: number;
      /**
       * false: signals are consumed by the puzzle's onSignal only and never relayed to anyone
       * (e.g. anonymous hints). Defaults to true.
       */
      relay?: boolean;
    }
  | {
      type: 'clips';
      maxSeconds: number;
      direction: 'one-way' | 'two-way';
      extraSignals?: string[];
    }
  /**
   * Push-to-talk clips delivered late: a fixed delayMs, or a per-clip delay drawn from
   * delayRangeMs by a seeded RNG (so clips can arrive out of order). Exactly one must be set.
   */
  | {
      type: 'delayed-clips';
      maxSeconds: number;
      delayMs?: number;
      delayRangeMs?: [number, number];
      extraSignals?: string[];
    }
  /** Push-to-talk clips with a per-player mic budget for the round. */
  | { type: 'budget-clips'; maxSeconds: number; budgetSeconds: number; extraSignals?: string[] }
  /** Live team voice, one direction at a time; the server flips who is live on a seeded schedule. */
  | { type: 'voice-alternating'; swapIntervalMs: [number, number]; warningMs?: number }
  /** Live voice that the server shuts off openSeconds into the round. */
  | { type: 'voice-timed'; scope: 'team' | 'all'; openSeconds: number }
  /**
   * Strokes relayed to teammates and drawn with a fade. from 'role': only players whose view
   * has canDraw: true may draw.
   */
  | { type: 'draw'; fadeMs: number; from: 'any' | 'role'; extraSignals?: string[] };

export type ClipRuleType = 'clips' | 'delayed-clips' | 'budget-clips';

export function isClipRule(rule: CommsRule): rule is Extract<CommsRule, { type: ClipRuleType }> {
  return rule.type === 'clips' || rule.type === 'delayed-clips' || rule.type === 'budget-clips';
}

/** The discrete signals a player may send under this rule (empty if none). */
export function allowedSignals(rule: CommsRule): string[] {
  switch (rule.type) {
    case 'signals':
      return [...rule.signals];
    case 'clips':
    case 'delayed-clips':
    case 'budget-clips':
    case 'draw':
      return [...(rule.extraSignals ?? [])];
    case 'voice':
    case 'none':
    case 'voice-alternating':
    case 'voice-timed':
      return [];
  }
}

const seconds = (ms: number) => `${Math.round(ms / 100) / 10}s`;

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
    case 'delayed-clips':
      return rule.delayRangeMs
        ? `Voice clips that arrive ${seconds(rule.delayRangeMs[0])}–${seconds(rule.delayRangeMs[1])} late, maybe out of order`
        : `Voice clips that arrive ${seconds(rule.delayMs ?? 0)} late`;
    case 'budget-clips':
      return `Voice clips, ${rule.budgetSeconds}s of mic time each for the whole round`;
    case 'voice-alternating':
      return 'Voice, but only one of you can talk at a time';
    case 'voice-timed':
      return `Voice for the first ${rule.openSeconds}s, then silence`;
    case 'draw':
      return 'Fading ink only';
  }
}

/** Problems with a comms rule; empty means valid. */
export function validateComms(rule: CommsRule | undefined): string[] {
  const errors: string[] = [];
  const range = (label: string, r: unknown) => {
    if (!Array.isArray(r) || r.length !== 2 || !(r[0] >= 0) || !(r[1] >= r[0])) {
      errors.push(`${label} must be [min, max] with 0 <= min <= max`);
    }
  };
  switch (rule?.type) {
    case 'voice':
      if (rule.scope !== 'team' && rule.scope !== 'all') {
        errors.push(`voice scope must be 'team' or 'all'`);
      }
      break;
    case 'none':
      break;
    case 'signals':
      if (rule.signals.length === 0) errors.push('signals comms needs at least one signal');
      if (new Set(rule.signals).size !== rule.signals.length) errors.push('signals must be unique');
      if (rule.cooldownMs !== undefined && rule.cooldownMs < 0) {
        errors.push('cooldownMs cannot be negative');
      }
      break;
    case 'clips':
      if (!(rule.maxSeconds > 0)) errors.push('clips maxSeconds must be positive');
      break;
    case 'delayed-clips':
      if (!(rule.maxSeconds > 0)) errors.push('clips maxSeconds must be positive');
      if ((rule.delayMs === undefined) === (rule.delayRangeMs === undefined)) {
        errors.push('delayed-clips needs exactly one of delayMs and delayRangeMs');
      }
      if (rule.delayMs !== undefined && !(rule.delayMs >= 0)) errors.push('delayMs must be >= 0');
      if (rule.delayRangeMs !== undefined) range('delayRangeMs', rule.delayRangeMs);
      break;
    case 'budget-clips':
      if (!(rule.maxSeconds > 0)) errors.push('clips maxSeconds must be positive');
      if (!(rule.budgetSeconds > 0)) errors.push('budgetSeconds must be positive');
      break;
    case 'voice-alternating':
      range('swapIntervalMs', rule.swapIntervalMs);
      if (!(rule.swapIntervalMs[0] > 0)) errors.push('swapIntervalMs must be positive');
      break;
    case 'voice-timed':
      if (rule.scope !== 'team' && rule.scope !== 'all') {
        errors.push(`voice scope must be 'team' or 'all'`);
      }
      if (!(rule.openSeconds > 0)) errors.push('openSeconds must be positive');
      break;
    case 'draw':
      if (!(rule.fadeMs >= 0)) errors.push('fadeMs cannot be negative');
      if (rule.from !== 'any' && rule.from !== 'role')
        errors.push(`draw from must be 'any' or 'role'`);
      break;
    default:
      errors.push('unknown comms type');
  }
  return errors;
}
