import type { ClipRouting, Context, PlayerInfo, PuzzleScore, PuzzleServerModule } from './puzzle';
import { createRng, type Rng } from './rng';

/** How often the runtime calls a module's tick(). */
export const TICK_INTERVAL_MS = 100;

export interface SessionOptions {
  seed: string;
  teamId: string;
  /** The team's players, in seat order. */
  players: readonly PlayerInfo[];
  /** Returns round time elapsed in ms, excluding pauses. */
  clock: () => number;
}

export type ActionOutcome =
  { ok: true; changed: boolean } | { ok: false; reason: string; error?: unknown };

/**
 * One team's live instance of a puzzle: the pure core shared by the server runtime and the test
 * harness. It owns state and calls into the module, but does no I/O and keeps no timers.
 */
export class PuzzleSession<State = unknown, View = unknown, Action = unknown> {
  readonly module: PuzzleServerModule<State, View, Action>;
  readonly teamId: string;
  readonly players: readonly PlayerInfo[];
  private readonly clock: () => number;
  private readonly playRng: Rng;
  private current: State;

  constructor(module: PuzzleServerModule<State, View, Action>, options: SessionOptions) {
    this.module = module;
    this.teamId = options.teamId;
    this.players = options.players;
    this.clock = options.clock;
    const puzzleId = module.manifest.id;
    this.playRng = createRng(`${options.seed}:${puzzleId}:play`);
    this.current = module.init({
      seed: options.seed,
      rng: createRng(`${options.seed}:${puzzleId}`),
      teamId: options.teamId,
      players: options.players,
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

  /** Calls the module's onSignal, if it has one. Returns whether state changed. */
  signal(playerId: string, signal: string): boolean {
    if (!this.module.onSignal || !this.hasPlayer(playerId) || this.solved) return false;
    const before = this.current;
    this.current = this.module.onSignal(before, playerId, signal, this.context());
    return this.current !== before;
  }

  /** Asks the module where a clip from this player goes. */
  routeClip(fromPlayerId: string): ClipRouting {
    if (!this.module.onClip) return { reject: "This puzzle doesn't use clips" };
    if (!this.hasPlayer(fromPlayerId)) return { reject: 'You are not on this team' };
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
      elapsedMs: this.clock(),
      rng: this.playRng,
    };
  }
}
