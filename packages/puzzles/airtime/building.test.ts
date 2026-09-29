import { createRng } from '@split-signal/shared';
import { describe, expect, it } from 'vitest';
import {
  HEIGHT,
  ROUTE_BAND,
  WIDTH,
  distance,
  distancesFrom,
  generateBuilding,
  isWalkable,
  tileAt,
  type Building,
} from './building';

const buildings: Array<[string, Building]> = Array.from({ length: 200 }, (_, i) => {
  const seed = `building-${i}`;
  return [seed, generateBuilding(createRng(seed))];
});

describe('airtime building generator', () => {
  it('is deterministic for a seed', () => {
    expect(generateBuilding(createRng('same'))).toEqual(generateBuilding(createRng('same')));
  });

  it('makes buildings of 1-3 floors with walls all round', () => {
    const counts = new Set<number>();
    for (const [seed, b] of buildings) {
      counts.add(b.floors.length);
      expect(b.floors.length, seed).toBeGreaterThanOrEqual(1);
      expect(b.floors.length, seed).toBeLessThanOrEqual(3);
      for (const floor of b.floors) {
        expect(floor).toHaveLength(HEIGHT);
        for (const [y, row] of floor.entries()) {
          expect(row, seed).toHaveLength(WIDTH);
          expect(row, seed).toMatch(/^[#.,+^vE]+$/);
          if (y === 0 || y === HEIGHT - 1) expect(row, seed).toMatch(/^#+$/);
          expect(row[0]).toBe('#');
          expect(row[WIDTH - 1]).toBe('#');
        }
      }
    }
    expect([...counts].sort()).toEqual([1, 2, 3]);
  });

  it('puts the entrance on the ground floor and pairs every staircase', () => {
    for (const [seed, b] of buildings) {
      expect(b.entrance.floor, seed).toBe(0);
      expect(tileAt(b.floors, b.entrance), seed).toBe('E');
      b.floors.forEach((floor, f) =>
        floor.forEach((row, y) =>
          [...row].forEach((t, x) => {
            if (t === '^') expect(tileAt(b.floors, { floor: f + 1, x, y }), seed).toBe('v');
            if (t === 'v') expect(tileAt(b.floors, { floor: f - 1, x, y }), seed).toBe('^');
          }),
        ),
      );
    }
  });

  it('keeps rooms walled, with doors the only way in', () => {
    for (const [seed, b] of buildings) {
      b.floors.forEach((floor, f) =>
        floor.forEach((row, y) =>
          [...row].forEach((t, x) => {
            if (t !== ',') return;
            for (const [dx, dy] of [
              [0, 1],
              [0, -1],
              [1, 0],
              [-1, 0],
            ] as const) {
              expect(',+#', `${seed} ${f}:${x},${y}`).toContain(
                tileAt(b.floors, { floor: f, x: x + dx, y: y + dy }),
              );
            }
          }),
        ),
      );
    }
  });

  it('can reach every room and every floor from the entrance', () => {
    for (const [seed, b] of buildings) {
      const reach = distancesFrom(b.floors, b.entrance);
      for (const r of b.rooms) {
        expect(reach.has(`${r.floor}:${r.x}:${r.y}`), `${seed}: ${r.name}`).toBe(true);
      }
    }
  });

  it('places 2-3 objectives in different rooms, on room floor', () => {
    for (const [seed, b] of buildings) {
      expect(b.objectives.length, seed).toBeGreaterThanOrEqual(2);
      expect(b.objectives.length, seed).toBeLessThanOrEqual(3);
      expect(new Set(b.objectives.map((o) => o.room)).size, seed).toBe(b.objectives.length);
      for (const o of b.objectives) {
        expect(tileAt(b.floors, o), seed).toBe(',');
        const room = b.rooms.find((r) => r.name === o.room)!;
        expect(
          o.x >= room.x && o.x < room.x + room.w && o.y >= room.y && o.y < room.y + room.h,
        ).toBe(true);
      }
    }
  });

  it('keeps every full route solvable and inside the length band', () => {
    for (const [seed, b] of buildings) {
      const stops = [b.entrance, ...b.objectives, b.entrance];
      let total = 0;
      for (let i = 1; i < stops.length; i++) total += distance(b.floors, stops[i - 1]!, stops[i]!);
      expect(total, seed).toBe(b.routeLength);
      expect(total, seed).toBeGreaterThanOrEqual(ROUTE_BAND.min);
      expect(total, seed).toBeLessThanOrEqual(ROUTE_BAND.max);
    }
  });

  it('puts a dead end in most buildings', () => {
    let deadEnds = 0;
    for (const [, b] of buildings) {
      b.floors.forEach((floor, f) =>
        floor.forEach((row, y) =>
          [...row].forEach((t, x) => {
            if (t !== '.') return;
            const open = [
              [0, 1],
              [0, -1],
              [1, 0],
              [-1, 0],
            ].filter(([dx, dy]) =>
              isWalkable(tileAt(b.floors, { floor: f, x: x + dx!, y: y + dy! })),
            );
            if (open.length === 1) deadEnds++;
          }),
        ),
      );
    }
    expect(deadEnds / buildings.length).toBeGreaterThan(0.8);
  });
});
