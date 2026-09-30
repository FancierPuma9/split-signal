import {
  PuzzleSession,
  type AnyPuzzleServerModule,
  type ClipRouting,
  type PlayerCommsGate,
  type PlayerInfo,
  type PuzzleAsset,
  type PuzzleScore,
  type SessionOptions,
} from '@split-signal/shared';

export interface RuntimeHooks {
  sendView(playerId: string, view: unknown): void;
  sendReject(playerId: string, reason: string): void;
  /** A file from the puzzle's assets() that this player doesn't have yet. */
  sendAsset?(playerId: string, id: string, asset: PuzzleAsset): void;
  /** The puzzle's commsState() changed for at least one player. */
  onCommsState?(): void;
  /** Called once, the first time the puzzle becomes solved. */
  onSolved(): void;
  onError(error: unknown, context: string): void;
  /** Called after any state change (before onSolved). */
  onChange?(): void;
}

export type RuntimeOptions = SessionOptions;

/**
 * One puzzle instance on the server (a team's, or the room's for shared puzzles). Routes actions
 * to the module, recomputes every player's view after each change, and sends only the views that
 * actually changed.
 */
export class PuzzleRuntime {
  private readonly session: PuzzleSession;
  private readonly hooks: RuntimeHooks;
  private readonly lastSent = new Map<string, string>();
  /** Asset ids each player has been sent this round. */
  private readonly assetsSent = new Map<string, Set<string>>();
  private gates: Record<string, PlayerCommsGate> = {};
  private gatesJson = '{}';
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
    this.updateGates();
  }

  /** The puzzle's current commsState() for every player (empty without commsState()). */
  commsGates(): Record<string, PlayerCommsGate> {
    return this.gates;
  }

  /** quiet: don't tell the player about a rejection (for actions the shell sends itself). */
  handleAction(playerId: string, payload: unknown, quiet = false): void {
    const outcome = this.session.apply(playerId, payload);
    if (!outcome.ok) {
      if (outcome.error !== undefined) this.hooks.onError(outcome.error, 'apply');
      if (!quiet) this.hooks.sendReject(playerId, outcome.reason);
      return;
    }
    if (outcome.changed) this.afterChange();
  }

  /** Passes a signal to the puzzle. Returns why it was refused (don't relay it), or null. */
  handleSignal(playerId: string, signal: string, to?: string): string | null {
    let refusal: string | null = null;
    this.guard('onSignal', () => {
      const outcome = this.session.signal(playerId, signal, to);
      if (!outcome.ok) refusal = outcome.reason;
      else if (outcome.changed) this.afterChange();
    });
    return refusal;
  }

  tick(): void {
    this.guard('tick', () => {
      if (this.session.tick()) this.afterChange();
    });
  }

  /** Round time (ms) now, for the engine's comms bookkeeping. */
  get elapsedMs(): number {
    return this.session.elapsedMs;
  }

  /** Where a clip from this player goes, according to the puzzle (null: use the default). */
  routeClip(playerId: string): ClipRouting | null {
    try {
      return this.session.routeClip(playerId);
    } catch (error) {
      this.hooks.onError(error, 'onClip');
      return { reject: 'Could not send that clip' };
    }
  }

  /** The current view for one player, without sending it. */
  viewFor(playerId: string): unknown {
    try {
      return this.session.view(playerId);
    } catch (error) {
      this.hooks.onError(error, 'view');
      return null;
    }
  }

  /** The end-of-round view for one player, or undefined if the puzzle has none. */
  revealFor(playerId: string): unknown {
    try {
      return this.session.reveal(playerId);
    } catch (error) {
      this.hooks.onError(error, 'reveal');
      return undefined;
    }
  }

  /** Recomputes everyone's view, e.g. after comms state (like who is live) changed. */
  refresh(): void {
    this.publish();
    this.updateGates();
  }

  /** Re-sends the current view (and assets) to one player, e.g. after they reconnect. */
  resendView(playerId: string): void {
    this.lastSent.delete(playerId);
    this.assetsSent.delete(playerId);
    this.publish([playerId]);
  }

  private afterChange(): void {
    this.publish();
    this.updateGates();
    this.hooks.onChange?.();
    if (this.session.solved && !this.solvedReported) {
      this.solvedReported = true;
      this.hooks.onSolved();
    }
  }

  private publish(playerIds = this.session.players.map((p) => p.id)): void {
    for (const playerId of playerIds) {
      // Assets first, so a view that refers to one never arrives before it.
      this.guard('assets', () => this.publishAssets(playerId));
      this.guard('view', () => {
        const view = this.session.view(playerId);
        const serialized = JSON.stringify(view);
        if (this.lastSent.get(playerId) === serialized) return;
        this.lastSent.set(playerId, serialized);
        this.hooks.sendView(playerId, view);
      });
    }
  }

  private publishAssets(playerId: string): void {
    const send = this.hooks.sendAsset;
    if (!send || !this.session.module.assets) return;
    let have = this.assetsSent.get(playerId);
    if (!have) {
      have = new Set();
      this.assetsSent.set(playerId, have);
    }
    for (const [id, asset] of Object.entries(this.session.newAssets(playerId, have))) {
      have.add(id);
      send(playerId, id, asset);
    }
  }

  private updateGates(): void {
    if (!this.session.module.commsState) return;
    this.guard('commsState', () => {
      const gates = Object.fromEntries(
        this.session.players.map((p) => [p.id, this.session.commsState(p.id)]),
      );
      const json = JSON.stringify(gates);
      if (json === this.gatesJson) return;
      this.gates = gates;
      this.gatesJson = json;
      this.hooks.onCommsState?.();
    });
  }

  private guard(context: string, fn: () => void): void {
    try {
      fn();
    } catch (error) {
      this.hooks.onError(error, context);
    }
  }
}
