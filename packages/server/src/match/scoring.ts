import type { RoundSummary, Standing } from '@split-signal/shared';

/**
 * How round results turn into match points. Pluggable so tournament, best-of, and weighted modes
 * can be added without touching the match engine. Modes are stateless; the engine keeps totals.
 */
export interface ScoringMode {
  readonly id: string;
  /** Points to award for a finished round, by team id. */
  onRoundResult(round: Omit<RoundSummary, 'points'>): Record<string, number>;
  /** Final ranking from the accumulated totals. */
  finalStandings(totals: Record<string, number>): Standing[];
}

/** Standard competition ranking: equal scores share a rank (1, 1, 3). */
export function rankByScore(totals: Record<string, number>): Standing[] {
  const sorted = Object.entries(totals)
    .map(([teamId, score]) => ({ teamId, score }))
    .sort((a, b) => b.score - a.score);
  return sorted.map((entry) => ({
    ...entry,
    rank: sorted.findIndex((other) => other.score === entry.score) + 1,
  }));
}

/** v1: one point per round won, nothing for ties or unsolved rounds. */
export const onePointPerRound: ScoringMode = {
  id: 'one-point-per-round',
  onRoundResult(round) {
    const points = Object.fromEntries(round.results.map((r) => [r.teamId, 0]));
    if (round.winnerTeamId) points[round.winnerTeamId] = 1;
    return points;
  },
  finalStandings: rankByScore,
};
