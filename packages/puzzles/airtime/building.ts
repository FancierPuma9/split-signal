import type { Rng } from '@split-signal/shared';

/**
 * Map tiles, one character each:
 *   #  wall        .  corridor      ,  room floor    +  door
 *   ^  stairs up (to the same spot one floor higher)   v  stairs down    E  entrance and exit
 */
export type Tile = '#' | '.' | ',' | '+' | '^' | 'v' | 'E';

export interface Pos {
  floor: number;
  x: number;
  y: number;
}

export interface Room {
  name: string;
  floor: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Objective extends Pos {
  label: string;
  icon: string;
  room: string;
}

export interface Building {
  /** floors[f][y] is a row of tiles. */
  floors: string[][];
  rooms: Room[];
  entrance: Pos;
  objectives: Objective[];
  /** Steps on the shortest full route: entrance, every objective in order, back out. */
  routeLength: number;
}

export const WIDTH = 13;
export const HEIGHT = 9;
/** Every building's full route falls in this band, so rounds are comparable. */
export const ROUTE_BAND = { min: 40, max: 90 };
/** No objective is closer than this (in steps) to the waypoint before it. */
const MIN_LEG = 8;

/** Room kinds and what the Walker does there. The generator names each room after one. */
export const ROOM_KINDS: ReadonlyArray<{ name: string; task: string; icon: string }> = [
  { name: 'Boiler room', task: 'Pull the lever in the boiler room', icon: '⚙️' },
  { name: 'Office', task: 'Take the file from the office', icon: '📁' },
  { name: 'Library', task: 'Find the red book in the library', icon: '📕' },
  { name: 'Kitchen', task: 'Grab the key from the kitchen', icon: '🔑' },
  { name: 'Server room', task: 'Reboot the server in the server room', icon: '💻' },
  { name: 'Archive', task: 'Stamp the form in the archive', icon: '📜' },
  { name: 'Lab', task: 'Collect the sample from the lab', icon: '🧪' },
  { name: 'Storage', task: 'Fetch the torch from storage', icon: '🔦' },
  { name: 'Mail room', task: 'Pick up the parcel in the mail room', icon: '📦' },
  { name: 'Security', task: 'Switch off the alarm in security', icon: '🚨' },
  { name: 'Break room', task: 'Water the plant in the break room', icon: '🪴' },
  { name: 'Studio', task: 'Grab the tape from the studio', icon: '📼' },
  { name: 'Gym', task: 'Collect the whistle from the gym', icon: '🏅' },
  { name: 'Workshop', task: 'Pick up the wrench in the workshop', icon: '🔧' },
  { name: 'Vault', task: 'Open the safe in the vault', icon: '💰' },
  { name: 'Greenhouse', task: 'Pick the flower in the greenhouse', icon: '🌷' },
];

const WALKABLE = new Set<string>(['.', ',', '+', '^', 'v', 'E']);
export const isWalkable = (t: string | undefined) => t !== undefined && WALKABLE.has(t);

export function tileAt(
  floors: readonly string[][] | readonly (readonly string[])[],
  p: Pos,
): string {
  return floors[p.floor]?.[p.y]?.[p.x] ?? '#';
}

const key = (p: Pos) => `${p.floor}:${p.x}:${p.y}`;
const STEPS = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
] as const;

/** Where one step from p can go: the four neighbours, plus the other end of any stairs. */
export function neighbours(floors: readonly (readonly string[])[], p: Pos): Pos[] {
  const out: Pos[] = [];
  for (const [dx, dy] of STEPS) {
    const q = { floor: p.floor, x: p.x + dx, y: p.y + dy };
    if (isWalkable(tileAt(floors, q))) out.push(q);
  }
  const here = tileAt(floors, p);
  if (here === '^') out.push({ ...p, floor: p.floor + 1 });
  if (here === 'v') out.push({ ...p, floor: p.floor - 1 });
  return out;
}

/** Shortest walking distance from `from` to every reachable tile. */
export function distancesFrom(
  floors: readonly (readonly string[])[],
  from: Pos,
): Map<string, number> {
  const dist = new Map([[key(from), 0]]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i]!;
    const d = dist.get(key(p))!;
    for (const q of neighbours(floors, p)) {
      if (dist.has(key(q))) continue;
      dist.set(key(q), d + 1);
      queue.push(q);
    }
  }
  return dist;
}

export function distance(floors: readonly (readonly string[])[], a: Pos, b: Pos): number {
  return distancesFrom(floors, a).get(key(b)) ?? Infinity;
}

/** Builds a seeded building whose route is inside ROUTE_BAND. Always succeeds for real seeds. */
export function generateBuilding(rng: Rng): Building {
  for (let attempt = 0; attempt < 500; attempt++) {
    const building = tryBuilding(rng);
    if (building) return building;
  }
  throw new Error('Could not generate a building');
}

type Grid = string[][];

const inside = (x: number, y: number) => x >= 1 && y >= 1 && x <= WIDTH - 2 && y <= HEIGHT - 2;
const cell = (x: number, y: number) => y * WIDTH + x;

