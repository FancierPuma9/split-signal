import type { ClipRouting, CommsRule, CommsSpec, ServerMessage } from '@split-signal/shared';
import { describe, expect, it } from 'vitest';
import { inbox } from '../test/fixtures';
import { CommsController } from './controller';

const teams = [
  {
    id: 'red',
    players: [
      { id: 'r1', seat: 0 },
      { id: 'r2', seat: 1 },
    ],
  },
  {
    id: 'blue',
    players: [
      { id: 'b1', seat: 0 },
      { id: 'b2', seat: 1 },
    ],
  },
];

function setup(
  rule: CommsSpec,
  extra: {
    routeClip?: (teamId: string, from: string) => ClipRouting | null;
    canDraw?: (teamId: string, id: string) => boolean;
    teams?: typeof teams;
  } = {},
) {
  let now = 1000;
  const roster = extra.teams ?? teams;
  const boxes = new Map(roster.flatMap((t) => t.players).map((p) => [p.id, inbox()]));
  const changes: string[][] = [];
  const controller = new CommsController({
    comms: rule,
    seed: 'seed',
    puzzleId: 'test',
    teams: roster,
    now: () => now,
    send: (id: string, m: ServerMessage) => boxes.get(id)?.send(m),
    routeClip: extra.routeClip ?? (() => null),
    canDraw: extra.canDraw ?? (() => true),
    onChange: (ids) => changes.push(ids),
  });
  controller.begin();
  const box = (id: string) => boxes.get(id)!;
  const run = (ms: number) => {
    for (let t = 0; t < ms; t += 100) {
      now += 100;
      controller.tick();
    }
  };
  return { controller, box, run, changes, advance: (ms: number) => (now += ms) };
}

const clip = (durationMs: number, data = 'AAAA') => ({ mime: 'audio/webm', data, durationMs });

describe('CommsController: delayed clips', () => {
  it('holds each clip until `delay` after the speaker started talking', () => {
    const { controller, box, run, advance } = setup({
      type: 'delayed-clips',
      maxSeconds: 5,
      delayMs: 5000,
    });
    advance(5000); // a clip can't have started before the round did
    expect(controller.handleClip('r1', clip(2000))).toBeNull();
    expect(box('r2').all('comms.clip')).toHaveLength(0);
    expect(box('r1').last('comms.state')?.state.pendingDeliveries).toBe(1);
    run(2900);
    expect(box('r2').all('comms.clip')).toHaveLength(0);
    run(100);
    expect(box('r2').last('comms.clip')).toMatchObject({ from: 'r1', params: {} });
    expect(box('r1').last('comms.state')?.state.pendingDeliveries).toBe(0);
    expect(box('b1').all('comms.clip')).toHaveLength(0); // other team never hears it
  });

  it('draws jittered delays from a seeded sequence, so clips can arrive out of order', () => {
    const rule: CommsRule = { type: 'delayed-clips', maxSeconds: 5, delayRangeMs: [2000, 8000] };
    const a = setup(rule);
    const b = setup(rule);
    const arrivals = (s: ReturnType<typeof setup>, sender: string, listener: string) => {
      s.controller.handleClip(sender, clip(500, 'AAAA'));
      s.advance(2000);
      s.controller.handleClip(sender, clip(500, 'BBBB'));
      s.advance(2000);
      s.controller.handleClip(sender, clip(500, 'CCCC'));
      s.run(10_000);
      return s
        .box(listener)
        .all('comms.clip')
        .map((c) => c.data);
    };
    const red = arrivals(a, 'r1', 'r2');
    expect(red.sort()).toEqual(['AAAA', 'BBBB', 'CCCC']);
    // Same seat on another team (or another room with the same seed) gets the same delays.
    expect(arrivals(b, 'b1', 'b2')).toEqual(arrivals(setup(rule), 'b1', 'b2'));
  });

  it('enforces the clip length and a cooldown', () => {
    const { controller, advance } = setup({ type: 'delayed-clips', maxSeconds: 5, delayMs: 5000 });
    expect(controller.handleClip('r1', clip(9000))).toMatch(/at most 5 seconds/);
    expect(controller.handleClip('r1', clip(1000))).toBeNull();
    expect(controller.handleClip('r1', clip(1000))).toMatch(/Wait/);
    advance(2000);
    expect(controller.handleClip('r1', clip(1000))).toBeNull();
  });
});

