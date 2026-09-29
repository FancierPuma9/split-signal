import type { Rng } from '@split-signal/shared';

export interface Cell {
  x: number;
  y: number;
}

/** A gate in a room's dividing wall. Its state is decided by switches in the other room. */
export interface Gate extends Cell {
  id: string;
}

export interface Switch extends Cell {
  id: string;
  color: string;
  symbol: string;
}

/**
 * One player's room. Rows are '#' wall, '.' floor, 'G' gate, 'X' exit. The start section on the
 * left holds the switches; walls with one gate each stand between it and the exit on the right.
 */
export interface Room {
  rows: string[];
  gates: Gate[];
  switches: Switch[];
  start: Cell;
  exit: Cell;
}

/** What a switch does when it's on: opens or holds shut a gate in the other room, or nothing. */
export type Wire = { effect: 'open' | 'close'; gate: string } | { effect: 'none' };

export const SWITCHES = 6;
/** Floor rows in a room. */
const HEIGHT = 5;
const SECTION = 2;

export const COLORS = ['Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Orange'] as const;
export const SYMBOLS = ['▲', '●', '■', '★', '◆', '✚'] as const;

/** A room with `gates` dividing walls. Gate ids are prefixed so both rooms' ids are distinct. */
export function makeRoom(rng: Rng, gates: number, prefix: string): Room {
  const width = 3 + gates * (SECTION + 1) + 2;
  const rows: string[][] = Array.from({ length: HEIGHT + 2 }, (_, y) =>
    Array.from({ length: width }, (_, x) =>
      x === 0 || y === 0 || x === width - 1 || y === HEIGHT + 1 ? '#' : '.',
    ),
  );
  const gateList: Gate[] = [];
  for (let g = 0; g < gates; g++) {
    const x = 4 + g * (SECTION + 1);
    const y = rng.int(1, HEIGHT);
    for (let yy = 1; yy <= HEIGHT; yy++) rows[yy]![x] = yy === y ? 'G' : '#';
    gateList.push({ id: `${prefix}g${g + 1}`, x, y });
  }
  const mid = Math.ceil(HEIGHT / 2);
  const start = { x: 1, y: mid };
  const exit = { x: width - 2, y: rng.int(1, HEIGHT) };
  rows[exit.y]![exit.x] = 'X';

  // Switches on the start section's floor, never on the start tile.
  const spots: Cell[] = [];
  for (let x = 1; x <= 3; x++) {
    for (let y = 1; y <= HEIGHT; y++) if (!(x === start.x && y === start.y)) spots.push({ x, y });
  }
  const colors = rng.shuffle(COLORS);
  const symbols = rng.shuffle(SYMBOLS);
  const switches = rng
    .shuffle(spots)
    .slice(0, SWITCHES)
    .map((c, i) => ({ ...c, id: `${prefix}s${i + 1}`, color: colors[i]!, symbol: symbols[i]! }));

  return { rows: rows.map((r) => r.join('')), gates: gateList, switches, start, exit };
}

/**
 * Wires one room's switches to the other room's gates: one opener per gate, two traps (on
 * different gates where possible), the rest dead. Flipping everything nets zero.
 */
export function wire(
  rng: Rng,
  switches: readonly Switch[],
  gates: readonly Gate[],
): Record<string, Wire> {
  const order = rng.shuffle(switches.map((s) => s.id));
  const wires: Record<string, Wire> = {};
  const targets = rng.shuffle(gates.map((g) => g.id));
  order.forEach((id, i) => {
    if (i < gates.length) {
      wires[id] = { effect: 'open', gate: gates[i]!.id };
    } else if (i < gates.length + 2) {
      wires[id] = { effect: 'close', gate: targets[(i - gates.length) % targets.length]! };
    } else {
      wires[id] = { effect: 'none' };
    }
  });
  return wires;
}

/**
 * Whether a gate is open: some switch that opens it is on, and no switch that holds it shut is.
 * `wires` and `on` belong to the other room.
 */
export function gateOpen(
  gate: string,
  wires: Record<string, Wire>,
  on: Record<string, boolean>,
): boolean {
  const live = Object.entries(wires).filter(
    ([id, w]) => on[id] && w.effect !== 'none' && w.gate === gate,
  );
  return live.some(([, w]) => w.effect === 'open') && !live.some(([, w]) => w.effect === 'close');
}
