import type { RoundSummary, TeamRoundResult } from '@split-signal/shared';

export type RoundResolution = Pick<RoundSummary, 'outcome' | 'winnerTeamId'>;

/**
 * Picks a round winner.
 *   race:    among teams that solved (inside the grace window), the fastest. If nobody solved
 *            and the puzzle reports points (progress, say), the most points.
 *   compare: if the puzzle reports points, the most points (solved or not; ties go to whoever
 *            finished earlier). Otherwise fewest moves, ties broken by time; unsolved teams
 *            never win.
 * Equal best results are a tie, and ties award no point (v1).
 */
export function resolveRound(
  winCondition: 'race' | 'compare',
  results: readonly TeamRoundResult[],
): RoundResolution {
  const hasPoints = results.some((r) => r.points !== undefined);
  const byPoints = hasPoints && (winCondition === 'compare' || !results.some((r) => r.solved));
  const candidates = byPoints ? results : results.filter((r) => r.solved);
  if (candidates.length === 0) return { outcome: 'unsolved', winnerTeamId: null };

  const key = (r: TeamRoundResult): [number, number] => {
    const time = r.elapsedMs ?? Infinity;
    if (byPoints) return [-(r.points ?? -Infinity), time];
    return winCondition === 'race' ? [time, 0] : [r.moves ?? Infinity, time];
  };
  const compare = (a: TeamRoundResult, b: TeamRoundResult) => {
    const [a1, a2] = key(a);
    const [b1, b2] = key(b);
    return a1 - b1 || a2 - b2;
  };

  const ranked = [...candidates].sort(compare);
  const [best, second] = ranked;
  if (!best) return { outcome: 'unsolved', winnerTeamId: null };
  // Nobody scored anything and nobody finished: that's not a win for anyone.
  if (byPoints && !(best.points !== undefined && best.points > 0) && !best.solved) {
    return { outcome: 'unsolved', winnerTeamId: null };
  }
  if (second && compare(best, second) === 0) return { outcome: 'tie', winnerTeamId: null };
  return { outcome: 'won', winnerTeamId: best.teamId };
}
