import type { PlayerInfo, Rng } from '@split-signal/shared';
import { generateGlyphs } from '../lib/glyphs';
import type { Part, Role, State, Step, Tool } from './types';

export const PARTS: readonly Part[] = [
  { id: 'gear', name: 'Gear', icon: '⚙️' },
  { id: 'bolt', name: 'Bolt', icon: '🔩' },
  { id: 'wheel', name: 'Wheel', icon: '🛞' },
  { id: 'spring', name: 'Spring', icon: '🌀' },
  { id: 'magnet', name: 'Magnet', icon: '🧲' },
  { id: 'battery', name: 'Battery', icon: '🔋' },
  { id: 'hook', name: 'Hook', icon: '🪝' },
  { id: 'bulb', name: 'Bulb', icon: '💡' },
  { id: 'chain', name: 'Chain', icon: '🔗' },
  { id: 'antenna', name: 'Antenna', icon: '📡' },
];

export const TOOLS: readonly Tool[] = [
  { id: 'wrench', name: 'Wrench', icon: '🔧' },
  { id: 'hammer', name: 'Hammer', icon: '🔨' },
  { id: 'screwdriver', name: 'Screwdriver', icon: '🪛' },
];

export const SLOTS = 4;
export const STEPS = 6;

/**
 * Roles in ring order: each seat's clips go to the next seat, so the key flows Keyholder ->
 * (Toolsmith ->) Reader -> Builder, and the Builder's questions go back round to the Keyholder.
 */
export const RING_ROLES: Record<3 | 4, Role[]> = {
  3: ['keyholder', 'reader', 'builder'],
  4: ['keyholder', 'toolsmith', 'reader', 'builder'],
};

/** Roles by player: the ring order, starting at a seat that moves on each round. */
export function assignRoles(
  players: readonly PlayerInfo[],
  roundIndex: number,
): Record<string, Role> {
  const order = RING_ROLES[players.length === 4 ? 4 : 3];
  const bySeat = [...players].sort((a, b) => a.seat - b.seat);
  const roles: Record<string, Role> = {};
  bySeat.forEach((player, seat) => {
    roles[player.id] = order[(seat - roundIndex + order.length * 4) % order.length]!;
  });
  return roles;
}

/** A seeded assembly: six distinct parts in slots, two to four of them needing a tool. */
export function generateTarget(rng: Rng): Step[] {
  const parts = rng.shuffle(PARTS.map((p) => p.id)).slice(0, STEPS);
  const tooled = new Set(rng.shuffle([0, 1, 2, 3, 4, 5]).slice(0, rng.int(2, 4)));
  return parts.map((part, i) => ({
    part,
    slot: rng.int(1, SLOTS),
    tool: tooled.has(i) ? rng.pick(TOOLS).id : null,
  }));
}

export function newState(rng: Rng, players: readonly PlayerInfo[], roundIndex: number): State {
  const glyphs = generateGlyphs(PARTS.length + TOOLS.length, rng.fork('glyphs'));
  const order = rng.shuffle(glyphs.map((g) => g.id));
  const partGlyph = Object.fromEntries(PARTS.map((p, i) => [p.id, order[i]!]));
  const toolGlyph = Object.fromEntries(TOOLS.map((t, i) => [t.id, order[PARTS.length + i]!]));
  return {
    roles: assignRoles(players, roundIndex),
    glyphs,
    partGlyph,
    toolGlyph,
    toolsmith: players.length === 4,
    target: generateTarget(rng.fork('target')),
    assembly: [],
    finishedAt: null,
    wrong: 0,
  };
}

export const sameStep = (a: Step | undefined, b: Step | undefined) =>
  !!a && !!b && a.part === b.part && a.slot === b.slot && a.tool === b.tool;

export function countWrong(target: readonly Step[], assembly: readonly Step[]): number {
  return target.filter((step, i) => !sameStep(step, assembly[i])).length;
}
