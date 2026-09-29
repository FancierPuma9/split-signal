import type { PlayerInfo, PuzzleManifest } from './puzzle';

export type MatchPhase = 'intro' | 'countdown' | 'playing' | 'scoreboard' | 'finished';

export interface TeamRoundResult {
  teamId: string;
  solved: boolean;
  moves?: number;
  /** Round time when the team solved. */
  elapsedMs?: number;
}

export interface RoundSummary {
  round: number;
  puzzleId: string;
  puzzleName: string;
  winCondition: 'race' | 'compare';
  /** 'won': one team took it. 'tie': best results were equal. 'unsolved': nobody solved it. */
  outcome: 'won' | 'tie' | 'unsolved';
  winnerTeamId: string | null;
  results: TeamRoundResult[];
  /** Points awarded this round, by team id. */
  points: Record<string, number>;
}

export interface Standing {
  teamId: string;
  score: number;
  /** 1-based; teams with equal scores share a rank. */
  rank: number;
}

/** Match state as every player sees it. Per-player puzzle views are sent separately. */
export interface MatchView {
  /** 0-based index of the current round. */
  round: number;
  totalRounds: number;
  puzzle: { id: string; manifest: PuzzleManifest };
  phase: MatchPhase;
  /** Time left in the current phase (the round timer while playing); null if untimed. */
  phaseRemainingMs: number | null;
  phaseTotalMs: number | null;
  /** Set while the match is paused for disconnected players. */
  paused: { waitingFor: string[] } | null;
  teams: Array<{
    id: string;
    name: string;
    players: PlayerInfo[];
    score: number;
    /** This round's result so far. */
    round: TeamRoundResult;
  }>;
  history: RoundSummary[];
  standings: Standing[] | null;
  endedBy: 'completed' | 'surrender' | null;
}
