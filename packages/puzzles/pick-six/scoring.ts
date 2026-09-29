/** Picks by player id (null: didn't pick). */
export type Picks = Record<string, number | null>;

export interface TurnScore {
  /** Each player's own score this turn. */
  players: Record<string, number>;
  /** Each team's score this turn: a number two teammates both picked counts once. */
  teams: Record<string, number>;
}

/** The low numbers hunt the high ones: 1 beats 6, 2 beats 5, 3 beats 4. */
export const preyOf = (n: number) => (n <= 3 ? 7 - n : null);
export const hunterOf = (n: number) => (n >= 4 ? 7 - n : null);

/**
 * Scores one turn. A pick is worth its face value, except:
 *   - a hunter whose prey was picked by someone on another team scores hunter + prey;
 *   - a prey picked by someone whose hunter was picked on another team scores 0.
 * Hunting is cross-team only, and two hunters of the same prey both score in full.
 */
export function scoreTurn(picks: Picks, teamOf: Record<string, string>): TurnScore {
  const pickedBy = (n: number, notTeam: string) =>
    Object.entries(picks).some(([id, p]) => p === n && teamOf[id] !== notTeam);

  const players: Record<string, number> = {};
  for (const [id, n] of Object.entries(picks)) {
    const team = teamOf[id]!;
    if (n === null) {
      players[id] = 0;
      continue;
    }
    const prey = preyOf(n);
    const hunter = hunterOf(n);
    if (prey !== null && pickedBy(prey, team)) players[id] = n + prey;
    else if (hunter !== null && pickedBy(hunter, team)) players[id] = 0;
    else players[id] = n;
  }

  const teams: Record<string, number> = {};
  const counted: Record<string, Set<number>> = {};
  for (const [id, n] of Object.entries(picks)) {
    const team = teamOf[id]!;
    teams[team] ??= 0;
    counted[team] ??= new Set();
    if (n === null || counted[team].has(n)) continue;
    counted[team].add(n);
    teams[team] += players[id]!;
  }
  return { players, teams };
}
