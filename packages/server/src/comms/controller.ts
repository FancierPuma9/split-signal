import {
  CLIP_COOLDOWN_MS,
  MAX_DRAW_BATCHES_PER_SECOND,
  createRng,
  isClipRule,
  type ClipRouting,
  type CommsRule,
  type CommsState,
  type DrawBatch,
  type Rng,
  type ServerMessage,
} from '@split-signal/shared';

export interface CommsTeam {
  id: string;
  players: ReadonlyArray<{ id: string; seat: number }>;
}

export interface CommsControllerOptions {
  rule: CommsRule;
  /** The round's seed, shared by every team, so schedules and delays match across teams. */
  seed: string;
  puzzleId: string;
  teams: readonly CommsTeam[];
  /** Match clock: pauses freeze everything here too. */
  now: () => number;
  send: (playerId: string, message: ServerMessage) => void;
  /** The puzzle's routing for a clip (null: it has no onClip, use the default). */
  routeClip: (teamId: string, fromPlayerId: string) => ClipRouting | null;
  /** For draw from 'role': whether this player's view says canDraw. */
  canDraw: (teamId: string, playerId: string) => boolean;
  /** Puzzle-visible comms state changed for these teams (e.g. a voice swap). */
  onChange: (teamIds: string[]) => void;
}

interface Clip {
  mime: string;
  data: string;
}

interface PendingDelivery {
  deliverAt: number;
  from: string;
  clip: Clip;
  deliveries: Array<{ to: string; params: unknown }>;
}

/**
 * Runs one round's communication rules on the server: clip delivery (with delay, jitter and mic
 * budgets), one-way-at-a-time voice swaps, timed voice, and the draw stream. Everything is driven
 * by tick() on the match clock and seeded from the round seed.
 */
export class CommsController {
  private readonly o: CommsControllerOptions;
  private readonly start: number;
  private readonly teamOf = new Map<string, CommsTeam>();
  private readonly lastSent = new Map<string, string>();

  private readonly lastClipAt = new Map<string, number>();
  private readonly lastClip = new Map<string, { from: string; clip: Clip }>();
  private readonly pending: PendingDelivery[] = [];
  private readonly budgets = new Map<string, number>();
  private readonly jitter = new Map<string, Rng>();
  private clipCounter = 0;

  private swapRng: Rng | null = null;
  private activeIndex = 0;
  private nextSwapAt = Infinity;
  private swapWarned = false;

  private voiceClosesAt: number | null = null;
  private voiceOpen = true;

  private readonly drawTokens = new Map<string, { tokens: number; at: number }>();

  constructor(options: CommsControllerOptions) {
    this.o = options;
    this.start = options.now();
    for (const team of options.teams) {
      for (const player of team.players) this.teamOf.set(player.id, team);
    }
    const { rule } = options;
    if (rule.type === 'budget-clips') {
      for (const id of this.teamOf.keys()) this.budgets.set(id, rule.budgetSeconds * 1000);
    }
    if (rule.type === 'voice-alternating') {
      this.swapRng = createRng(`${options.seed}:${options.puzzleId}:swaps`);
      this.activeIndex = this.swapRng.int(0, 1);
      this.nextSwapAt = this.start + this.swapRng.int(...rule.swapIntervalMs);
    }
    if (rule.type === 'voice-timed') {
      this.voiceClosesAt = this.start + rule.openSeconds * 1000;
    }
  }

  /** Sends everyone their starting comms state. */
  begin(): void {
    this.syncStates();
  }

  tick(): void {
    const now = this.o.now();
    const due = this.pending.filter((p) => p.deliverAt <= now);
    if (due.length > 0) {
      for (const item of due) {
        this.pending.splice(this.pending.indexOf(item), 1);
        this.deliver(item.from, item.clip, item.deliveries);
      }
      this.syncStates();
    }

    const { rule } = this.o;
    if (rule.type === 'voice-alternating' && this.swapRng) {
      let swapped = false;
      while (now >= this.nextSwapAt) {
        this.activeIndex += 1;
        this.nextSwapAt += this.swapRng.int(...rule.swapIntervalMs);
        this.swapWarned = false;
        swapped = true;
      }
      const warn =
        rule.warningMs !== undefined && !this.swapWarned && this.nextSwapAt - now <= rule.warningMs;
      if (warn) this.swapWarned = true;
      if (swapped) this.o.onChange(this.o.teams.map((t) => t.id));
      if (swapped || warn) this.syncStates();
    }

    if (this.voiceClosesAt !== null && this.voiceOpen && now >= this.voiceClosesAt) {
      this.voiceOpen = false;
      this.o.onChange(this.o.teams.map((t) => t.id));
      this.syncStates();
    }
  }

