import type { PuzzleServerModule } from '@split-signal/shared';
import { gateOpen, makeRoom, wire, type Cell } from './level';
import { manifest } from './manifest';
import type { Action, State, View } from './types';

const STEP = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] } as const;
const same = (a: Cell, b: Cell) => a.x === b.x && a.y === b.y;

/** Whether gate `id` in room r is open, going by the switches in the other room. */
function isOpen(state: State, r: 0 | 1, id: string): boolean {
  const other = r === 0 ? 1 : 0;
  return gateOpen(id, state.wires[other], state.on[other]);
}

function roomOf(state: State, playerId: string): 0 | 1 | null {
  const i = state.players.indexOf(playerId);
  return i === 0 || i === 1 ? i : null;
}

const puzzle: PuzzleServerModule<State, View, Action> = {
  manifest,

  init({ rng, players }) {
    const [a, b] = players;
    if (!a || !b) throw new Error('Walkie needs 2 players');
    const gates = rng.int(2, 3);
    const rooms = [makeRoom(rng, gates, 'a'), makeRoom(rng, gates, 'b')] as State['rooms'];
    return {
      players: [a.id, b.id],
      rooms,
      // Room A's switches work room B's gates, and the other way round.
      wires: [
        wire(rng, rooms[0].switches, rooms[1].gates),
        wire(rng, rooms[1].switches, rooms[0].gates),
      ],
      on: [{}, {}],
      pos: [rooms[0].start, rooms[1].start],
      solvedAt: null,
    };
  },

  view(state, playerId, ctx) {
    const r = roomOf(state, playerId);
    // Only the live player sees anything, and only their own room. The other gets no room state
    // at all, so there is nothing to peek at.
    if (r === null || ctx.comms.activePlayerId !== playerId) return { role: 'listening' };
    const room = state.rooms[r];
    return {
      role: 'live',
      rows: room.rows,
      gates: room.gates.map((g) => ({ id: g.id, x: g.x, y: g.y, open: isOpen(state, r, g.id) })),
      switches: room.switches.map((s) => ({ ...s, on: state.on[r][s.id] === true })),
      exit: room.exit,
      me: state.pos[r],
      solved: state.solvedAt !== null,
    };
  },

  apply(state, playerId, action, ctx) {
    const r = roomOf(state, playerId);
    if (r === null) return { reject: 'You are not on this team' };
    if (ctx.comms.activePlayerId !== playerId) return { reject: "You're not live: listen" };
    const room = state.rooms[r];
    const here = state.pos[r];

    if (action?.type === 'flip') {
      const sw = room.switches.find((s) => same(s, here));
      if (!sw) return { reject: 'Stand on a switch to flip it' };
      const on = [...state.on] as State['on'];
      on[r] = { ...on[r], [sw.id]: !on[r][sw.id] };
      return { state: { ...state, on } };
    }
    if (action?.type !== 'move' || !(action.dir in STEP)) return { reject: 'Unknown action' };

    const [dx, dy] = STEP[action.dir];
    const next = { x: here.x + dx, y: here.y + dy };
    const tile = room.rows[next.y]?.[next.x] ?? '#';
    if (tile === '#') return { reject: "There's a wall there" };
    if (tile === 'G') {
      const gate = room.gates.find((g) => same(g, next))!;
      if (!isOpen(state, r, gate.id)) return { reject: 'The gate is shut' };
    }
    const pos = [...state.pos] as State['pos'];
    pos[r] = next;
    const out = state.rooms.every((rm, i) => same(pos[i]!, rm.exit));
    return { state: { ...state, pos, solvedAt: out ? ctx.elapsedMs : null } };
  },

  isSolved: (state) => state.solvedAt !== null,

  // Race: decided on time.
  score: () => ({}),
};

export default puzzle;