describe('CommsController: budget clips', () => {
  it('deducts mic time, shows it to the team, and truncates the last clip', () => {
    const { controller, box, advance } = setup({
      type: 'budget-clips',
      maxSeconds: 5,
      budgetSeconds: 6,
    });
    expect(box('r2').last('comms.state')?.state.budgets).toEqual({ r1: 6000, r2: 6000 });
    controller.handleClip('r1', clip(4000));
    expect(box('r2').last('comms.clip')?.params).toEqual({});
    expect(box('r2').last('comms.state')?.state.budgets).toEqual({ r1: 2000, r2: 6000 });
    advance(3000);
    controller.handleClip('r1', clip(3500));
    expect(box('r2').last('comms.clip')?.params).toEqual({ playMs: 2000 });
    advance(3000);
    expect(controller.handleClip('r1', clip(500))).toMatch(/out of mic time/);
  });
});

describe('CommsController: alternating voice', () => {
  const rule: CommsRule = { type: 'voice-alternating', swapIntervalMs: [2000, 4000] };

  it('swaps who is live on a seeded schedule, the same for every team', () => {
    const { controller, run, changes } = setup(rule);
    const first = controller.voice().activeByTeam;
    expect(first.red === 'r1' || first.red === 'r2').toBe(true);
    expect(first.blue).toBe(first.red === 'r1' ? 'b1' : 'b2'); // same seat live on both teams
    run(4000);
    const second = controller.voice().activeByTeam;
    expect(second.red).not.toBe(first.red);
    expect(changes.length).toBeGreaterThan(0);
    expect(controller.contextFor('red').activePlayerId).toBe(second.red);
  });

  it('announces the next swap only when warningMs is set', () => {
    const quiet = setup(rule);
    quiet.run(4500);
    expect(
      quiet
        .box('r1')
        .all('comms.state')
        .some((m) => m.state.swapInMs !== undefined),
    ).toBe(false);
    const loud = setup({ ...rule, warningMs: 1000 });
    loud.run(4500);
    expect(
      loud
        .box('r1')
        .all('comms.state')
        .some((m) => (m.state.swapInMs ?? -1) >= 0),
    ).toBe(true);
  });
});

describe('CommsController: timed voice', () => {
  it('closes voice after openSeconds', () => {
    const { controller, box, run, changes } = setup({
      type: 'voice-timed',
      scope: 'team',
      openSeconds: 2,
    });
    expect(controller.voice().open).toBe(true);
    expect(box('r1').last('comms.state')?.state.voiceRemainingMs).toBe(2000);
    run(2000);
    expect(controller.voice().open).toBe(false);
    expect(changes).toHaveLength(1);
    expect(box('r1').last('comms.state')?.state.voiceRemainingMs).toBe(0);
  });
});

describe('CommsController: draw stream', () => {
  const batch = { strokeId: 's', points: [{ x: 0.5, y: 0.5, dt: 0 }], done: false };

  it('relays strokes to teammates only, from players allowed to draw', () => {
    const { controller, box } = setup(
      { type: 'draw', fadeMs: 1000, from: 'role' },
      { canDraw: (_team, id) => id === 'r1' },
    );
    controller.handleDraw('r1', batch);
    expect(box('r2').last('comms.draw')).toEqual({ type: 'comms.draw', from: 'r1', batch });
    expect(box('r1').all('comms.draw')).toHaveLength(0);
    expect(box('b1').all('comms.draw')).toHaveLength(0);
    controller.handleDraw('r2', batch);
    expect(box('r1').all('comms.draw')).toHaveLength(0);
  });

  it('rate-limits floods', () => {
    const { controller, box } = setup({ type: 'draw', fadeMs: 1000, from: 'any' });
    for (let i = 0; i < 60; i++) controller.handleDraw('r1', batch);
    expect(box('r2').all('comms.draw').length).toBeLessThanOrEqual(25);
  });
});

