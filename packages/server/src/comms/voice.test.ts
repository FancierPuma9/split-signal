import type { CommsRule, MatchPhase } from '@split-signal/shared';
import { describe, expect, it } from 'vitest';
import { voicePeers } from './voice';

const players = ['r1', 'r2', 'b1', 'b2'];
const teams = [
  { id: 'red', playerIds: ['r1', 'r2'] },
  { id: 'blue', playerIds: ['b1', 'b2'] },
];

const peers = (phase?: MatchPhase, comms: CommsRule = { type: 'voice', scope: 'team' }) =>
  Object.fromEntries(
    voicePeers({ playerIds: players, match: phase ? { phase, comms, teams } : undefined }),
  );

describe('voicePeers', () => {
  it('connects everyone in the lobby', () => {
    expect(peers()).toEqual({
      r1: ['r2', 'b1', 'b2'],
      r2: ['r1', 'b1', 'b2'],
      b1: ['r1', 'r2', 'b2'],
      b2: ['r1', 'r2', 'b1'],
    });
  });

  it('keeps teams private between rounds', () => {
    for (const phase of ['intro', 'countdown', 'scoreboard'] as const) {
      expect(peers(phase, { type: 'none' })).toMatchObject({ r1: ['r2'], b1: ['b2'] });
    }
  });

  it('follows the puzzle rule while playing', () => {
    expect(peers('playing', { type: 'voice', scope: 'team' })).toMatchObject({
      r1: ['r2'],
      b2: ['b1'],
    });
    expect(peers('playing', { type: 'voice', scope: 'all' }).r1).toEqual(['r2', 'b1', 'b2']);
    for (const comms of [
      { type: 'none' },
      { type: 'signals', signals: ['up'] },
      { type: 'clips', maxSeconds: 5, direction: 'one-way' },
    ] as CommsRule[]) {
      expect(peers('playing', comms)).toEqual({ r1: [], r2: [], b1: [], b2: [] });
    }
  });

  it('opens up to everyone on the results screen', () => {
    expect(peers('finished', { type: 'none' }).r1).toEqual(['r2', 'b1', 'b2']);
  });
});