/** A floor under construction: tiles, rooms, and each room's wall ring. */
interface Floor {
  grid: Grid;
  rooms: Room[];
  /** Tiles touching a room (diagonals too). Corridors can't run through them, only doors. */
  ring: Set<number>;
  /** Ring tiles that can be a door: straight off a room's side, not its corners. */
  doorSpots: Map<Room, Set<number>>;
}

/**
 * Digs a corridor from any of `starts` to the nearest tile where `isGoal` holds, through plain
 * wall only (never along a room, whose sides stay solid). Turns cost extra, so corridors run
 * straight. Starts on a room's ring become doors, and so does a goal on one. Returns false if
 * there's no way through.
 */
function dig(
  rng: Rng,
  floor: Floor,
  starts: Iterable<number>,
  isGoal: (c: number) => boolean,
): boolean {
  const { grid, ring } = floor;
  const open = (c: number) => {
    const x = c % WIDTH;
    const y = Math.floor(c / WIDTH);
    return inside(x, y) && grid[y]![x] === '#' && !ring.has(c);
  };
  // Dijkstra over (cell, heading). The grid is tiny, so a sorted array does fine as a queue.
  const best = new Map<string, number>();
  const prev = new Map<string, string | null>();
  const queue: Array<{ state: string; c: number; dir: number; cost: number }> = [];
  for (const c of starts) {
    const state = `${c}:-1`;
    const cost = rng.next() * 0.2;
    best.set(state, cost);
    prev.set(state, null);
    queue.push({ state, c, dir: -1, cost });
  }
  while (queue.length > 0) {
    queue.sort((a, b) => a.cost - b.cost);
    const cur = queue.shift()!;
    if (cur.cost > (best.get(cur.state) ?? Infinity)) continue;
    if (isGoal(cur.c)) {
      for (let s: string | null = cur.state; s !== null; s = prev.get(s) ?? null) {
        const c = Number(s.split(':')[0]);
        const x = c % WIDTH;
        const y = Math.floor(c / WIDTH);
        if (grid[y]![x] === '#') grid[y]![x] = ring.has(c) ? '+' : '.';
      }
      return true;
    }
    const x = cur.c % WIDTH;
    const y = Math.floor(cur.c / WIDTH);
    STEPS.forEach(([dx, dy], dir) => {
      if (!inside(x + dx, y + dy)) return;
      const n = cell(x + dx, y + dy);
      if (!isGoal(n) && !open(n)) return;
      const cost = cur.cost + 1 + (cur.dir !== -1 && cur.dir !== dir ? 0.7 : 0);
      const state = `${n}:${dir}`;
      if (cost >= (best.get(state) ?? Infinity)) return;
      best.set(state, cost);
      prev.set(state, cur.state);
      queue.push({ state, c: n, dir, cost });
    });
  }
  return false;
}

function makeFloor(rng: Rng, floor: number, names: string[]): Floor | null {
  const grid: Grid = Array.from({ length: HEIGHT }, () => Array<string>(WIDTH).fill('#'));
  const rooms: Room[] = [];
  const target = rng.int(3, 5);
  for (let tries = 0; tries < 60 && rooms.length < target; tries++) {
    const w = rng.int(3, 4);
    const h = rng.int(2, 3);
    const x = rng.int(1, WIDTH - 1 - w);
    const y = rng.int(1, HEIGHT - 1 - h);
    // Keep a wall between rooms.
    const clear = rooms.every(
      (r) => x + w + 1 <= r.x || r.x + r.w + 1 <= x || y + h + 1 <= r.y || r.y + r.h + 1 <= y,
    );
    if (!clear) continue;
    rooms.push({
      name: names.shift() ?? `Room ${floor + 1}.${rooms.length + 1}`,
      floor,
      x,
      y,
      w,
      h,
    });
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) grid[yy]![xx] = ',';
  }
  if (rooms.length < 3) return null;

  const ring = new Set<number>();
  const doorSpots = new Map<Room, Set<number>>();
  for (const r of rooms) {
    const spots = new Set<number>();
    for (let y = r.y - 1; y <= r.y + r.h; y++) {
      for (let x = r.x - 1; x <= r.x + r.w; x++) {
        if (grid[y]?.[x] !== '#') continue;
        ring.add(cell(x, y));
        const edgeX = x === r.x - 1 || x === r.x + r.w;
        const edgeY = y === r.y - 1 || y === r.y + r.h;
        if (edgeX !== edgeY && inside(x, y)) spots.add(cell(x, y));
      }
    }
    doorSpots.set(r, spots);
  }
  const f: Floor = { grid, rooms, ring, doorSpots };

  // Join each room to those already joined: from one of its doors to a corridor, or straight to
  // a door of a joined room.
  const joined = new Set<Room>([rooms[0]!]);
  for (const room of rooms.slice(1)) {
    const goals = new Set<number>();
    for (const r of joined) for (const c of doorSpots.get(r)!) goals.add(c);
    const isGoal = (c: number) => {
      const t = grid[Math.floor(c / WIDTH)]?.[c % WIDTH];
      return t === '.' || t === '+' || goals.has(c);
    };
    if (!dig(rng, f, doorSpots.get(room)!, isGoal)) return null;
    joined.add(room);
  }

  // A few dead ends: corridors that go nowhere.
  const stubs = rng.int(1, 3);
  for (let s = 0, tries = 0; s < stubs && tries < 120; tries++) {
    const cells: Array<[number, number]> = [];
    grid.forEach((row, y) => row.forEach((t, x) => t === '.' && cells.push([x, y])));
    if (cells.length === 0) break;
    const [x0, y0] = rng.pick(cells);
    const [dx, dy] = rng.pick(STEPS);
    const path: Array<[number, number]> = [];
    let [x, y] = [x0, y0];
    for (let i = rng.int(2, 4); i > 0; i--) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inside(nx, ny) || grid[ny]![nx] !== '#' || ring.has(cell(nx, ny))) break;
      // Touching anything but the tile we came from makes a shortcut, not a dead end.
      const touches = STEPS.some(([ex, ey]) => {
        const tx = nx + ex;
        const ty = ny + ey;
        return !(tx === x && ty === y) && (grid[ty]?.[tx] ?? '#') !== '#';
      });
      if (touches) break;
      path.push([nx, ny]);
      x = nx;
      y = ny;
    }
    if (path.length < 2) continue;
    for (const [px, py] of path) grid[py]![px] = '.';
    s++;
  }
  return f;
}

