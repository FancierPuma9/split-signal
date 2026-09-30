/**
 * How players may communicate during a puzzle. Declared by the puzzle manifest and enforced by the
 * server; the client never decides who it can talk to. A manifest may combine several rules (e.g.
 * signals plus one-way voice); see CommsSpec.
 */
export type CommsRule =
  /** Live voice. reportLevel: clients report their mic loudness to the puzzle (__micLevel). */
  | { type: 'voice'; scope: 'team' | 'all'; reportLevel?: boolean }
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
      /**
       * 'puzzle': the puzzle draws its own controls for these signals (e.g. only the unlocked
       * ones, or a hold button), so the shell shows no signal bar. Defaults to 'shell'.
       */
      buttons?: 'shell' | 'puzzle';
    }
  /**
   * Push-to-talk clips, routed by the puzzle's onClip. ring: each clip goes to the next seat in
   * team order (wrapping) unless onClip says otherwise. transform: the receiver's client scrambles
   * the clip (seeded) before playing it.
   */
  | {
      type: 'clips';
      maxSeconds: number;
      direction: 'one-way' | 'two-way' | 'ring';
      transform?: ClipTransform;
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
  /**
   * Push-to-talk clips on a budget for the round: seconds of mic time, a number of sends, or both.
   * budgetScope 'team' pools the budget for the whole team. With budgetSends, maxSeconds is a hard
   * cap per send: longer clips are cut off at playback and still cost a whole send.
   */
  | {
      type: 'budget-clips';
      maxSeconds: number;
      budgetSeconds?: number;
      budgetSends?: number;
      budgetScope?: 'player' | 'team';
      extraSignals?: string[];
    }
  /** Live team voice, one direction at a time; the server flips who is live on a seeded schedule. */
  | { type: 'voice-alternating'; swapIntervalMs: [number, number]; warningMs?: number }
  /** Live voice that the server shuts off openSeconds into the round. */
  | { type: 'voice-timed'; scope: 'team' | 'all'; openSeconds: number }
  /**
   * Strokes relayed to teammates and drawn with a fade. from 'role': only players whose view
   * has canDraw: true may draw.
   */
  | { type: 'draw'; fadeMs: number; from: 'any' | 'role'; extraSignals?: string[] }
  /** Team voice where the puzzle's commsState() decides who may talk (e.g. only one role). */
  | { type: 'voice-oneway'; scope: 'team' }
  /**
   * Voice whose sending and hearing the puzzle's commsState() switches per player (e.g. only while
   * standing still). Changes apply after they've held for debounceMs (default 300).
   */
  | { type: 'voice-gated'; scope: 'team' | 'all'; debounceMs?: number }
  /**
   * Open team voice, plus a client-side buffer of what each teammate said, which the puzzle can ask
   * a client to replay (commsState().replay). The server never receives the audio.
   */
  | { type: 'voice-replay'; scope: 'team'; vad: VadConfig; bufferSeconds: number };

/** One rule, or several applied together (at most one of each kind: voice, clips, signals, draw). */
export type CommsSpec = CommsRule | readonly CommsRule[];

/** How a receiver's client scrambles a clip before playing it. */
export type ClipTransform =
  /** Chop into fixed-length slices and play them in a seeded random order. */
  | { kind: 'shuffle'; sliceMs: number }
  /** Play the whole clip backwards. */
  | { kind: 'reverse' };

/** Voice activity detection for voice-replay: when a teammate's speech starts and stops. */
export interface VadConfig {
  /** Energy above this (dBFS) counts as speech. */
  thresholdDb: number;
  /** Speech must last this long to count as an utterance. */
  minUtteranceMs: number;
  /** This much quiet ends an utterance. */
  silenceMs: number;
}

export type ClipRuleType = 'clips' | 'delayed-clips' | 'budget-clips';
export type ClipRule = Extract<CommsRule, { type: ClipRuleType }>;

export const VOICE_RULE_TYPES = [
  'voice',
  'voice-timed',
  'voice-alternating',
  'voice-oneway',
  'voice-gated',
  'voice-replay',
] as const;
export type VoiceRule = Extract<CommsRule, { type: (typeof VOICE_RULE_TYPES)[number] }>;

export function isClipRule(rule: CommsRule): rule is ClipRule {
  return rule.type === 'clips' || rule.type === 'delayed-clips' || rule.type === 'budget-clips';
}

export function isVoiceRule(rule: CommsRule): rule is VoiceRule {
  return (VOICE_RULE_TYPES as readonly string[]).includes(rule.type);
}

/** The rules in a spec, as a list. */
export function commsRules(spec: CommsSpec): CommsRule[] {
  return Array.isArray(spec) ? [...(spec as readonly CommsRule[])] : [spec as CommsRule];
}

/** The rule of this type in a spec, if there is one. */
export function findRule<T extends CommsRule['type']>(
  spec: CommsSpec,
  type: T,
): Extract<CommsRule, { type: T }> | undefined {
  return commsRules(spec).find((r): r is Extract<CommsRule, { type: T }> => r.type === type);
}

/** The spec's clip rule (clips, delayed-clips or budget-clips), if any. */
export function clipRule(spec: CommsSpec): ClipRule | undefined {
  return commsRules(spec).find(isClipRule);
}

/** The spec's live voice rule, if any. */
export function voiceRule(spec: CommsSpec): VoiceRule | undefined {
  return commsRules(spec).find(isVoiceRule);
}

/** The discrete signals a player may send under this spec (empty if none). */
export function allowedSignals(spec: CommsSpec): string[] {
  const signals: string[] = [];
  for (const rule of commsRules(spec)) {
    switch (rule.type) {
      case 'signals':
        signals.push(...rule.signals);
        break;
      case 'clips':
      case 'delayed-clips':
      case 'budget-clips':
      case 'draw':
        signals.push(...(rule.extraSignals ?? []));
        break;
      default:
        break;
    }
  }
  return [...new Set(signals)];
}

const seconds = (ms: number) => `${Math.round(ms / 100) / 10}s`;

function describeRule(rule: CommsRule, combined: boolean): string {
  switch (rule.type) {
    case 'voice':
      return rule.scope === 'team'
        ? 'Voice: talk with your teammates'
        : 'Voice: everyone in the room can hear you';
    case 'none':
      return 'No communication at all';
    case 'signals':
      return `${combined ? 'Signals' : 'Signals only'}: ${rule.signals.join(', ')}`;
    case 'clips':
      return rule.direction === 'ring'
        ? `Recorded clips (up to ${rule.maxSeconds}s), passed one way round the team`
        : `Recorded clips only (up to ${rule.maxSeconds}s, ${rule.direction})`;
    case 'delayed-clips':
      return rule.delayRangeMs
        ? `Voice clips that arrive ${seconds(rule.delayRangeMs[0])}–${seconds(rule.delayRangeMs[1])} late, maybe out of order`
        : `Voice clips that arrive ${seconds(rule.delayMs ?? 0)} late`;
    case 'budget-clips': {
      const owner = rule.budgetScope === 'team' ? 'for the team' : 'each';
      const parts: string[] = [];
      if (rule.budgetSends !== undefined) {
        parts.push(`${rule.budgetSends} sends ${owner}, ${rule.maxSeconds}s max`);
      }
      if (rule.budgetSeconds !== undefined) {
        parts.push(`${rule.budgetSeconds}s of mic time ${owner}`);
      }
      return `Voice clips, ${parts.join(' and ')} for the whole round`;
    }
    case 'voice-alternating':
      return 'Voice, but only one of you can talk at a time';
    case 'voice-timed':
      return `Voice for the first ${rule.openSeconds}s, then silence`;
    case 'draw':
      return 'Fading ink only';
    case 'voice-oneway':
      return 'Voice one way only';
    case 'voice-gated':
      return 'Voice that switches on and off';
    case 'voice-replay':
      return 'Voice: talk with your teammate';
  }
}

/** Short human-readable summary, shown on the round intro screen. */
export function describeComms(spec: CommsSpec): string {
  const rules = commsRules(spec);
  return rules.map((r) => describeRule(r, rules.length > 1)).join(' · ');
}

function validateRule(rule: CommsRule | undefined, errors: string[]): void {
  const range = (label: string, r: unknown) => {
    if (!Array.isArray(r) || r.length !== 2 || !(r[0] >= 0) || !(r[1] >= r[0])) {
      errors.push(`${label} must be [min, max] with 0 <= min <= max`);
    }
  };
  const scope = (value: unknown, allowed: readonly string[]) => {
    if (!allowed.includes(value as string)) {
      errors.push(`voice scope must be ${allowed.map((s) => `'${s}'`).join(' or ')}`);
    }
  };
  switch (rule?.type) {
    case 'voice':
      scope(rule.scope, ['team', 'all']);
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
      if (!['one-way', 'two-way', 'ring'].includes(rule.direction)) {
        errors.push(`clips direction must be 'one-way', 'two-way' or 'ring'`);
      }
      if (rule.transform) {
        if (rule.transform.kind === 'shuffle') {
          if (!(rule.transform.sliceMs >= 50)) errors.push('shuffle sliceMs must be at least 50');
        } else if (rule.transform.kind !== 'reverse') {
          errors.push(`clip transform must be 'shuffle' or 'reverse'`);
        }
      }
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
      if (rule.budgetSeconds === undefined && rule.budgetSends === undefined) {
        errors.push('budget-clips needs budgetSeconds, budgetSends or both');
      }
      if (rule.budgetSeconds !== undefined && !(rule.budgetSeconds > 0)) {
        errors.push('budgetSeconds must be positive');
      }
      if (
        rule.budgetSends !== undefined &&
        !(Number.isInteger(rule.budgetSends) && rule.budgetSends > 0)
      ) {
        errors.push('budgetSends must be a positive integer');
      }
      if (rule.budgetScope !== undefined && !['player', 'team'].includes(rule.budgetScope)) {
        errors.push(`budgetScope must be 'player' or 'team'`);
      }
      break;
    case 'voice-alternating':
      range('swapIntervalMs', rule.swapIntervalMs);
      if (!(rule.swapIntervalMs[0] > 0)) errors.push('swapIntervalMs must be positive');
      break;
    case 'voice-timed':
      scope(rule.scope, ['team', 'all']);
      if (!(rule.openSeconds > 0)) errors.push('openSeconds must be positive');
      break;
    case 'draw':
      if (!(rule.fadeMs >= 0)) errors.push('fadeMs cannot be negative');
      if (rule.from !== 'any' && rule.from !== 'role')
        errors.push(`draw from must be 'any' or 'role'`);
      break;
    case 'voice-oneway':
      scope(rule.scope, ['team']);
      break;
    case 'voice-gated':
      scope(rule.scope, ['team', 'all']);
      if (rule.debounceMs !== undefined && !(rule.debounceMs >= 0)) {
        errors.push('debounceMs cannot be negative');
      }
      break;
    case 'voice-replay':
      scope(rule.scope, ['team']);
      if (!(rule.bufferSeconds > 0)) errors.push('bufferSeconds must be positive');
      if (
        !rule.vad ||
        !Number.isFinite(rule.vad.thresholdDb) ||
        !(rule.vad.minUtteranceMs >= 0) ||
        !(rule.vad.silenceMs > 0)
      ) {
        errors.push('voice-replay vad needs thresholdDb, minUtteranceMs >= 0 and silenceMs > 0');
      }
      break;
    default:
      errors.push('unknown comms type');
  }
}

/** Problems with a comms rule or combination of rules; empty means valid. */
export function validateComms(spec: CommsSpec | undefined): string[] {
  const errors: string[] = [];
  if (spec === undefined) return ['unknown comms type'];
  const rules = commsRules(spec);
  if (rules.length === 0) return ['comms needs at least one rule'];
  for (const rule of rules) validateRule(rule, errors);
  if (rules.length > 1) {
    const count = (test: (r: CommsRule) => boolean) => rules.filter(test).length;
    if (count((r) => r.type === 'none') > 0)
      errors.push(`'none' can't be combined with other rules`);
    if (count(isVoiceRule) > 1) errors.push('at most one voice rule');
    if (count(isClipRule) > 1) errors.push('at most one clip rule');
    if (count((r) => r.type === 'signals') > 1) errors.push('at most one signals rule');
    if (count((r) => r.type === 'draw') > 1) errors.push('at most one draw rule');
  }
  return errors;
}
