import type { CommsRule } from './comms';
import type { Rng } from './rng';

export interface PlayerInfo {
  id: string;
  name: string;
  /** Position within the team, starting at 0. Stable for the whole match. */
  seat: number;
}

export interface TeamInfo {
  id: string;
  name: string;
  players: PlayerInfo[];
}

export interface Range {
  min: number;
  max: number;
}

export interface PuzzleManifest {
  /** Kebab-case, must match the puzzle's folder name. */
  id: string;
  name: string;
  /** One or two sentences, shown at round intro. */
  description: string;
  /** How many teams can compete in this puzzle. */
  teams: Range;
  /** How many players per team it supports. */
  playersPerTeam: Range;
  /**
   * race: first team to solve wins the round, everyone else stops.
   * compare: every team plays until solved or time expires; best score wins.
   */
  winCondition: 'race' | 'compare';
  timeLimitSeconds: number;
  comms: CommsRule;
  /**
   * Race puzzles only: after the first team solves, other teams get this long to finish too, and
   * the fastest solve wins. Defaults to 2000.
   */
  raceGraceMs?: number;
}

export interface InitContext {
  /** Shared across all teams this round. */
  seed: string;
  /** Seeded from seed + puzzle id, so every team gets an identical puzzle. */
  rng: Rng;
  teamId: string;
  /** The players on this team, in seat order. */
  players: readonly PlayerInfo[];
}

export interface Context {
  teamId: string;
  players: readonly PlayerInfo[];
  /** Round time elapsed in ms, excluding pauses. */
  elapsedMs: number;
  /**
   * Seeded generator for randomness during play (e.g. breaking a tie). Seeded identically for
   * every team. Do not use it inside view(); views must be pure.
   */
  rng: Rng;
}

export type ApplyResult<State> = { state: State } | { reject: string };

export interface PuzzleScore {
  moves?: number;
  elapsedMs?: number;
}

/**
 * Where a recorded clip goes: each recipient with parameters for their client to apply (e.g. how
 * much to distort it), or a rejection shown to the sender.
 */
export type ClipRouting =
  { deliveries: Array<{ to: string; params: unknown }> } | { reject: string };

/**
 * The server half of a puzzle. Modules never send messages: they transform state and project
 * per-player views, and the runtime does the rest.
 *
 * State and views must be plain JSON data (no Maps, Sets, Dates or class instances), and state is
 * immutable: return a new object when something changes and the same object when nothing does.
 * The test harness enforces both.
 */
export interface PuzzleServerModule<State, View, Action> {
  manifest: PuzzleManifest;

  /** Called once per team per round. All randomness comes from ctx.rng. Never use Math.random. */
  init(ctx: InitContext): State;

  /** Per-player projection. Return only what THIS player is allowed to know. */
  view(state: State, playerId: string, ctx: Context): View;

  /**
   * Validate and apply. Return the new state, or a rejection reason shown to the player. The
   * action arrives straight from the network, so check its shape before trusting it.
   */
  apply(state: State, playerId: string, action: Action, ctx: Context): ApplyResult<State>;

  /** Optional. Called every TICK_INTERVAL_MS, for turn timers or simultaneous resolution. */
  tick?(state: State, nowMs: number, ctx: Context): State;

  /** Optional. Called when a player sends a discrete signal that should affect state. */
  onSignal?(state: State, fromPlayerId: string, signal: string, ctx: Context): State;

  /**
   * Required for puzzles with a clips comms rule. Called when a player records a clip, and again
   * (for the requester only) when a recipient sends the 'repeat' signal: say who hears it and with
   * what parameters. Computed on the server so they can depend on secrets, like how far the
   * listener's settings are from the answer.
   */
  onClip?(state: State, fromPlayerId: string, ctx: Context): ClipRouting;

  isSolved(state: State): boolean;

  /** Used to rank teams. Provide whichever apply to this puzzle. */
  score(state: State): PuzzleScore;
}

/** A module with its types erased, as held by the catalog and runtime. */
export type AnyPuzzleServerModule = PuzzleServerModule<unknown, unknown, unknown>;

/** Props the client puzzle host passes to a puzzle's view component. */
export interface PuzzleClientProps<View, Action> {
  view: View;
  send: (action: Action) => void;
  signals: {
    /** Signals this puzzle allows. The shell also renders buttons for them. */
    allowed: string[];
    send: (signal: string) => void;
    /** This round's signals, oldest first, including your own. `at` is from performance.now(). */
    incoming: Array<{ from: string; signal: string; at: number }>;
  };
  /** Present when the puzzle's comms rule is clips. */
  clips?: {
    /** Records from the mic until stop() or the rule's max length, then uploads. */
    record: () => Promise<void>;
    stop: () => void;
    recording: boolean;
    /** Clips delivered to this player this round, oldest first. `data` is base64 audio. */
    incoming: Array<{
      id: number;
      from: string;
      mime: string;
      data: string;
      params: unknown;
      at: number;
    }>;
  };
  timer: { remainingMs: number; totalMs: number };
  me: PlayerInfo;
  team: TeamInfo;
}

const PUZZLE_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function checkRange(label: string, range: Range | undefined, errors: string[]): void {
  if (!range || !Number.isInteger(range.min) || !Number.isInteger(range.max)) {
    errors.push(`${label} needs integer min and max`);
  } else if (range.min < 1 || range.max < range.min) {
    errors.push(`${label} must satisfy 1 <= min <= max (got ${range.min}-${range.max})`);
  }
}

/** Returns a list of problems with a manifest; empty means valid. */
export function validateManifest(m: PuzzleManifest): string[] {
  const errors: string[] = [];
  if (!PUZZLE_ID.test(m.id)) errors.push(`id "${m.id}" must be kebab-case`);
  if (!m.name?.trim()) errors.push('name is required');
  if (!m.description?.trim()) errors.push('description is required');
  checkRange('teams', m.teams, errors);
  checkRange('playersPerTeam', m.playersPerTeam, errors);
  if (m.winCondition !== 'race' && m.winCondition !== 'compare') {
    errors.push(`winCondition must be 'race' or 'compare'`);
  }
  if (!(m.timeLimitSeconds > 0)) errors.push('timeLimitSeconds must be positive');
  if (m.raceGraceMs !== undefined && !(m.raceGraceMs >= 0)) {
    errors.push('raceGraceMs cannot be negative');
  }

  const comms = m.comms;
  switch (comms?.type) {
    case 'voice':
      if (comms.scope !== 'team' && comms.scope !== 'all') {
        errors.push(`voice scope must be 'team' or 'all'`);
      }
      break;
    case 'none':
      break;
    case 'signals':
      if (comms.signals.length === 0) errors.push('signals comms needs at least one signal');
      if (new Set(comms.signals).size !== comms.signals.length)
        errors.push('signals must be unique');
      if (comms.cooldownMs !== undefined && comms.cooldownMs < 0) {
        errors.push('cooldownMs cannot be negative');
      }
      break;
    case 'clips':
      if (!(comms.maxSeconds > 0)) errors.push('clips maxSeconds must be positive');
      break;
    default:
      errors.push('comms.type must be voice, none, signals or clips');
  }
  return errors;
}
