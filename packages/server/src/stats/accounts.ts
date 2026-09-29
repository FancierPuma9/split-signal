import { randomBytes } from 'node:crypto';
import { CLAIM_WINDOW_MS, type AccountStats, type AccountUser } from '@split-signal/shared';
import type { GoogleIdentity } from '../auth/google';
import type { MatchInfo, MatchRecord, PlayerRecord } from './record';
import type { StatsDb } from './stats-db';

/** Checks a Google ID token (GoogleVerifier in production, a stub in tests). */
export interface IdTokenVerifier {
  readonly clientId: string;
  verify(token: string): Promise<GoogleIdentity>;
}

export interface Session {
  token: string;
  user: AccountUser;
}

/** A finished match's row, written the first time anyone's results from it are saved. */
interface MatchHandle {
  info: MatchInfo;
  id: number | null;
}

interface PendingClaim {
  match: MatchHandle;
  player: PlayerRecord;
  expiresAt: number;
}

export interface RecordOutcome {
  /** Player ids whose results were saved to their account. */
  saved: string[];
  /** Guests, with a token to claim their results by signing in. */
  unsaved: Array<{ playerId: string; claimToken: string; expiresInMs: number }>;
}

/**
 * Optional accounts: Google sign-in, sessions, saving match results, and letting guests claim a
 * finished match's results by signing in within CLAIM_WINDOW_MS. Guests' results are only held
 * in memory; nothing about a guest is written unless they claim.
 */
export class AccountService {
  private readonly pending = new Map<string, PendingClaim>();

  constructor(
    private readonly db: StatsDb,
    private readonly verifier: IdTokenVerifier,
    private readonly now: () => number = Date.now,
  ) {}

  get googleClientId(): string {
    return this.verifier.clientId;
  }

  async signIn(credential: string): Promise<Session> {
    const identity = await this.verifier.verify(credential);
    const user = this.db.upsertUser(identity);
    return { token: this.db.createSession(user.id), user };
  }

  resume(token: string): Session | null {
    const user = this.db.sessionUser(token);
    return user ? { token, user } : null;
  }

  signOut(token: string): void {
    this.db.deleteSession(token);
  }

  stats(user: AccountUser): AccountStats {
    return this.db.stats(user.id);
  }

  /** Saves signed-in players' results now and holds guests' for claiming. */
  recordMatch(
    record: MatchRecord,
    accountOf: (playerId: string) => AccountUser | null,
  ): RecordOutcome {
    const { players, ...info } = record;
    const match: MatchHandle = { info, id: null };
    const outcome: RecordOutcome = { saved: [], unsaved: [] };
    for (const player of players) {
      const user = accountOf(player.playerId);
      if (user) {
        this.save(match, user, player);
        outcome.saved.push(player.playerId);
      } else {
        const claimToken = randomBytes(24).toString('base64url');
        this.pending.set(claimToken, { match, player, expiresAt: this.now() + CLAIM_WINDOW_MS });
        outcome.unsaved.push({
          playerId: player.playerId,
          claimToken,
          expiresInMs: CLAIM_WINDOW_MS,
        });
      }
    }
    return outcome;
  }

  /** Saves a guest's held results to an account. False if the token is unknown or expired. */
  claim(claimToken: string, user: AccountUser): boolean {
    const claim = this.pending.get(claimToken);
    this.pending.delete(claimToken);
    if (!claim || claim.expiresAt < this.now()) return false;
    this.save(claim.match, user, claim.player);
    return true;
  }

  /** Forgets expired claims and sessions. */
  sweep(): void {
    const now = this.now();
    for (const [token, claim] of this.pending) {
      if (claim.expiresAt < now) this.pending.delete(token);
    }
    this.db.pruneSessions();
  }

  private save(match: MatchHandle, user: AccountUser, player: PlayerRecord) {
    match.id ??= this.db.saveMatch(match.info);
    this.db.savePlayer(match.id, user.id, player);
  }
}
