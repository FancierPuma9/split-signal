import { describe, expect, it } from 'vitest';
import { startPuzzle, type HiddenInfo, type PuzzleDriver } from '../harness';
import { COLORS, SWITCHES, SYMBOLS, gateOpen, type Cell } from './level';
import puzzle from './server';
import type { Action, LiveView, State, View } from './types';

type Game = PuzzleDriver<State, View, Action>;
const A = 'player-1';
const B = 'player-2';

const flipAll = (on: Record<string, boolean>, ids: string[]) =>
  Object.fromEntries(ids.map((id) => [id, !on[id]]));

const hidden: HiddenInfo<State>[] = [
  {
    // Seat 0 is live in these tests: where the partner is, and their room, never reach them.
    // (The partner's switches do: they work seat 0's gates.)
    name: "the partner's room",
    hiddenFrom: (p) => p.seat === 0,
    change: (state) => ({
      ...state,
      pos: [state.pos[0], { x: state.pos[1].x, y: state.pos[1].y === 1 ? 2 : 1 }],
      rooms: [
        state.rooms[0],
        {
          ...state.rooms[1],
          gates: state.rooms[1].gates.map((g) => ({ ...g, y: g.y === 1 ? 2 : 1 })),
        },
      ],
    }),
  },
  {
    name: 'anything at all, while listening',
    hiddenFrom: (p) => p.seat === 1,
    change: (state) => ({
      ...state,
      pos: [
        { x: state.pos[0].x, y: state.pos[0].y === 1 ? 2 : 1 },
        { x: state.pos[1].x, y: state.pos[1].y === 1 ? 2 : 1 },
      ],
      on: [
        flipAll(
          state.on[0],
          state.rooms[0].switches.map((s) => s.id),
        ),
        state.on[1],
      ],
    }),
  },
];

/** Shortest moves inside a room, treating gates as passable if open(gateId). */
function route(game: Game, r: 0 | 1, to: Cell): Array<'n' | 's' | 'e' | 'w'> {
  const room = game.state.rooms[r];
  const other = r === 0 ? 1 : 0;
  const open = (x: number, y: number) => {
    const t = room.rows[y]?.[x] ?? '#';
    if (t === '#') return false;
    if (t !== 'G') return true;
    const g = room.gates.find((gate) => gate.x === x && gate.y === y)!;
    return gateOpen(g.id, game.state.wires[other], game.state.on[other]);
  };
  const from = game.state.pos[r];
  const prev = new Map<string, [string, 'n' | 's' | 'e' | 'w'] | null>([
    [`${from.x},${from.y}`, null],
  ]);
  const queue: Cell[] = [from];
  const steps = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] } as const;
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i]!;
    for (const [dir, [dx, dy]] of Object.entries(steps) as Array<
      ['n' | 's' | 'e' | 'w', readonly [number, number]]
    >) {
      const n = { x: c.x + dx, y: c.y + dy };
      const k = `${n.x},${n.y}`;
      if (prev.has(k) || !open(n.x, n.y)) continue;
      prev.set(k, [`${c.x},${c.y}`, dir]);
      queue.push(n);
    }
  }
  const out: Array<'n' | 's' | 'e' | 'w'> = [];
  let k = `${to.x},${to.y}`;
  if (!prev.has(k)) throw new Error(`no route in room ${r}`);
  while (prev.get(k)) {
    const [back, dir] = prev.get(k)!;
    out.unshift(dir);
    k = back;
  }
  return out;
}

function walk(game: Game, seat: 0 | 1, to: Cell) {
  for (const dir of route(game, seat, to))
    expect(game.act(seat, { type: 'move', dir })).toMatchObject({ ok: true });
}

/** The live player turns on exactly the switches that open the other room's gates. */
function openPartnerGates(game: Game, seat: 0 | 1) {
  for (const s of game.state.rooms[seat].switches) {
    if (game.state.wires[seat][s.id]?.effect !== 'open') continue;
    walk(game, seat, s);
    game.act(seat, { type: 'flip' });
  }
}

