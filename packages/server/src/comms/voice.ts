import type { CommsRule, MatchPhase } from '@split-signal/shared';

export interface VoiceInputs {
  /** Everyone in the room. */
  playerIds: readonly string[];
  /** Present once a match exists. */
  match?: {
    phase: MatchPhase;
    comms: CommsRule;
    teams: ReadonlyArray<{ id: string; playerIds: readonly string[] }>;
  };
}

/**
 * Who each player may hear, as decided by the server:
 *   lobby and final results: everyone in the room
 *   between rounds (intro, countdown, scoreboard): your own team, to plan privately
 *   while a puzzle is running: whatever its comms rule says (team, all, or nobody)
 * Players outside any team (mid-match joiners can't exist, but be safe) hear nobody in a match.
 */
export function voicePeers(inputs: VoiceInputs): Map<string, string[]> {
  const everyone = [...inputs.playerIds];
  const others = (id: string, pool: readonly string[]) => pool.filter((p) => p !== id);
  const result = new Map<string, string[]>();
  const { match } = inputs;

  if (!match || match.phase === 'finished') {
    for (const id of everyone) result.set(id, others(id, everyone));
    return result;
  }

  const teamOf = new Map<string, readonly string[]>();
  for (const team of match.teams) for (const id of team.playerIds) teamOf.set(id, team.playerIds);
  const matchPlayers = match.teams.flatMap((t) => t.playerIds);

  for (const id of everyone) {
    const team = teamOf.get(id) ?? [];
    let pool: readonly string[] = team;
    if (match.phase === 'playing') {
      const rule = match.comms;
      pool = rule.type !== 'voice' ? [] : rule.scope === 'all' ? matchPlayers : team;
    }
    result.set(id, teamOf.has(id) ? others(id, pool) : []);
  }
  return result;
}
