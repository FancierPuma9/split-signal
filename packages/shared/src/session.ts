import {
  isSignalReject,
  type ClipRouting,
  type CommsState,
  type Context,
  type PlayerCommsGate,
  type PlayerInfo,
  type PuzzleAsset,
  type PuzzleScore,
  type PuzzleServerModule,
  type TeamRoster,
} from './puzzle';
import { createRng, type Rng } from './rng';

/** How often the runtime calls a module's tick(). */
export const TICK_INTERVAL_MS = 100;

export interface SessionOptions {
  seed: string;
  /** The team for per-team puzzles; 'shared' for a shared instance. */
  teamId: string;
  /** Everyone in this instance, in team then seat order. */
  players: readonly PlayerInfo[];
  /** Defaults to a single team made of `players`. */
  teams?: readonly TeamRoster[];
  roundIndex?: number;
  /** Returns round time elapsed in ms, excluding pauses. */
  clock: () => number;
  /** Engine-managed comms state for this instance. */
  comms?: () => CommsState;
}

export type ActionOutcome =
  { ok: true; changed: boolean } | { ok: false; reason: string; error?: unknown };

/**
 * One live instance of a puzzle (a team's, or the whole room's for shared puzzles): the pure core
 * shared by the server runtime and the test harness. It owns state and calls into the module, but
 * does no I/O and keeps no timers.
 */
export class PuzzleSession<State = unknown, View = unknown, Action = unknown> {
  readonly module: PuzzleServerModule<State, View, Action>;
  readonly teamId: string;
  readonly players: readonly PlayerInfo[];
  readonly teams: readonly TeamRoster[];
  private readonly clock: () => number;
  private readonly comms: () => CommsState;
  private readonly playRng: Rng;
  private current: State;

  constructor(module: PuzzleServerModule<State, View, Action>, options: SessionOptions) {
    this.module = module;
    this.teamId = options.teamId;
    this.players = options.players;
    this.teams = options.teams ?? [
      { id: options.teamId, name: options.teamId, playerIds: options.players.map((p) => p.id) },
    ];
    this.clock = options.clock;
    this.comms = options.comms ?? (() => ({}));
    const puzzleId = module.manifest.id;
    this.playRng = createRng(`${options.seed}:${puzzleId}:play`);
    this.current = module.init({
      seed: options.seed,
      rng: createRng(`${options.seed}:${puzzleId}`),
      teamId: options.teamId,
      players: options.players,
      teams: this.teams,
      roundIndex: options.roundIndex ?? 0,
    });
  }

  get state(): State {
    return this.current;
  }

  get elapsedMs(): number {
    return this.clock();
  }

  get solved(): boolean {
    return this.module.isSolved(this.current);
  }

  hasPlayer(playerId: string): boolean {
    return this.players.some((p) => p.id === playerId);
  }

  /** The end-of-round view, or undefined if the module has no reveal(). */
  reveal(playerId: string): View | undefined {
    return this.module.reveal?.(this.current, playerId, this.context());
  }

  view(playerId: string): View {
    return this.module.view(this.current, playerId, this.context());
  }

  apply(playerId: string, action: unknown): ActionOutcome {
    if (!this.hasPlayer(playerId)) return { ok: false, reason: 'You are not on this team' };
    if (this.solved) return { ok: false, reason: 'Already solved' };
    const before = this.current;
    try {
      const result = this.module.apply(before, playerId, action as Action, this.context());
      if ('reject' in result) return { ok: false, reason: result.reject };
      this.current = result.state;
      return { ok: true, changed: result.state !== before };
    } catch (error) {
      return { ok: false, reason: 'Invalid action', error };
    }
  }

  /**
   * Calls the module's onSignal, if it has one. A refusal means the signal must not be relayed
   * either.
   */
  signal(playerId: string, signal: string, to?: string): ActionOutcome {
    if (!this.hasPlayer(playerId)) return { ok: false, reason: 'You are not on this team' };
    if (!this.module.onSignal || this.solved) return { ok: true, changed: false };
    const before = this.current;
    const result = this.module.onSignal(before, playerId, signal, this.context(), to);
    if (isSignalReject(result)) return { ok: false, reason: result.reject };
    this.current = result;
    return { ok: true, changed: result !== before };
  }

  /** The module's voice overrides for one player ({} if it has no commsState). */
  commsState(playerId: string): PlayerCommsGate {
    return this.module.commsState?.(this.current, playerId, this.context()) ?? {};
  }

  /**
   * The assets one player should have, minus the ids in `have` (thunks resolved only for new
   * ids). Empty if the module has no assets().
   */
  newAssets(playerId: string, have: ReadonlySet<string>): Record<string, PuzzleAsset> {
    const all = this.module.assets?.(this.current, playerId, this.context()) ?? {};
    const fresh: Record<string, PuzzleAsset> = {};
    for (const [id, asset] of Object.entries(all)) {
      if (!have.has(id)) fresh[id] = typeof asset === 'function' ? asset() : asset;
    }
    return fresh;
  }

  /** Asks the module where a clip from this player goes; null if it has no onClip. */
  routeClip(fromPlayerId: string): ClipRouting | null {
    if (!this.hasPlayer(fromPlayerId)) return { reject: 'You are not on this team' };
    if (!this.module.onClip) return null;
    return this.module.onClip(this.current, fromPlayerId, this.context());
  }

  /** Calls the module's tick, if it has one. Returns whether state changed. */
  tick(): boolean {
    if (!this.module.tick || this.solved) return false;
    const before = this.current;
    const ctx = this.context();
    this.current = this.module.tick(before, ctx.elapsedMs, ctx);
    return this.current !== before;
  }

  score(): PuzzleScore {
    return this.module.score(this.current);
  }

  private context(): Context {
    return {
      teamId: this.teamId,
      players: this.players,
      teams: this.teams,
      elapsedMs: this.clock(),
      rng: this.playRng,
      comms: this.comms(),
    };
  }
}