  /** Handles a recorded clip. Returns a reason to show the sender if it was refused. */
  handleClip(playerId: string, clip: Clip & { durationMs: number }): string | null {
    const team = this.teamOf.get(playerId);
    const { rule } = this.o;
    if (!team) return 'You are not in this round';
    if (!isClipRule(rule)) return "This puzzle doesn't use clips";
    if (clip.durationMs > rule.maxSeconds * 1000 + 500) {
      return `Clips can be at most ${rule.maxSeconds} seconds`;
    }
    const now = this.o.now();
    const last = this.lastClipAt.get(playerId);
    if (last !== undefined && now - last < CLIP_COOLDOWN_MS) return 'Wait a moment first';

    let playMs: number | undefined;
    if (rule.type === 'budget-clips') {
      const remaining = this.budgets.get(playerId) ?? 0;
      if (remaining <= 0) return "You're out of mic time";
      if (clip.durationMs > remaining) playMs = remaining;
    }

    const routing = this.routingFor(team, playerId, rule.type === 'clips');
    if ('reject' in routing) return routing.reject;
    const deliveries =
      playMs === undefined
        ? routing.deliveries
        : routing.deliveries.map((d) => ({ ...d, params: { ...asObject(d.params), playMs } }));

    if (rule.type === 'budget-clips') {
      const remaining = this.budgets.get(playerId) ?? 0;
      this.budgets.set(playerId, Math.max(0, remaining - (playMs ?? clip.durationMs)));
    }
    this.lastClipAt.set(playerId, now);
    const stored: Clip = { mime: clip.mime, data: clip.data };
    this.lastClip.set(team.id, { from: playerId, clip: stored });

    if (rule.type === 'delayed-clips') {
      const delay = rule.delayMs ?? this.jitterFor(playerId, rule.delayRangeMs ?? [0, 0]);
      // The clip arrives `delay` after the speaker started talking (never before it was sent).
      const recordStart = Math.max(this.start, now - clip.durationMs);
      const deliverAt = Math.max(now, recordStart + delay);
      if (deliverAt > now) {
        this.pending.push({ deliverAt, from: playerId, clip: stored, deliveries });
        this.syncStates();
        return null;
      }
    }
    this.deliver(playerId, stored, deliveries);
    this.syncStates();
    return null;
  }

  /** 'repeat': re-sends the team's latest clip to the asker, with freshly computed params. */
  repeat(playerId: string): void {
    const team = this.teamOf.get(playerId);
    const latest = team && this.lastClip.get(team.id);
    if (!team || !latest) return;
    const routing = this.routingFor(team, latest.from, this.o.rule.type === 'clips');
    if ('reject' in routing) return;
    this.deliver(
      latest.from,
      latest.clip,
      routing.deliveries.filter((d) => d.to === playerId),
    );
  }

  /** Relays a draw batch to the drawer's teammates, if they may draw and aren't flooding. */
  handleDraw(playerId: string, batch: DrawBatch): void {
    const team = this.teamOf.get(playerId);
    const { rule } = this.o;
    if (!team || rule.type !== 'draw') return;
    if (rule.from === 'role' && !this.o.canDraw(team.id, playerId)) return;

    const now = this.o.now();
    const bucket = this.drawTokens.get(playerId) ?? {
      tokens: MAX_DRAW_BATCHES_PER_SECOND,
      at: now,
    };
    const tokens = Math.min(
      MAX_DRAW_BATCHES_PER_SECOND,
      bucket.tokens + ((now - bucket.at) / 1000) * MAX_DRAW_BATCHES_PER_SECOND,
    );
    if (tokens < 1) {
      this.drawTokens.set(playerId, { tokens, at: now });
      return;
    }
    this.drawTokens.set(playerId, { tokens: tokens - 1, at: now });
    for (const member of team.players) {
      if (member.id !== playerId)
        this.o.send(member.id, { type: 'comms.draw', from: playerId, batch });
    }
  }

