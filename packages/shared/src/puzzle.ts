import { validateComms, type CommsRule } from './comms';
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
  /**
   * per-team (default): one instance per team. shared: one instance for the whole room (arena);
   * init gets every player plus `teams`, and score() reports per team.
   */
  instance?: 'per-team' | 'shared';
}

export interface TeamRoster {
  id: string;
  playerIds: string[];
}

export interface InitContext {
  /** Shared across all teams this round. */
  seed: string;
  /** Seeded from seed + puzzle id, so every team gets an identical puzzle. */
  rng: Rng;
  /** The team for per-team puzzles; 'shared' for shared-instance puzzles. */
  teamId: string;
  /** The players in this instance, in team then seat order. */
  players: readonly PlayerInfo[];
  /** The teams in this instance: one for per-team puzzles, all of them for shared ones. */
  teams: readonly TeamRoster[];
  /** 0-based round number within the match (e.g. to rotate roles). */
  roundIndex: number;
}

/**
 * Communication state the engine manages and puzzles may read (and clients see), e.g. who is live
 * under voice-alternating.
 */
export interface CommsState {
  /** voice-alternating: who may talk right now. */
  activePlayerId?: string;
  /** voice-alternating with warningMs: time until the next swap, inside the warning window. */
  swapInMs?: number;
  /** voice-timed: time left before voice closes (0 once closed). */
  voiceRemainingMs?: number;
  /** budget-clips: each player's remaining mic time this round. */
  budgets?: Record<string, number>;
  /** Clip rules: this player's clips that haven't been delivered yet. */
  pendingDeliveries?: number;
}

export interface Context {
  teamId: string;
  players: readonly PlayerInfo[];
  teams: readonly TeamRoster[];
  /** Round time elapsed in ms, excluding pauses. */
  elapsedMs: number;
  /**
   * Seeded generator for randomness during play (e.g. breaking a tie). Seeded identically for
   * every team. Do not use it inside view(); views must be pure.
   */
  rng: Rng;
  /** Engine-managed comms state for this instance (e.g. activePlayerId). */
  comms: CommsState;
}

export type ApplyResult<State> = { state: State } | { reject: string };

export interface TeamScore {
  /** Shared instances: whether this team finished (race puzzles). */
  solved?: boolean;
  moves?: number;
  /** May include penalties. */
  elapsedMs?: number;
  /** Compare puzzles only: higher is better. When present it decides the round. */
  points?: number;
}

/**
 * Per-team puzzles return their own team's score. Shared-instance puzzles return `teams` with an
 * entry for every team.
 */
export interface PuzzleScore extends TeamScore {
  teams?: Record<string, TeamScore>;
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

  /** Called once per instance per round. All randomness comes from ctx.rng. Never Math.random. */
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

  /**
   * Optional. Called when a player sends a discrete signal. `to` is set for signals aimed at one
   * player (shared instances).
   */
  onSignal?(state: State, fromPlayerId: string, signal: string, ctx: Context, to?: string): State;

  /**
   * Where a clip goes and with what parameters. Required for the 'clips' rule; optional for
   * delayed-clips and budget-clips, which default to "every teammate, clean". Also called (for
   * the requester only) when a recipient sends 'repeat'. Runs on the server, so parameters can
   * depend on secrets.
   */
  onClip?(state: State, fromPlayerId: string, ctx: Context): ClipRouting;

  /**
   * Optional. The view each player gets once the round is over, shown under the scoreboard (e.g.
   * the answer next to what the team did). Only called after the round ends, so it may show
   * anything. Rendered by the same client component as view().
   */
  reveal?(state: State, playerId: string, ctx: Context): View;

  /** Per-team: this team is done. Shared: the round is over. */
  isSolved(state: State): boolean;

  /** Used to rank teams. Provide whichever apply to this puzzle. */
  score(state: State): PuzzleScore;
}

/** A module with its types erased, as held by the catalog and runtime. */
export type AnyPuzzleServerModule = PuzzleServerModule<unknown, unknown, unknown>;

export interface ClipDelivery {
  id: number;
  from: string;
  mime: string;
  data: string;
  params: unknown;
  at: number;
}

/** A batch of pen samples. Coordinates are normalized to [0, 1]; dt is ms since the batch began. */
export interface DrawBatch {
  strokeId: string;
  points: Array<{ x: number; y: number; dt: number }>;
  done: boolean;
}

/** Props the client puzzle host passes to a puzzle's view component. */
export interface PuzzleClientProps<View, Action> {
  view: View;
  send: (action: Action) => void;
  signals: {
    /** Signals this puzzle allows. The shell also renders buttons for them. */
    allowed: string[];
    /** `to` targets one player (shared instances). */
    send: (signal: string, to?: string) => void;
    /** This round's signals, oldest first, including your own. `at` is from performance.now(). */
    incoming: Array<{ from: string; signal: string; at: number }>;
  };
  /** Present for clip rules (clips, delayed-clips, budget-clips). */
  clips?: {
    /** Records from the mic until stop() or the rule's max length, then uploads. */
    record: () => Promise<void>;
    stop: () => void;
    recording: boolean;
    /** Clips delivered to this player this round, oldest first. `data` is base64 audio. */
    incoming: ClipDelivery[];
  };
  /** Present for the draw rule. Batches arrive outside React state; subscribe to receive them. */
  draw?: {
    fadeMs: number;
    send: (batch: DrawBatch) => void;
    /** Returns an unsubscribe function. `at` is the receive time from performance.now(). */
    subscribe: (listener: (from: string, batch: DrawBatch, at: number) => void) => () => void;
  };
  /** Engine-managed comms state (who is live, mic budgets, voice countdown, clips in flight). */
  comms: CommsState & { receivedAt: number };
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
  if (m.instance !== undefined && m.instance !== 'per-team' && m.instance !== 'shared') {
    errors.push(`instance must be 'per-team' or 'shared'`);
  }
  errors.push(...validateComms(m.comms));
  return errors;
}
