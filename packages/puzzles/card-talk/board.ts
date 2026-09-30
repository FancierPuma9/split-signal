import type { Rng, TeamRoster } from '@split-signal/shared';
import { similarLooks } from '../lib/composite';
import type { Card } from './types';

export const OWN_PER_TEAM = 8;
export const CONTESTED = 5;
export const NEUTRAL = 4;
export const VALUES = { own: 5, contested: 10, neutral: 0, wrong: -3 } as const;

/**
 * One board for the room: eight cards per team, five on everyone's list and four traps, all
 * procedural pictures where most share two attributes with several neighbours.
 */
export function generateBoard(teams: readonly TeamRoster[], rng: Rng): Card[] {
  const count = OWN_PER_TEAM * teams.length + CONTESTED + NEUTRAL;
  const looks = similarLooks(count, rng.fork('looks'));
  const owners: Card['owner'][] = [
    ...teams.flatMap((t) => Array.from({ length: OWN_PER_TEAM }, () => ({ team: t.id }))),
    ...Array.from({ length: CONTESTED }, () => 'contested' as const),
    ...Array.from({ length: NEUTRAL }, () => 'neutral' as const),
  ];
  const shuffled = rng.fork('owners').shuffle(owners);
  return looks.map((look, i) => ({ id: `c${i}`, look, owner: shuffled[i]! }));
}