const trio = [
  {
    id: 'red',
    players: [
      { id: 'r1', seat: 0 },
      { id: 'r2', seat: 1 },
      { id: 'r3', seat: 2 },
    ],
  },
];

describe('CommsController: ring clips', () => {
  it('sends each clip to the next seat only, wrapping, and tells players their neighbours', () => {
    const { controller, box, advance } = setup(
      { type: 'clips', maxSeconds: 5, direction: 'ring' },
      { teams: trio },
    );
    expect(controller.handleClip('r1', clip(1000))).toBeNull();
    expect(box('r2').all('comms.clip')).toHaveLength(1);
    expect(box('r3').all('comms.clip')).toHaveLength(0);
    advance(3000);
    expect(controller.handleClip('r3', clip(1000))).toBeNull();
    expect(box('r1').last('comms.clip')?.from).toBe('r3');
    expect(box('r2').last('comms.state')?.state.ring).toEqual({ next: 'r3', prev: 'r1' });
  });

  it('adds a seeded transform to every delivery', () => {
    const { controller, box } = setup(
      {
        type: 'clips',
        maxSeconds: 5,
        direction: 'ring',
        transform: { kind: 'shuffle', sliceMs: 600 },
      },
      { teams: trio },
    );
    controller.handleClip('r2', clip(1000));
    const params = box('r3').last('comms.clip')?.params as Record<string, unknown>;
    expect(params.transform).toEqual({ kind: 'shuffle', sliceMs: 600 });
    expect(typeof params.transformSeed).toBe('string');
  });
});

describe('CommsController: send budgets', () => {
  it('pools sends for the team, caps each send hard, and refuses at zero', () => {
    const { controller, box, advance } = setup(
      { type: 'budget-clips', maxSeconds: 2, budgetSends: 2, budgetScope: 'team' },
      { teams: trio },
    );
    expect(box('r3').last('comms.state')?.state.sends).toEqual({
      left: 2,
      total: 2,
      scope: 'team',
    });
    // Too long: still sent, cut off at 2s, and a whole send.
    expect(controller.handleClip('r1', clip(3500))).toBeNull();
    expect(box('r2').last('comms.clip')?.params).toEqual({ playMs: 2000 });
    expect(box('r3').last('comms.clip')?.params).toEqual({ playMs: 2000 });
    expect(box('r2').last('comms.state')?.state.sends?.left).toBe(1);
    advance(3000);
    expect(controller.handleClip('r2', clip(1000))).toBeNull();
    advance(3000);
    expect(controller.handleClip('r3', clip(1000))).toBe('Your team is out of sends');
    expect(box('r1').last('comms.state')?.state.sends?.left).toBe(0);
  });

  it('keeps per-player sends separate by default', () => {
    const { controller, box, advance } = setup({
      type: 'budget-clips',
      maxSeconds: 2,
      budgetSends: 1,
    });
    expect(controller.handleClip('r1', clip(1000))).toBeNull();
    advance(3000);
    expect(controller.handleClip('r1', clip(1000))).toBe("You're out of sends");
    expect(controller.handleClip('r2', clip(1000))).toBeNull();
    expect(box('r2').last('comms.state')?.state.sends).toEqual({
      left: 0,
      total: 1,
      scope: 'player',
    });
  });

  it('runs alongside other rules in a combined spec', () => {
    const { controller, box } = setup([
      { type: 'signals', signals: ['ping'] },
      { type: 'budget-clips', maxSeconds: 3, budgetSeconds: 5 },
    ]);
    expect(controller.handleClip('r1', clip(1000))).toBeNull();
    expect(box('r1').last('comms.state')?.state.budgets).toEqual({ r1: 4000, r2: 5000 });
  });
});
