import type { PlayerInfo, Rng } from '@split-signal/shared';
import { cluster } from '../lib/composite';
import type { Item, State } from './types';

export const BOARD_SIZE = 8;
export const QUOTA = { min: 5, max: 7 };
/** No board holds more answers than this. */
const MAX_PER_BOARD = 4;

/**
 * Deals three boards of look-alike items and hides 5-7 answers among them, unevenly (a board may
 * have none). Each answer is known to exactly one of the board owner's two teammates.
 */
export function deal(players: readonly PlayerInfo[], rng: Rng): State {
  const ids = players.map((p) => p.id);
  const boards: Record<string, Item[]> = {};
  ids.forEach((id, b) => {
    boards[id] = cluster(BOARD_SIZE, rng.fork(`board-${b}`)).map((look, i) => ({
      id: `${b}-${i}`,
      look,
    }));
  });

  const quota = rng.int(QUOTA.min, QUOTA.max);
  const perBoard = Object.fromEntries(ids.map((id) => [id, 0]));
  const correct: string[] = [];
  const holders: Record<string, string> = {};
  while (correct.length < quota) {
    const owner = rng.pick(ids);
    if (perBoard[owner]! >= MAX_PER_BOARD) continue;
    const free = boards[owner]!.filter((item) => !correct.includes(item.id));
    const item = rng.pick(free);
    correct.push(item.id);
    perBoard[owner]! += 1;
    holders[item.id] = rng.pick(ids.filter((id) => id !== owner));
  }

  return {
    boards,
    correct: correct.sort(),
    holders,
    quota,
    picks: Object.fromEntries(ids.map((id) => [id, []])),
    submitted: {},
  };
}

/**
 * correct - missed - surplus: a blank costs the same as a wrong pick, and only picks past the
 * quota cost extra (a wrong pick within it is already a miss).
 */
export function tally(state: Pick<State, 'correct' | 'quota' | 'picks'>) {
  const picks = Object.values(state.picks).flat();
  const correct = picks.filter((id) => state.correct.includes(id)).length;
  const missed = state.quota - correct;
  const surplus = Math.max(0, picks.length - state.quota);
  return { correct, missed, surplus, points: correct - missed - surplus };
}
