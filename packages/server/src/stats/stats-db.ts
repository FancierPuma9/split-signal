import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { AccountStats, AccountUser, PersonalBest } from '@split-signal/shared';
import type { GoogleIdentity } from '../auth/google';
import type { MatchInfo, PlayerRecord } from './record';

/** Signed-in sessions last this long since last use. */
export const SESSION_TTL_MS = 90 * 24 * 60 * 60_000;

// Bump SCHEMA_VERSION and add a step to MIGRATIONS for any schema change.
const MIGRATIONS = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    google_sub TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE matches (
    id INTEGER PRIMARY KEY,
    room_code TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER NOT NULL,
    rounds INTEGER NOT NULL,
    ended_by TEXT NOT NULL
  );
  CREATE TABLE match_players (
    match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    team_id TEXT NOT NULL,
    won INTEGER NOT NULL,
    rounds_won INTEGER NOT NULL,
    PRIMARY KEY (match_id, user_id)
  );
  CREATE TABLE puzzle_results (
    id INTEGER PRIMARY KEY,
    match_id INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    round INTEGER NOT NULL,
    puzzle_id TEXT NOT NULL,
    puzzle_name TEXT NOT NULL,
    win_condition TEXT NOT NULL,
    solved INTEGER NOT NULL,
    elapsed_ms INTEGER,
    moves INTEGER,
    points REAL,
    won_round INTEGER NOT NULL
  );
  CREATE INDEX puzzle_results_by_user ON puzzle_results (user_id, puzzle_id);
  CREATE INDEX sessions_by_expiry ON sessions (expires_at);
  `,
];

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

/**
 * Accounts and stats, in SQLite (Node's built-in driver). Stores only a Google account id and a
 * display name per user, plus match results. Session tokens are stored hashed.
 */
export class StatsDb {
  private readonly db: DatabaseSync;

  constructor(
    path: string,
    private readonly now: () => number = Date.now,
  ) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA foreign_keys = ON;');
    if (path !== ':memory:') this.db.exec('PRAGMA journal_mode = WAL;');
    this.migrate();
  }

  private migrate() {
    const { user_version: version } = this.db.prepare('PRAGMA user_version').get() as {
      user_version: number;
    };
    for (let v = version; v < MIGRATIONS.length; v++) {
      this.db.exec('BEGIN');
      try {
        this.db.exec(MIGRATIONS[v]!);
        this.db.exec(`PRAGMA user_version = ${v + 1}`);
        this.db.exec('COMMIT');
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    }
  }

  /** Finds or creates the account for a Google identity, keeping the name current. */
  upsertUser(identity: GoogleIdentity): AccountUser {
    const now = this.now();
    this.db
      .prepare(
        `INSERT INTO users (google_sub, name, created_at, last_seen_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (google_sub) DO UPDATE SET name = excluded.name, last_seen_at = excluded.last_seen_at`,
      )
      .run(identity.sub, identity.name, now, now);
    const row = this.db
      .prepare('SELECT id, name FROM users WHERE google_sub = ?')
      .get(identity.sub) as { id: number; name: string };
    return { id: String(row.id), name: row.name };
  }

  createSession(userId: string): string {
    const token = randomBytes(32).toString('base64url');
    const now = this.now();
    this.db
      .prepare(
        'INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
      )
      .run(hashToken(token), Number(userId), now, now + SESSION_TTL_MS);
    return token;
  }

  /** The account a session token belongs to, extending the session; null if unknown or expired. */
  sessionUser(token: string): AccountUser | null {
    const now = this.now();
    const hash = hashToken(token);
    const row = this.db
      .prepare(
        `SELECT users.id AS id, users.name AS name FROM sessions
         JOIN users ON users.id = sessions.user_id
         WHERE sessions.token_hash = ? AND sessions.expires_at > ?`,
      )
      .get(hash, now) as { id: number; name: string } | undefined;
    if (!row) return null;
    this.db
      .prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?')
      .run(now + SESSION_TTL_MS, hash);
    return { id: String(row.id), name: row.name };
  }

  deleteSession(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  }

  pruneSessions(): void {
    this.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(this.now());
  }

  saveMatch(match: MatchInfo): number {
    const result = this.db
      .prepare(
        'INSERT INTO matches (room_code, started_at, ended_at, rounds, ended_by) VALUES (?, ?, ?, ?, ?)',
      )
      .run(match.roomCode, match.startedAt, match.endedAt, match.rounds, match.endedBy);
    return Number(result.lastInsertRowid);
  }

  /**
   * Saves one player's part of a match to an account. Returns false if that account already has
   * this match (the same person in two seats counts once).
   */
  savePlayer(matchId: number, userId: string, player: PlayerRecord): boolean {
    this.db.exec('BEGIN');
    try {
      const inserted = this.db
        .prepare(
          `INSERT OR IGNORE INTO match_players (match_id, user_id, name, team_id, won, rounds_won)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          matchId,
          Number(userId),
          player.name,
          player.teamId,
          player.won ? 1 : 0,
          player.roundsWon,
        );
      if (inserted.changes === 0) {
        this.db.exec('ROLLBACK');
        return false;
      }
      const insertResult = this.db.prepare(
        `INSERT INTO puzzle_results (match_id, user_id, round, puzzle_id, puzzle_name, win_condition,
           solved, elapsed_ms, moves, points, won_round) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const r of player.results) {
        insertResult.run(
          matchId,
          Number(userId),
          r.round,
          r.puzzleId,
          r.puzzleName,
          r.winCondition,
          r.solved ? 1 : 0,
          r.elapsedMs ?? null,
          r.moves ?? null,
          r.points ?? null,
          r.wonRound ? 1 : 0,
        );
      }
      this.db.exec('COMMIT');
      return true;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  stats(userId: string): AccountStats {
    const id = Number(userId);
    const totals = this.db
      .prepare(
        `SELECT COUNT(*) AS played, COALESCE(SUM(won), 0) AS won, COALESCE(SUM(rounds_won), 0) AS rounds
         FROM match_players WHERE user_id = ?`,
      )
      .get(id) as { played: number; won: number; rounds: number };
    const rows = this.db
      .prepare(
        `SELECT puzzle_id, MAX(puzzle_name) AS puzzle_name, COUNT(*) AS plays,
           MIN(CASE WHEN win_condition = 'race' AND solved = 1 THEN elapsed_ms END) AS fastest,
           MIN(CASE WHEN win_condition = 'compare' AND solved = 1 AND points IS NULL THEN moves END) AS fewest,
           MAX(CASE WHEN win_condition = 'compare' THEN points END) AS most
         FROM puzzle_results WHERE user_id = ? GROUP BY puzzle_id ORDER BY puzzle_name`,
      )
      .all(id) as Array<{
      puzzle_id: string;
      puzzle_name: string;
      plays: number;
      fastest: number | null;
      fewest: number | null;
      most: number | null;
    }>;
    const bests: PersonalBest[] = rows.map((r) => ({
      puzzleId: r.puzzle_id,
      puzzleName: r.puzzle_name,
      plays: r.plays,
      ...(r.fastest !== null ? { fastestMs: r.fastest } : {}),
      ...(r.fewest !== null ? { fewestMoves: r.fewest } : {}),
      ...(r.most !== null ? { mostPoints: r.most } : {}),
    }));
    return {
      matchesPlayed: totals.played,
      matchesWon: totals.won,
      roundsWon: totals.rounds,
      bests,
    };
  }

  close(): void {
    this.db.close();
  }
}
