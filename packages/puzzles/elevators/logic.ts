import type { Rng } from '@split-signal/shared';
import type { Group, Pick, Trip } from './types';

export const CAPACITY = 6;
export const TOP_FLOOR = 6;

/**
 * A queue with real dilemmas: uneven demand (a couple of busy floors, some empty ones) and a pair
 * of big groups for the same floor that can't share one car.
 */
export function generateQueue(elevators: number, rng: Rng): Group[] {
  const floors = rng.shuffle([2, 3, 4, 5, 6].slice(0, TOP_FLOOR - 1));
  const [busy, busier, ...rest] = floors as [number, number, ...number[]];
  const weighted = [busy, busy, busy, busier, busier, ...rest];
  const count = elevators * 4;
  const groups: Group[] = [
    { id: 'g0', floor: busy, size: 4 },
    { id: 'g1', floor: busy, size: 4 },
  ];
  while (groups.length < count) {
    groups.push({
      id: `g${groups.length}`,
      floor: rng.pick(weighted),
      size: rng.pick([1, 1, 2, 2, 3]),
    });
  }
  // Keep the big pair apart in the queue so it isn't obvious.
  return rng.shuffle(groups).map((g, i) => ({ ...g, id: `g${i}` }));
}

/**
 * Resolves one turn:
 *   - Two players on the same elevator: it serves only one of their floors, chosen at random.
 *   - Two elevators to the same floor: only one of them serves it; the other trip is wasted.
 *   - A trip boards waiting groups for its floor in queue order while they fit.
 */
export function resolveTurn(
  queue: readonly Group[],
  picks: ReadonlyArray<{ player: string; pick: Pick }>,
  elevators: number,
  capacity: number,
  rng: Rng,
): { trips: Trip[]; remaining: Group[]; delivered: Group[] } {
  const trips: Trip[] = Array.from({ length: elevators }, (_, elevator) => {
    const mine = picks.filter(
      (p): p is { player: string; pick: { elevator: number; floor: number } } =>
        p.pick !== 'idle' && p.pick.elevator === elevator,
    );
    if (mine.length === 0) {
      return { elevator, floor: null, pickedBy: [], served: [], outcome: 'idle' };
    }
    const floors = [...new Set(mine.map((p) => p.pick.floor))].sort((a, b) => a - b);
    return {
      elevator,
      floor: rng.pick(floors),
      pickedBy: mine.map((p) => p.player),
      served: [],
      outcome: 'empty',
    };
  });

  // Several elevators to one floor: a random one gets it, the rest are wasted.
  const byFloor = new Map<number, Trip[]>();
  for (const trip of trips) {
    if (trip.floor !== null) byFloor.set(trip.floor, [...(byFloor.get(trip.floor) ?? []), trip]);
  }
  const serving = new Set<Trip>();
  for (const group of byFloor.values()) {
    const winner = rng.pick(group);
    serving.add(winner);
    for (const trip of group) if (trip !== winner) trip.outcome = 'blocked';
  }

  let remaining = [...queue];
  const delivered: Group[] = [];
  for (const trip of trips) {
    if (!serving.has(trip)) continue;
    let room = capacity;
    const boarded: Group[] = [];
    for (const group of remaining) {
      if (group.floor !== trip.floor) continue;
      if (group.size > room) break;
      room -= group.size;
      boarded.push(group);
    }
    trip.served = boarded.map((g) => g.id);
    trip.outcome = boarded.length > 0 ? 'served' : 'empty';
    remaining = remaining.filter((g) => !boarded.includes(g));
    delivered.push(...boarded);
  }
  return { trips, remaining, delivered };
}
