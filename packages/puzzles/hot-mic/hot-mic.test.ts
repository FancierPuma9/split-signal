import { createRng } from '@split-signal/shared';
import { describe, expect, it } from 'vitest';
import { runPuzzleScript, startPuzzle, type PuzzleDriver } from '../harness';
import { ANSWER, HAZARDS, LANE_LENGTH, generateLane } from './course';
import hotMic, { REVEAL, SPEED, STUN_MS, revealed } from './server';
import type { Action, State, View } from './types';

type Game = PuzzleDriver<State, View, Action>;

/** Holds Run for `ms`, the way the client does (a 'run' every 100ms). */
function run(game: Game, seat: number, ms: number) {
  for (let t = 0; t < ms; t += 100) {
    game.act(seat, { type: 'run' });
    game.advance(100);
  }
}

describe('hot mic lanes', () => {
  it('lays out 14-18 hazards at least two tiles apart, clear of start and finish', () => {
    const kinds = new Set<string>();
    for (const seed of ['a', 'b', 'c', 'd', 'e']) {
      const lane = generateLane(createRng(seed));
      expect(lane.length).toBeGreaterThanOrEqual(HAZARDS.min);
      expect(lane.length).toBeLessThanOrEqual(HAZARDS.max);
      lane.forEach((h, i) => {
        kinds.add(h.kind);
        expect(h.at).toBeGreaterThanOrEqual(5);
        expect(h.at).toBeLessThan(LANE_LENGTH);
        if (i > 0) expect(h.at - lane[i - 1]!.at).toBeGreaterThanOrEqual(2);
      });
      expect(generateLane(createRng(seed))).toEqual(lane);
    }
    expect(kinds.size).toBe(4);
  });
});

describe('hot mic', () => {
  it('shows you your partner’s next hazards and never your own', () => {
    const game = startPuzzle(hotMic, {
      players: 2,
      hidden: [
        {
          name: 'your own hazards',
          hiddenFrom: (p) => p.seat === 0,
          change: (s: State) => {
            const id = 'player-1';
            const r = s.runners[id]!;
            const lane = r.lane.map(
              (h) => ({ ...h, kind: h.kind === 'beam' ? 'hurdle' : 'beam' }) as const,
            );
            return { ...s, runners: { ...s.runners, [id]: { ...r, lane } } };
          },
        },
      ],
    });
    const view = game.view(0);
    expect(view.watched.name).toBe('Player 2');
    expect(view.watched.hazards.length).toBeGreaterThan(0);
    expect(view.watched.hazards.length).toBeLessThanOrEqual(REVEAL.hazards);
    for (const h of view.watched.hazards) expect(h.at).toBeLessThanOrEqual(REVEAL.tiles);
  });

  it('opens your mic and ears only while you stand still', () => {
    runPuzzleScript(hotMic, {
      players: 2,
      expectSolved: false,
      steps: [
        { seat: 0, expectComms: { send: true, receive: true } },
        { seat: 0, action: { type: 'run' } },
        { advance: 100 },
        { seat: 0, expectComms: { send: false, receive: false } },
        { seat: 1, expectComms: { send: true, receive: true } },
        // No 'run' for 300ms: stopped.
        { advance: 300 },
        { seat: 0, expectComms: { send: true, receive: true } },
        { seat: 0, action: { type: 'run' } },
        { advance: 100 },
        { seat: 0, action: { type: 'stop' } },
        { advance: 100 },
        { seat: 0, expectComms: { send: true } },
      ],
    });
  });

  it('runs at two tiles a second and stuns you for 5s at a hazard you didn’t answer', () => {
    const game = startPuzzle(hotMic, { players: 2 });
    const me = game.player(0).id;
    const first = game.state.runners[me]!.lane[0]!;
    run(game, 0, 1000);
    expect(game.state.runners[me]!.pos).toBeCloseTo(SPEED, 5);
    // Run straight into the first hazard.
    run(game, 0, ((first.at - SPEED) / SPEED) * 1000 + 200);
    const r = game.state.runners[me]!;
    expect(r.pos).toBe(first.at);
    expect(r.hits).toBe(1);
    expect(r.stunnedUntil).toBeGreaterThan(game.elapsedMs);
    const at = game.elapsedMs;
    run(game, 0, STUN_MS - 400);
    expect(game.state.runners[me]!.pos).toBe(first.at);
    run(game, 0, 1000);
    expect(game.state.runners[me]!.pos).toBeGreaterThan(first.at);
    expect(game.elapsedMs - at).toBeGreaterThanOrEqual(STUN_MS);
  });

  it('clears a hazard with the right move just before it', () => {
    const game = startPuzzle(hotMic, { players: 2 });
    const me = game.player(0).id;
    const first = game.state.runners[me]!.lane[0]!;
    // Stop half a tile short, make the move, run on.
    run(game, 0, ((first.at - 0.5) / SPEED) * 1000);
    game.act(0, { type: ANSWER[first.kind] });
    run(game, 0, 600);
    const r = game.state.runners[me]!;
    expect(r.hits).toBe(0);
    expect(r.passed).toContain(first.at);
    expect(r.pos).toBeGreaterThan(first.at);
    expect(revealed(r).every((h) => h.at > first.at)).toBe(true);
  });

  it('finishes when everyone is over the line', () => {
    const game = startPuzzle(hotMic, { players: 2 });
    for (const seat of [0, 1]) {
      const id = game.player(seat).id;
      for (let guard = 0; guard < 2000 && game.state.runners[id]!.finishedAt === null; guard++) {
        const r = game.state.runners[id]!;
        const next = r.lane.find((h) => h.at > r.pos && !r.passed.includes(h.at));
        if (
          next &&
          next.at - r.pos <= 0.4 &&
          (!r.lastMove || game.elapsedMs - r.lastMove.at > 600)
        ) {
          game.act(seat, { type: ANSWER[next.kind] });
        }
        run(game, seat, 100);
      }
      expect(game.state.runners[id]!.hits).toBe(0);
    }
    expect(game.solved).toBe(true);
    expect(game.score().elapsedMs).toBeGreaterThan(0);
  });

  it('watches round a ring of three', () => {
    const game = startPuzzle(hotMic, { players: 3 });
    expect(game.view(0).watched.name).toBe('Player 2');
    expect(game.view(2).watched.name).toBe('Player 1');
  });
});