  /** What puzzles see in ctx.comms for this team. */
  contextFor(teamId: string): CommsState {
    const team = this.o.teams.find((t) => t.id === teamId);
    const state: CommsState = {};
    const active = team && this.activeFor(team);
    if (active) state.activePlayerId = active;
    if (this.voiceClosesAt !== null) {
      state.voiceRemainingMs = Math.max(0, this.voiceClosesAt - this.o.now());
    }
    return state;
  }

  /** What one player's client sees. */
  stateFor(playerId: string): CommsState {
    const team = this.teamOf.get(playerId);
    if (!team) return {};
    const state = this.contextFor(team.id);
    const { rule } = this.o;
    if (rule.type === 'voice-alternating' && this.swapWarned) {
      state.swapInMs = Math.max(0, this.nextSwapAt - this.o.now());
    }
    if (rule.type === 'budget-clips') {
      state.budgets = Object.fromEntries(
        team.players.map((p) => [p.id, this.budgets.get(p.id) ?? 0]),
      );
    }
    if (rule.type === 'delayed-clips') {
      state.pendingDeliveries = this.pending.filter((p) => p.from === playerId).length;
    }
    return state;
  }

  /** For the voice topology: whether voice is open, and who is live on each team. */
  voice(): { open: boolean; activeByTeam: Record<string, string> } {
    const activeByTeam: Record<string, string> = {};
    for (const team of this.o.teams) {
      const active = this.activeFor(team);
      if (active) activeByTeam[team.id] = active;
    }
    return { open: this.voiceOpen, activeByTeam };
  }

  /** Re-sends a player's comms state (after a reconnect). */
  resend(playerId: string): void {
    this.lastSent.delete(playerId);
    this.syncStates();
  }

  private activeFor(team: CommsTeam): string | undefined {
    if (this.o.rule.type !== 'voice-alternating' || team.players.length === 0) return undefined;
    return team.players[this.activeIndex % team.players.length]?.id;
  }

  private jitterFor(playerId: string, [min, max]: [number, number]): number {
    let rng = this.jitter.get(playerId);
    if (!rng) {
      const seat = this.teamOf.get(playerId)?.players.find((p) => p.id === playerId)?.seat ?? 0;
      rng = createRng(`${this.o.seed}:${this.o.puzzleId}:clip-delay:${seat}`);
      this.jitter.set(playerId, rng);
    }
    return rng.int(Math.round(min), Math.round(max));
  }

  private routingFor(team: CommsTeam, from: string, required: boolean): ClipRouting {
    const routing = this.o.routeClip(team.id, from);
    if (routing) return routing;
    if (required) return { reject: "This puzzle doesn't route clips" };
    // Default: every teammate hears it, clean.
    return {
      deliveries: team.players.filter((p) => p.id !== from).map((p) => ({ to: p.id, params: {} })),
    };
  }

  private deliver(from: string, clip: Clip, deliveries: Array<{ to: string; params: unknown }>) {
    const team = this.teamOf.get(from);
    for (const { to, params } of deliveries) {
      if (!team?.players.some((p) => p.id === to)) continue;
      this.clipCounter += 1;
      this.o.send(to, {
        type: 'comms.clip',
        id: this.clipCounter,
        from,
        mime: clip.mime,
        data: clip.data,
        params,
      });
    }
  }

  private syncStates(): void {
    for (const playerId of this.teamOf.keys()) {
      const state = this.stateFor(playerId);
      const json = JSON.stringify(state);
      if (this.lastSent.get(playerId) === json) continue;
      this.lastSent.set(playerId, json);
      this.o.send(playerId, { type: 'comms.state', state });
    }
  }
}

function asObject(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
