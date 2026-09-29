import { describe, expect, it } from 'vitest';
import { allowedSignals, describeComms } from './comms';
import { validateManifest, type PuzzleManifest } from './puzzle';

const base: PuzzleManifest = {
  id: 'some-puzzle',
  name: 'Some Puzzle',
  description: 'Does a thing.',
  teams: { min: 1, max: 3 },
  playersPerTeam: { min: 2, max: 4 },
  winCondition: 'race',
  timeLimitSeconds: 120,
  comms: { type: 'voice', scope: 'team' },
};

describe('validateManifest', () => {
  it('accepts a valid manifest', () => {
    expect(validateManifest(base)).toEqual([]);
  });

  it('flags bad ids, ranges, and limits', () => {
    const errors = validateManifest({
      ...base,
      id: 'Bad Id',
      teams: { min: 3, max: 2 },
      playersPerTeam: { min: 0, max: 2 },
      timeLimitSeconds: 0,
    });
    expect(errors).toHaveLength(4);
  });

  it('flags empty or duplicate signals', () => {
    expect(validateManifest({ ...base, comms: { type: 'signals', signals: [] } })).toHaveLength(1);
    expect(
      validateManifest({ ...base, comms: { type: 'signals', signals: ['up', 'up'] } }),
    ).toHaveLength(1);
  });
});

describe('comms helpers', () => {
  it('lists allowed signals per rule', () => {
    expect(allowedSignals({ type: 'signals', signals: ['up', 'down'] })).toEqual(['up', 'down']);
    expect(
      allowedSignals({
        type: 'clips',
        maxSeconds: 5,
        direction: 'one-way',
        extraSignals: ['repeat'],
      }),
    ).toEqual(['repeat']);
    expect(allowedSignals({ type: 'voice', scope: 'team' })).toEqual([]);
    expect(allowedSignals({ type: 'none' })).toEqual([]);
  });

  it('describes every rule', () => {
    expect(describeComms({ type: 'none' })).toMatch(/no communication/i);
    expect(describeComms({ type: 'signals', signals: ['nudge'] })).toContain('nudge');
  });
});
