import { describe, expect, it } from 'vitest';
import {
  allowedSignals,
  clipRule,
  commsRules,
  describeComms,
  findRule,
  validateComms,
  voiceRule,
  type CommsSpec,
} from './comms';
import { isSignalReject } from './puzzle';

const dictionary: CommsSpec = [
  { type: 'signals', signals: ['BOOM', 'DING'], cooldownMs: 250, buttons: 'puzzle' },
  { type: 'voice-oneway', scope: 'team' },
];

describe('rule composition', () => {
  it('treats a single rule and a list alike', () => {
    expect(commsRules({ type: 'none' })).toEqual([{ type: 'none' }]);
    expect(commsRules(dictionary)).toHaveLength(2);
  });

  it('finds each kind of rule in a combination', () => {
    expect(findRule(dictionary, 'signals')?.cooldownMs).toBe(250);
    expect(voiceRule(dictionary)?.type).toBe('voice-oneway');
    expect(clipRule(dictionary)).toBeUndefined();
    expect(allowedSignals(dictionary)).toEqual(['BOOM', 'DING']);
    expect(
      allowedSignals([
        { type: 'signals', signals: ['a'] },
        { type: 'budget-clips', maxSeconds: 2, budgetSends: 3, extraSignals: ['a', 'b'] },
      ]),
    ).toEqual(['a', 'b']);
  });

  it('describes every rule in a combination', () => {
    expect(describeComms(dictionary)).toBe('Signals: BOOM, DING · Voice one way only');
    expect(describeComms({ type: 'signals', signals: ['up'] })).toBe('Signals only: up');
    expect(
      describeComms({ type: 'budget-clips', maxSeconds: 2, budgetSends: 12, budgetScope: 'team' }),
    ).toBe('Voice clips, 12 sends for the team, 2s max for the whole round');
  });

  it('allows at most one rule of each kind, and no "none" in a combination', () => {
    expect(validateComms(dictionary)).toEqual([]);
    expect(validateComms([])).toEqual(['comms needs at least one rule']);
    expect(
      validateComms([
        { type: 'voice', scope: 'team' },
        { type: 'voice-gated', scope: 'team' },
      ]),
    ).toContain('at most one voice rule');
    expect(validateComms([{ type: 'none' }, { type: 'signals', signals: ['x'] }])).toContain(
      `'none' can't be combined with other rules`,
    );
  });
});

describe('batch 3 rules', () => {
  it('validates ring clips and transforms', () => {
    expect(
      validateComms({
        type: 'clips',
        maxSeconds: 5,
        direction: 'ring',
        transform: { kind: 'shuffle', sliceMs: 600 },
      }),
    ).toEqual([]);
    expect(
      validateComms({
        type: 'clips',
        maxSeconds: 5,
        direction: 'ring',
        transform: { kind: 'shuffle', sliceMs: 10 },
      }),
    ).toContain('shuffle sliceMs must be at least 50');
  });

  it('needs some kind of budget for budget-clips', () => {
    expect(validateComms({ type: 'budget-clips', maxSeconds: 2 })).toContain(
      'budget-clips needs budgetSeconds, budgetSends or both',
    );
    expect(validateComms({ type: 'budget-clips', maxSeconds: 2, budgetSends: 1.5 })).toContain(
      'budgetSends must be a positive integer',
    );
    expect(validateComms({ type: 'budget-clips', maxSeconds: 5, budgetSeconds: 30 })).toEqual([]);
  });

  it('validates the new voice rules', () => {
    expect(validateComms({ type: 'voice-gated', scope: 'team', debounceMs: 300 })).toEqual([]);
    expect(validateComms({ type: 'voice-gated', scope: 'team', debounceMs: -1 })).toContain(
      'debounceMs cannot be negative',
    );
    expect(
      validateComms({
        type: 'voice-replay',
        scope: 'team',
        vad: { thresholdDb: -40, minUtteranceMs: 250, silenceMs: 400 },
        bufferSeconds: 60,
      }),
    ).toEqual([]);
    expect(
      validateComms({
        type: 'voice-replay',
        scope: 'team',
        vad: { thresholdDb: -40, minUtteranceMs: 250, silenceMs: 0 },
        bufferSeconds: 60,
      }),
    ).toHaveLength(1);
  });
});

describe('isSignalReject', () => {
  it('only recognises a lone { reject } object', () => {
    expect(isSignalReject({ reject: 'nope' })).toBe(true);
    expect(isSignalReject({ reject: 'nope', score: 1 })).toBe(false);
    expect(isSignalReject({ score: 1 })).toBe(false);
    expect(isSignalReject(null)).toBe(false);
  });
});
