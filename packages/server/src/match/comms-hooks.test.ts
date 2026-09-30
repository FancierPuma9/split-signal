import type { PuzzleServerModule, ServerMessage } from '@split-signal/shared';
import { describe, expect, it } from 'vitest';
import { voicePeers } from '../comms/voice';
import { inbox } from '../test/fixtures';
import { MatchEngine, type MatchTeam } from './match-engine';

const TIMINGS = { introMs: 100, countdownMs: 100, scoreboardMs: 100, defaultRaceGraceMs: 0 };

const teams: MatchTeam[] = [
  {
    id: 'red',
    name: 'Red',
    players: [
      { id: 'r1', name: 'R1', seat: 0 },
      { id: 'r2', name: 'R2', seat: 1 },
    ],
  },
];

interface State {
  quiet: string[];
  replay: { id: number; for: string } | null;
  levels: number[];
  misses: number[];
}

let assetBuilds = 0;

/** Exercises every batch 3 hook: signal refusal, commsState, replay, assets, shell actions. */
const hooks: PuzzleServerModule<State, State, { type: string; id?: number; db?: number }> = {
  manifest: {
    id: 'hooks',
    name: 'Hooks',
    description: 'Test puzzle.',
    teams: { min: 1, max: 2 },
    playersPerTeam: { min: 1, max: 3 },
    winCondition: 'race',
    timeLimitSeconds: 60,
    comms: [
      { type: 'signals', signals: ['ok', 'locked'], cooldownMs: 0 },
      { type: 'voice-gated', scope: 'team', debounceMs: 300 },
    ],
  },
  init: () => ({ quiet: [], replay: null, levels: [], misses: [] }),
  view: (state) => state,
  apply: (state, playerId, action) => {
    switch (action.type) {
      case 'hush':
        return { state: { ...state, quiet: [...state.quiet, playerId] } };
      case 'replay':
        return { state: { ...state, replay: { id: (state.replay?.id ?? 0) + 1, for: playerId } } };
      case '__micLevel':
        return { state: { ...state, levels: [...state.levels, action.db ?? 0] } };
      case '__replayMissed':
        return { state: { ...state, misses: [...state.misses, action.id ?? 0] } };
      default:
        return { reject: 'Unknown action' };
    }
  },
  onSignal: (state, _from, signal) =>
    signal === 'locked' ? { reject: 'Not unlocked yet' } : state,
  commsState: (state, playerId) => ({
    ...(state.quiet.includes(playerId) ? { send: false, receive: false } : {}),
    ...(state.replay?.for === playerId
      ? { replay: { id: state.replay.id, from: 'r2', windowStartMs: 0, windowEndMs: 1000 } }
      : {}),
  }),
  assets: () => ({
    clip: () => {
      assetBuilds += 1;
      return { mime: 'audio/wav', data: 'UklGRg==' };
    },
  }),
  isSolved: () => false,
  score: () => ({}),
};

function setup() {
  let now = 0;
  let stateChanges = 0;
  const boxes = new Map(['r1', 'r2'].map((id) => [id, inbox()]));
  const engine = new MatchEngine(
    { seed: 'seed', puzzles: [hooks], teams, timings: TIMINGS, now: () => now },
    {
      send: (id: string, m: ServerMessage) => boxes.get(id)?.send(m),
      onStateChange: () => (stateChanges += 1),
    },
  );
  const run = (ms: number) => {
    for (let t = 0; t < ms; t += 10) {
      now += 10;
      engine.tick();
    }
  };
  engine.start();
  run(200);
  return { engine, run, box: (id: string) => boxes.get(id)!, changes: () => stateChanges };
}

