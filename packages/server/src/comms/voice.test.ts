import type { CommsRule, MatchPhase } from '@split-signal/shared';
import { describe, expect, it } from 'vitest';
import { voicePeers, type VoiceInputs } from './voice';

const players = ['r1', 'r2', 'b1', 'b2'];
const teams = [
  { id: 'red', playerIds: ['r1', 'r2'] },
  { id: 'blue', playerIds: ['b1', 'b2'] },
];

const peers = (
  phase?: MatchPhase,
  comms: CommsRule = { type: 'voice', scope: 'team' },
  extra: Partial<NonNullable<VoiceInputs['match']>> = {},
) =>
  Object.fromEntries(
    [
      ...voicePeers({
        playerIds: players,
        match: phase ? { phase, comms, teams, ...extra } : undefined,
      }),
    ].map(([id, links]) => [id, links.map((l) => l.id)]),
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
      { type: 'draw', fadeMs: 1000, from: 'any' },
      { type: 'delayed-clips', maxSeconds: 5, delayMs: 5000 },
    ] as CommsRule[]) {
      expect(peers('playing', comms)).toEqual({ r1: [], r2: [], b1: [], b2: [] });
    }
  });

  it('opens up to everyone on the results screen', () => {
    expect(peers('finished', { type: 'none' }).r1).toEqual(['r2', 'b1', 'b2']);
  });

  it('closes timed voice when the window ends', () => {
    const rule: CommsRule = { type: 'voice-timed', scope: 'team', openSeconds: 10 };
    expect(peers('playing', rule, { voiceOpen: true }).r1).toEqual(['r2']);
    expect(peers('playing', rule, { voiceOpen: false }).r1).toEqual([]);
  });

  it('lets only the live player send under alternating voice', () => {
    const rule: CommsRule = { type: 'voice-alternating', swapIntervalMs: [1000, 2000] };
    const links = voicePeers({
      playerIds: players,
      match: { phase: 'playing', comms: rule, teams, activeByTeam: { red: 'r1', blue: 'b2' } },
    });
    expect(links.get('r1')).toEqual([{ id: 'r2', hear: false }]);
    expect(links.get('r2')).toEqual([{ id: 'r1', send: false }]);
    expect(links.get('b2')).toEqual([{ id: 'b1', hear: false }]);
  });
});
