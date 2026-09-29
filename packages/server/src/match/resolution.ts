import type { RoundSummary, TeamRoundResult } from '@split-signal/shared';

export type RoundResolution = Pick<RoundSummary, 'outcome' | 'winnerTeamId'>;

/**
 * Picks a round winner.
 *   race:    among teams that solved (inside the grace window), the fastest.
 *   compare: fewest moves, ties broken by time. Unsolved teams never win.
 * Equal best results are a tie, and ties award no point (v1).
 */
export function resolveRound(
  winCondition: 'race' | 'compare',
  results: readonly TeamRoundResult[],
): RoundResolution {
  const solved = results.filter((r) => r.solved);
  if (solved.length === 0) return { outcome: 'unsolved', winnerTeamId: null };

  const key = (r: TeamRoundResult): [number, number] => {
    const time = r.elapsedMs ?? Infinity;
    return winCondition === 'race' ? [time, 0] : [r.moves ?? Infinity, time];
  };
  const compare = (a: TeamRoundResult, b: TeamRoundResult) => {
    const [a1, a2] = key(a);
    const [b1, b2] = key(b);
    return a1 - b1 || a2 - b2;
  };

  const ranked = [...solved].sort(compare);
  const [best, second] = ranked;
  if (!best) return { outcome: 'unsolved', winnerTeamId: null };
  if (second && compare(best, second) === 0) return { outcome: 'tie', winnerTeamId: null };
  return { outcome: 'won', winnerTeamId: best.teamId };
}