describe('walkie: levels', () => {
  it('builds two rooms with six labelled switches and 2-3 gates each, wired across', () => {
    for (let i = 0; i < 40; i++) {
      const { state } = startPuzzle(puzzle, {
        players: 2,
        seed: `level-${i}`,
        comms: { activePlayerId: A },
      });
      for (const r of [0, 1] as const) {
        const room = state.rooms[r];
        const other = state.rooms[r === 0 ? 1 : 0];
        expect(room.switches).toHaveLength(SWITCHES);
        expect(new Set(room.switches.map((s) => s.color)).size).toBe(SWITCHES);
        expect(new Set(room.switches.map((s) => s.symbol)).size).toBe(SWITCHES);
        expect(room.switches.every((s) => (COLORS as readonly string[]).includes(s.color))).toBe(
          true,
        );
        expect(room.switches.every((s) => (SYMBOLS as readonly string[]).includes(s.symbol))).toBe(
          true,
        );
        expect(room.gates.length).toBeGreaterThanOrEqual(2);
        expect(room.gates.length).toBeLessThanOrEqual(3);
        const wires = Object.values(state.wires[r]);
        // One opener per gate in the other room, two traps, the rest dead.
        for (const g of other.gates) {
          expect(wires.filter((w) => w.effect === 'open' && w.gate === g.id)).toHaveLength(1);
        }
        expect(wires.filter((w) => w.effect === 'close')).toHaveLength(2);
        expect(wires.filter((w) => w.effect === 'none')).toHaveLength(4 - other.gates.length);
      }
    }
  });

  it('opens a gate for an opener and shuts it for a trap, so flipping everything nets zero', () => {
    const wires = {
      s1: { effect: 'open', gate: 'g1' },
      s2: { effect: 'close', gate: 'g1' },
      s3: { effect: 'none' },
    } as const;
    expect(gateOpen('g1', wires, {})).toBe(false);
    expect(gateOpen('g1', wires, { s1: true })).toBe(true);
    expect(gateOpen('g1', wires, { s1: true, s2: true })).toBe(false);
    expect(gateOpen('g1', wires, { s1: true, s2: true, s3: true })).toBe(false);
  });

  it('is always solvable', () => {
    for (let i = 0; i < 30; i++) {
      const game = startPuzzle(puzzle, {
        players: 2,
        seed: `solve-${i}`,
        comms: { activePlayerId: A },
      });
      openPartnerGates(game, 0);
      game.setComms({ activePlayerId: B });
      openPartnerGates(game, 1);
      walk(game, 1, game.state.rooms[1].exit);
      game.setComms({ activePlayerId: A });
      walk(game, 0, game.state.rooms[0].exit);
      expect(game.solved).toBe(true);
    }
  });
});

describe('walkie', () => {
  it('shows the live player their own room and the other player nothing', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden, comms: { activePlayerId: A } });
    const live = game.view(0) as LiveView;
    expect(live).toMatchObject({ role: 'live', me: game.state.rooms[0].start, solved: false });
    expect(live.switches.every((s) => !s.on)).toBe(true);
    expect(live.gates.every((g) => !g.open)).toBe(true);
    expect(game.view(1)).toEqual({ role: 'listening' });
  });

  it('refuses everything from the player who is listening', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden, comms: { activePlayerId: A } });
    expect(game.act(1, { type: 'move', dir: 'e' })).toMatchObject({
      ok: false,
      reason: "You're not live: listen",
    });
    expect(game.act(1, { type: 'flip' })).toMatchObject({ ok: false });
  });

  it('blocks walls and shut gates, and only flips a switch you stand on', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden, comms: { activePlayerId: A } });
    expect(game.act(0, { type: 'move', dir: 'w' })).toMatchObject({
      ok: false,
      reason: "There's a wall there",
    });
    const onSwitch = game.state.rooms[0].switches.some(
      (s) => s.x === game.state.pos[0].x && s.y === game.state.pos[0].y,
    );
    expect(onSwitch).toBe(false);
    expect(game.act(0, { type: 'flip' })).toMatchObject({ ok: false });
    const gate = game.state.rooms[0].gates[0]!;
    walk(game, 0, { x: gate.x - 1, y: gate.y });
    expect(game.act(0, { type: 'move', dir: 'e' })).toMatchObject({
      ok: false,
      reason: 'The gate is shut',
    });
  });

  it("works the partner's gates, not your own", () => {
    const game = startPuzzle(puzzle, { players: 2, comms: { activePlayerId: A } });
    openPartnerGates(game, 0);
    expect((game.view(0) as LiveView).gates.every((g) => !g.open)).toBe(true);
    game.setComms({ activePlayerId: B });
    expect((game.view(1) as LiveView).gates.every((g) => g.open)).toBe(true);
    // A trap in A's room would shut one again.
    const trap = Object.entries(game.state.wires[0]).find(([, w]) => w.effect === 'close')!;
    game.setComms({ activePlayerId: A });
    walk(
      game,
      0,
      game.state.rooms[0].switches.find((s) => s.id === trap[0])!,
    );
    game.act(0, { type: 'flip' });
    game.setComms({ activePlayerId: B });
    expect((game.view(1) as LiveView).gates.filter((g) => !g.open)).toHaveLength(1);
  });
});
