import { validateComms, type CommsSpec } from './comms';
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
  /**
   * One line on what wins, shown at round intro (e.g. "Most grabs wins"). Defaults to a line
   * based on winCondition, which for compare assumes fewest moves.
   */
  goal?: string;
  timeLimitSeconds: number;
  /** One comms rule, or several applied together (e.g. signals plus one-way voice). */
  comms: CommsSpec;
  /**
   * One line on how players communicate, shown instead of the description generated from comms
   * (for rules whose effect the puzzle shapes, e.g. with commsState).
   */
  commsLabel?: string;
  /** How points read in results, e.g. '%' for a percentage. Defaults to ' pts'. */
  pointsUnit?: string;
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
  /** Display name, e.g. "Red". */
  name: string;
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
  /** clips with direction 'ring': who this player's clips go to, and who theirs come from. */
  ring?: { next: string; prev: string };
  /** budget-clips with budgetSends: sends left in this player's pool (their own, or the team's). */
  sends?: { left: number; total: number; scope: 'player' | 'team' };
  /** The puzzle's commsState() has switched this player's mic off. */
  micClosed?: boolean;
}

/**
 * Per-player comms overrides a puzzle returns from commsState(). Everything defaults to open; the
 * server enforces the result on top of the manifest's voice rule.
 */
export interface PlayerCommsGate {
  /** May this player's mic transmit right now. */
  send?: boolean;
  /** May this player hear anything right now. */
  receive?: boolean;
  /**
   * Per-source overrides: whether this player can hear each listed player, and a volume hint
   * (0-1) their client applies. Unlisted players are audible at full volume.
   */
  peers?: Record<string, { audible: boolean; gain?: number }>;
  /**
   * voice-replay: ask this player's client to replay something `from` said between two round
   * times (ms). A new id triggers a replay; the client answers __replayMissed if it had nothing.
   */
  replay?: ReplayRequest;
}

export interface ReplayRequest {
  id: number;
  from: string;
  windowStartMs: number;
  windowEndMs: number;
}

/** A binary file (e.g. audio) sent to a player alongside their view. data is base64. */
export interface PuzzleAsset {
  mime: string;
  data: string;
}

/**
 * Actions the client shell sends on its own (never the puzzle's UI). Puzzles that don't use them
 * can ignore them: returning the same state accepts them silently.
 *   __micLevel: the player's mic loudness, about ten times a second, for voice with reportLevel.
 *   __replayMissed: a voice-replay request found nothing to replay in its window.
 */
export type ShellAction =
  { type: '__micLevel'; db: number } | { type: '__replayMissed'; id: number };

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

/** onSignal's result: the new state, or a refusal (the signal is then neither applied nor relayed). */
export type SignalResult<State> = State | { reject: string };

/** Whether an onSignal result is a refusal. States must not be a lone { reject } object. */
export function isSignalReject(result: unknown): result is { reject: string } {
  return (
    typeof result === 'object' &&
    result !== null &&
    typeof (result as { reject?: unknown }).reject === 'string' &&
    Object.keys(result).length === 1
  );
}

export interface TeamScore {
  /** Shared instances: whether this team finished (race puzzles). */
  solved?: boolean;
  moves?: number;
  /** May include penalties. */
  elapsedMs?: number;
  /** Compare puzzles only: higher is better. When present it decides the round. */
  points?: number;
  /** Breaks ties between equal points, before time (higher is better; not shown). */
  tiebreak?: number;
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
   * Optional. Called when a player sends a discrete signal, before it's relayed. `to` is set for
   * signals aimed at one player (shared instances). Return { reject } to refuse it: it's then
   * neither applied nor relayed (e.g. a sound that isn't unlocked yet).
   */
  onSignal?(
    state: State,
    fromPlayerId: string,
    signal: string,
    ctx: Context,
    to?: string,
  ): SignalResult<State>;

  /**
   * Optional. Per-player voice overrides (see PlayerCommsGate): who may talk, who may hear, and
   * how loud each source is. Called after every state change; the engine sends only changes.
   */
  commsState?(state: State, playerId: string, ctx: Context): PlayerCommsGate;

  /**
   * Optional. Binary files a player needs that are too big for their view (e.g. an audio clip
   * built for them), keyed by a stable id. Each id is sent to a player once per round, so its data
   * must never change. Called after every state change: return a function for data that's costly
   * to build, and it's only called for ids the player doesn't have yet.
   */
  assets?(
    state: State,
    playerId: string,
    ctx: Context,
  ): Record<string, PuzzleAsset | (() => PuzzleAsset)>;

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
  /** Files the puzzle's assets() sent this player this round, by id. */
  assets: Record<string, PuzzleAsset>;
  /**
   * Your own mic loudness in dBFS, about ten times a second (voice with reportLevel only; null
   * while the mic is off).
   */
  micLevel?: number | null;
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
  if (m.goal !== undefined && !m.goal.trim()) errors.push('goal cannot be empty');
  if (m.raceGraceMs !== undefined && !(m.raceGraceMs >= 0)) {
    errors.push('raceGraceMs cannot be negative');
  }
  if (m.instance !== undefined && m.instance !== 'per-team' && m.instance !== 'shared') {
    errors.push(`instance must be 'per-team' or 'shared'`);
  }
  errors.push(...validateComms(m.comms));
  return errors;
}