function tryBuilding(rng: Rng): Building | null {
  const floorCount = rng.pick([1, 2, 2, 3]);
  const names = rng.shuffle(ROOM_KINDS).map((k) => k.name);
  const made: Floor[] = [];
  for (let f = 0; f < floorCount; f++) {
    const floor = makeFloor(rng, f, names);
    if (!floor) return null;
    made.push(floor);
  }
  const grids = made.map((m) => m.grid);
  const rooms = made.flatMap((m) => m.rooms);

  // Stairs: a corridor tile on this floor, dug through to the corridors on the floor above.
  for (let f = 0; f + 1 < floorCount; f++) {
    const below = grids[f]!;
    const above = made[f + 1]!;
    const spots: Array<[number, number]> = [];
    below.forEach((row, y) =>
      row.forEach((t, x) => {
        const up = above.grid[y]![x];
        const free = up === '.' || (up === '#' && !above.ring.has(cell(x, y)));
        if (t === '.' && free) spots.push([x, y]);
      }),
    );
    if (spots.length === 0) return null;
    const [sx, sy] = rng.pick(spots);
    if (above.grid[sy]![sx] === '#') {
      const isGoal = (c: number) =>
        ['.', '+'].includes(above.grid[Math.floor(c / WIDTH)]?.[c % WIDTH] ?? '');
      if (!dig(rng, above, [cell(sx, sy)], isGoal)) return null;
    }
    below[sy]![sx] = '^';
    above.grid[sy]![sx] = 'v';
  }

  // The entrance: the ground floor's lowest plain corridor tile.
  const ground: Array<[number, number]> = [];
  grids[0]!.forEach((row, y) => row.forEach((t, x) => t === '.' && ground.push([x, y])));
  if (ground.length === 0) return null;
  const lowest = Math.max(...ground.map(([, y]) => y));
  const [ex, ey] = rng.pick(ground.filter(([, y]) => y === lowest));
  grids[0]![ey]![ex] = 'E';
  const entrance = { floor: 0, x: ex, y: ey };

  const floors = grids.map((g) => g.map((row) => row.join('')));
  const reach = distancesFrom(floors, entrance);
  const roomTile = (r: Room): Pos => ({ floor: r.floor, x: r.x, y: r.y });
  if (!rooms.every((r) => reach.has(key(roomTile(r))))) return null;

  // Objectives in different rooms, far enough apart, with the whole route inside the band.
  for (let tries = 0; tries < 40; tries++) {
    const count = rng.int(2, 3);
    const chosen = rng.shuffle(rooms).slice(0, count);
    const objectives: Objective[] = chosen.map((room) => {
      const kind = ROOM_KINDS.find((k) => k.name === room.name);
      return {
        floor: room.floor,
        x: room.x + rng.int(0, room.w - 1),
        y: room.y + rng.int(0, room.h - 1),
        label: kind?.task ?? `Check ${room.name}`,
        icon: kind?.icon ?? '⭐',
        room: room.name,
      };
    });
    const stops = [entrance, ...objectives, entrance];
    let total = 0;
    let ok = true;
    for (let i = 1; i < stops.length; i++) {
      const leg = distance(floors, stops[i - 1]!, stops[i]!);
      if (!Number.isFinite(leg) || (i < stops.length - 1 && leg < MIN_LEG)) ok = false;
      total += leg;
    }
    if (ok && total >= ROUTE_BAND.min && total <= ROUTE_BAND.max) {
      return { floors, rooms, entrance, objectives, routeLength: total };
    }
  }
  return null;
}
