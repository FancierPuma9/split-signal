import type { Rng } from '@split-signal/shared';
import type { Hazard, HazardKind, Move } from './types';

export const LANE_LENGTH = 60;
export const HAZARDS = { min: 14, max: 18 };
export const KINDS: readonly HazardKind[] = ['hurdle', 'beam', 'pitLeft', 'pitRight'];

/** What gets you past each hazard. */
export const ANSWER: Record<HazardKind, Move> = {
  hurdle: 'jump',
  beam: 'duck',
  pitLeft: 'stepRight',
  pitRight: 'stepLeft',
};

/**
 * A lane of 14-18 hazards at irregular spacing (never closer than two tiles, clear of the start
 * and the finish), mixing all four kinds so "now!" is never enough.
 */
export function generateLane(rng: Rng): Hazard[] {
  const count = rng.int(HAZARDS.min, HAZARDS.max);
  const slots: number[] = [];
  for (let at = 5; at <= LANE_LENGTH - 3; at++) slots.push(at);
  for (;;) {
    const picked = rng
      .shuffle(slots)
      .slice(0, count)
      .sort((a, b) => a - b);
    if (picked.every((at, i) => i === 0 || at - picked[i - 1]! >= 2)) {
      return picked.map((at) => ({ at, kind: rng.pick(KINDS) }));
    }
  }
}
