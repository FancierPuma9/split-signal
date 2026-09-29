import { fileURLToPath } from 'node:url';
import { devPuzzles, findPuzzle, puzzles } from '@split-signal/puzzles';
import type { IceServerConfig } from '@split-signal/shared';
import { startServer } from './app';
import { GoogleVerifier } from './auth/google';
import { AccountService } from './stats/accounts';
import { StatsDb } from './stats/stats-db';

const PORT = Number(process.env.PORT ?? 3001);
// `pnpm dev --puzzle <id>` sets this: every round uses that one puzzle.
const FORCED_PUZZLE = process.env.SPLIT_SIGNAL_PUZZLE || undefined;

function loadCatalog() {
  if (!FORCED_PUZZLE) return puzzles;
  const puzzle = findPuzzle(FORCED_PUZZLE);
  if (!puzzle) {
    const available = [...puzzles, ...devPuzzles].map((p) => p.manifest.id).join(', ');
    console.error(`Unknown puzzle "${FORCED_PUZZLE}". Available: ${available}`);
    process.exit(1);
  }
  return [puzzle];
}

/** SPLIT_SIGNAL_ICE_SERVERS: JSON array of RTCIceServer objects, e.g. to add a TURN server. */
function loadIceServers(): IceServerConfig[] | undefined {
  const raw = process.env.SPLIT_SIGNAL_ICE_SERVERS;
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed as IceServerConfig[];
  } catch {
    // Fall through to the error below.
  }
  console.error('SPLIT_SIGNAL_ICE_SERVERS must be a JSON array of ICE server objects');
  process.exit(1);
}

/**
 * SPLIT_SIGNAL_GOOGLE_CLIENT_ID turns on Google sign-in and stats, kept in SQLite at
 * SPLIT_SIGNAL_DB (default data/split-signal.db). Without it everyone plays as a guest.
 */
function loadAccounts(): AccountService | undefined {
  const clientId = process.env.SPLIT_SIGNAL_GOOGLE_CLIENT_ID;
  if (!clientId) return undefined;
  const db = new StatsDb(process.env.SPLIT_SIGNAL_DB ?? 'data/split-signal.db');
  return new AccountService(db, new GoogleVerifier(clientId));
}

const accounts = loadAccounts();
const server = await startServer({
  port: PORT,
  catalog: loadCatalog(),
  clientDist: fileURLToPath(new URL('../../client/dist', import.meta.url)),
  iceServers: loadIceServers(),
  accounts,
});

const mode = FORCED_PUZZLE ? ` (only puzzle: ${FORCED_PUZZLE})` : '';
const signIn = accounts ? 'Google sign-in on' : 'guests only (no SPLIT_SIGNAL_GOOGLE_CLIENT_ID)';
console.log(`Split Signal server on http://localhost:${server.port}${mode}, ${signIn}`);