describe('MatchEngine: batch 3 comms hooks', () => {
  it('neither applies nor relays a signal the puzzle refuses, and tells the sender why', () => {
    const { engine, box } = setup();
    engine.handleSignal('r1', 'locked');
    expect(box('r2').all('comms.signal')).toHaveLength(0);
    expect(box('r1').last('match.reject')?.reason).toBe('Not unlocked yet');
    engine.handleSignal('r1', 'ok');
    expect(box('r2').last('comms.signal')).toMatchObject({ from: 'r1', signal: 'ok' });
  });

  it('applies commsState overrides to voice after the debounce', () => {
    const { engine, run, changes } = setup();
    engine.handleAction('r1', { type: 'hush' });
    expect(engine.voiceState().gates.r1).toBeUndefined();
    const before = changes();
    run(200);
    expect(engine.voiceState().gates.r1).toBeUndefined();
    run(150);
    expect(engine.voiceState().gates.r1).toEqual({ send: false, receive: false });
    expect(changes()).toBeGreaterThan(before);
  });

  it('sends each replay request once, straight away', () => {
    const { engine, box } = setup();
    engine.handleAction('r1', { type: 'replay' });
    expect(box('r1').all('comms.replay')).toEqual([
      { type: 'comms.replay', id: 1, from: 'r2', windowStartMs: 0, windowEndMs: 1000 },
    ]);
    engine.handleAction('r1', { type: 'hush' });
    expect(box('r1').all('comms.replay')).toHaveLength(1);
    expect(box('r2').all('comms.replay')).toHaveLength(0);
    // The client's miss report reaches the puzzle.
    engine.handleAction('r1', { type: '__replayMissed', id: 1 });
    expect(box('r1').last('match.view')?.view).toMatchObject({ misses: [1] });
  });

  it('sends each asset to each player once, building it only for players without it', () => {
    assetBuilds = 0;
    const { engine, box } = setup();
    expect(box('r1').all('match.asset')).toEqual([
      { type: 'match.asset', round: 0, id: 'clip', mime: 'audio/wav', data: 'UklGRg==' },
    ]);
    expect(box('r2').all('match.asset')).toHaveLength(1);
    engine.handleAction('r1', { type: 'hush' });
    expect(box('r1').all('match.asset')).toHaveLength(1);
    expect(assetBuilds).toBe(2);
    // A reconnect gets everything again.
    engine.playerDisconnected('r1');
    engine.playerReconnected('r1');
    expect(box('r1').all('match.asset')).toHaveLength(2);
  });

  it('rate-limits __micLevel and never shows rejections for shell actions', () => {
    const { engine, box, run } = setup();
    engine.handleAction('r1', { type: '__micLevel', db: -30 });
    engine.handleAction('r1', { type: '__micLevel', db: -20 });
    run(100);
    engine.handleAction('r1', { type: '__micLevel', db: -10 });
    expect(box('r1').last('match.view')?.view).toMatchObject({ levels: [-30, -10] });
    box('r1').clear();
    engine.handleAction('r1', { type: 'nonsense' });
    expect(box('r1').all('match.reject')).toHaveLength(1);
  });
});

describe('voicePeers with commsState gates', () => {
  const base = {
    playerIds: ['a', 'b', 'c'],
    match: {
      phase: 'playing' as const,
      comms: { type: 'voice', scope: 'all' } as const,
      teams: [
        { id: 'red', playerIds: ['a', 'b'] },
        { id: 'blue', playerIds: ['c'] },
      ],
    },
  };

  it('cuts both directions of a link and carries volume hints', () => {
    const peers = voicePeers({
      ...base,
      match: {
        ...base.match,
        gates: {
          a: { send: false },
          c: { peers: { a: { audible: false }, b: { audible: true, gain: 0.25 } } },
        },
      },
    });
    // a may not send: a sends to nobody, and nobody hears a.
    expect(peers.get('a')).toEqual([
      { id: 'b', send: false },
      { id: 'c', send: false },
    ]);
    expect(peers.get('b')).toContainEqual({ id: 'a', hear: false });
    // c can't hear a, and hears b quietly; b's link to c carries sound.
    expect(peers.get('c')).toEqual([
      { id: 'a', hear: false },
      { id: 'b', gain: 0.25 },
    ]);
    expect(peers.get('b')).toContainEqual({ id: 'c' });
  });

  it('ignores gates outside the playing phase', () => {
    const peers = voicePeers({
      ...base,
      match: { ...base.match, phase: 'scoreboard', gates: { a: { send: false } } },
    });
    expect(peers.get('a')).toEqual([{ id: 'b' }]);
  });
});
