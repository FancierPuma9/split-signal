import {
  PuzzleSession,
  type AnyPuzzleServerModule,
  type ClipRouting,
  type PlayerInfo,
  type PuzzleScore,
} from '@split-signal/shared';

export interface RuntimeHooks {
  sendView(playerId: string, view: unknown): void;
  sendReject(playerId: string, reason: string): void;
  /** Called once, the first time the puzzle becomes solved. */
  onSolved(): void;
  onError(error: unknown, context: string): void;
}

export interface RuntimeOptions {
  seed: string;
  teamId: string;
  players: readonly PlayerInfo[];
  clock: () => number;
}

/**
 * One team's puzzle instance on the server. Routes actions to the module, recomputes every
 * player's view after each change, and sends only the views that actually changed.
 */
export class PuzzleRuntime {
  private readonly session: PuzzleSession;
  private readonly hooks: RuntimeHooks;
  private readonly lastSent = new Map<string, string>();
  private solvedReported = false;

  constructor(module: AnyPuzzleServerModule, options: RuntimeOptions, hooks: RuntimeHooks) {
    this.session = new PuzzleSession(module, options);
    this.hooks = hooks;
  }

  get solved(): boolean {
    return this.session.solved;
  }

  get players(): readonly PlayerInfo[] {
    return this.session.players;
  }

  score(): PuzzleScore {
    return this.session.score();
  }

  /** Sends every player their initial view. */
  start(): void {
    this.publish();
  }

  handleAction(playerId: string, payload: unknown): void {
    const outcome = this.session.apply(playerId, payload);
    if (!outcome.ok) {
      if (outcome.error !== undefined) this.hooks.onError(outcome.error, 'apply');
      this.hooks.sendReject(playerId, outcome.reason);
      return;
    }
    if (outcome.changed) this.afterChange();
  }

  handleSignal(playerId: string, signal: string): void {
    this.guard('onSignal', () => {
      if (this.session.signal(playerId, signal)) this.afterChange();
    });
  }

  tick(): void {
    this.guard('tick', () => {
      if (this.session.tick()) this.afterChange();
    });
  }

  /** Where a clip from this player goes, according to the puzzle. */
  routeClip(playerId: string): ClipRouting {
    try {
      return this.session.routeClip(playerId);
    } catch (error) {
      this.hooks.onError(error, 'onClip');
      return { reject: 'Could not send that clip' };
    }
  }

  /** Re-sends the current view to one player, e.g. after they reconnect. */
  resendView(playerId: string): void {
    this.lastSent.delete(playerId);
    this.publish([playerId]);
  }

  private afterChange(): void {
    this.publish();
    if (this.session.solved && !this.solvedReported) {
      this.solvedReported = true;
      this.hooks.onSolved();
    }
  }

  private publish(playerIds = this.session.players.map((p) => p.id)): void {
    for (const playerId of playerIds) {
      this.guard('view', () => {
        const view = this.session.view(playerId);
        const serialized = JSON.stringify(view);
        if (this.lastSent.get(playerId) === serialized) return;
        this.lastSent.set(playerId, serialized);
        this.hooks.sendView(playerId, view);
      });
    }
  }

  private guard(context: string, fn: () => void): void {
    try {
      fn();
    } catch (error) {
      this.hooks.onError(error, context);
    }
  }
}
