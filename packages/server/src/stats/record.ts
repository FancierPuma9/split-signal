import type { RoundSummary, Standing } from '@split-signal/shared';

/** One round, from one player's point of view (their team's result). */
export interface RoundRecord {
  round: number;
  puzzleId: string;
  puzzleName: string;
  winCondition: 'race' | 'compare';
  solved: boolean;
  elapsedMs?: number;
  moves?: number;
  points?: number;
  wonRound: boolean;
}

export interface PlayerRecord {
  playerId: string;
  name: string;
  teamId: string;
  /** Their team finished alone at the top. A draw is nobody's win. */
  won: boolean;
  roundsWon: number;
  results: RoundRecord[];
}

export interface MatchInfo {
  roomCode: string;
  startedAt: number;
  endedAt: number;
  endedBy: 'completed' | 'surrender';
  rounds: number;
}

export interface MatchRecord extends MatchInfo {
  players: PlayerRecord[];
}

export interface MatchSummaryInput {
  roomCode: string;
  startedAt: number;
  endedAt: number;
  history: readonly RoundSummary[];
  standings: readonly Standing[] | null;
  endedBy: 'completed' | 'surrender' | null;
  teams: ReadonlyArray<{ id: string; players: ReadonlyArray<{ id: string; name: string }> }>;
}

/** Turns a finished match into per-player records for the stats database. */
export function summarizeMatch(input: MatchSummaryInput): MatchRecord {
  const top = (input.standings ?? []).filter((s) => s.rank === 1);
  const winner = top.length === 1 ? top[0]!.teamId : null;
  const players = input.teams.flatMap((team) => {
    const results: RoundRecord[] = input.history.map((round) => {
      const result = round.results.find((r) => r.teamId === team.id);
      return {
        round: round.round,
        puzzleId: round.puzzleId,
        puzzleName: round.puzzleName,
        winCondition: round.winCondition,
        solved: result?.solved ?? false,
        ...(result?.elapsedMs !== undefined ? { elapsedMs: result.elapsedMs } : {}),
        ...(result?.moves !== undefined ? { moves: result.moves } : {}),
        ...(result?.points !== undefined ? { points: result.points } : {}),
        wonRound: round.winnerTeamId === team.id,
      };
    });
    const roundsWon = results.filter((r) => r.wonRound).length;
    return team.players.map((p) => ({
      playerId: p.id,
      name: p.name,
      teamId: team.id,
      won: winner === team.id,
      roundsWon,
      results,
    }));
  });
  return {
    roomCode: input.roomCode,
    startedAt: input.startedAt,
    endedAt: input.endedAt,
    endedBy: input.endedBy ?? 'completed',
    rounds: input.history.length,
    players,
  };
}
