/** A signed-in player. Accounts are optional: nothing about playing needs one. */
export interface AccountUser {
  id: string;
  name: string;
}

/** A player's best result on one puzzle. Which fields apply depends on how the puzzle is won. */
export interface PersonalBest {
  puzzleId: string;
  puzzleName: string;
  plays: number;
  /** Race puzzles: fastest solve. */
  fastestMs?: number;
  /** Compare puzzles won on moves: fewest moves in a solve. */
  fewestMoves?: number;
  /** Compare puzzles won on points: most points. */
  mostPoints?: number;
}

export interface AccountStats {
  matchesPlayed: number;
  matchesWon: number;
  roundsWon: number;
  bests: PersonalBest[];
}

/** How long a guest has to sign in and claim a finished match's results. */
export const CLAIM_WINDOW_MS = 30 * 60_000;
