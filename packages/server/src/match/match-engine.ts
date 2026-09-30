import {
  DEFAULT_SIGNAL_COOLDOWN_MS,
  allowedSignals,
  clipRule,
  findRule,
  type AnyPuzzleServerModule,
  type DrawBatch,
  type MatchPhase,
  type MatchView,
  type PlayerCommsGate,
  type PlayerInfo,
  type RoundSummary,
  type ServerMessage,
  type Standing,
  type TeamRoster,
  type TeamRoundResult,
  type TeamScore,
} from '@split-signal/shared';
import { CommsController } from '../comms/controller';
import { PuzzleRuntime } from '../runtime/puzzle-runtime';
import { PausableClock } from './clock';
import { resolveRound } from './resolution';
import { onePointPerRound, type ScoringMode } from './scoring';

export interface MatchTimings {
  introMs: number;
  countdownMs: number;
  scoreboardMs: number;
  /** Race grace window for puzzles that don't set raceGraceMs. */
  defaultRaceGraceMs: number;
}

export const DEFAULT_TIMINGS: MatchTimings = {
  introMs: 5000,
  countdownMs: 3000,
  scoreboardMs: 6000,
  defaultRaceGraceMs: 2000,
};

export interface MatchTeam {
  id: string;
  name: string;
  /** In seat order. */
  players: PlayerInfo[];
}

export interface MatchOptions {
  seed: string;
  /** One puzzle per round, in order. */
  puzzles: readonly AnyPuzzleServerModule[];
  teams: readonly MatchTeam[];
  scoring?: ScoringMode;
  timings?: Partial<MatchTimings>;
  now?: () => number;
}

export interface MatchIO {
  send(playerId: string, message: ServerMessage): void;
  onError?(error: unknown, context: string): void;
  /** Called after every match state change (phase, solves, pause, voice swaps). */
  onStateChange?(): void;
}

/** The match as plain data (kept on the room). Live puzzle runtimes live in the engine. */
export interface MatchState {
  seed: string;
  puzzleIds: string[];
  round: number;
  phase: MatchPhase;
  /** Match-clock time the phase started. */
  phaseStartedAt: number;
  phaseDurationMs: number | null;
  scores: Record<string, number>;
  /** Current round, by team id. */
  roundResults: Record<string, TeamRoundResult>;
  /** Race puzzles: when the first team solved, starting the grace window. */
  firstSolveAt: number | null;
  history: RoundSummary[];
  /** Disconnected players the match is paused for. */
  waitingFor: string[];
  standings: Standing[] | null;
  endedBy: 'completed' | 'surrender' | null;
}

/** Instance key for shared (arena) puzzles. */
const SHARED = 'shared';
/** voice-gated's default: a commsState() change must hold this long before voice follows it. */
const DEFAULT_GATE_DEBOUNCE_MS = 300;
/** Shell actions the client sends on its own, never shown a rejection. */
const SHELL_ACTIONS = new Set(['__micLevel', '__replayMissed']);
/** __micLevel faster than this is dropped (clients send about ten a second). */
const MIC_LEVEL_MIN_GAP_MS = 80;

function teamResult(
  teamId: string,
  solved: boolean,
  score: TeamScore | undefined,
): TeamRoundResult {
  return {
    teamId,
    solved,
    ...(score?.moves !== undefined ? { moves: score.moves } : {}),
    ...(score?.elapsedMs !== undefined ? { elapsedMs: score.elapsedMs } : {}),
    ...(score?.points !== undefined ? { points: score.points } : {}),
  };
}

/**
 * Runs one match: for each round, intro → countdown → playing → scoreboard, then final results.
 * Timers run on a pausable clock, so a disconnect freezes everything until the player returns.
 * Per-team puzzles get one instance per team; shared puzzles get one for the whole room.
 */
export class MatchEngine {
  readonly state: MatchState;
  private readonly puzzles: readonly AnyPuzzleServerModule[];
  private readonly teams: readonly MatchTeam[];
  private readonly scoring: ScoringMode;
  private readonly timings: MatchTimings;
  private readonly clock: PausableClock;
  private readonly io: MatchIO;
  private readonly teamByPlayer = new Map<string, MatchTeam>();
  private readonly lastSignalAt = new Map<string, number>();
  private instances = new Map<string, PuzzleRuntime>();
  private comms: CommsController | null = null;
  /** The last round's reveal() views by player, kept for the scoreboard (and reconnects). */
  private reveals = new Map<string, unknown>();
  /** commsState() overrides the voice topology uses now (debounced), by player. */
  private gates: Record<string, PlayerCommsGate> = {};
  /** Overrides waiting out the debounce: the gate, its JSON, and when it last changed. */
  private pendingGates = new Map<string, { gate: PlayerCommsGate; json: string; since: number }>();
  /** The last replay request id sent to each player. */
  private replaysSent = new Map<string, number>();
  private readonly lastMicLevelAt = new Map<string, number>();

  constructor(options: MatchOptions, io: MatchIO) {
    if (options.puzzles.length === 0) throw new Error('A match needs at least one puzzle');
    this.puzzles = options.puzzles;
    this.teams = options.teams;
    this.scoring = options.scoring ?? onePointPerRound;
    this.timings = { ...DEFAULT_TIMINGS, ...options.timings };
    this.clock = new PausableClock(options.now ?? Date.now);
    this.io = io;
    for (const team of this.teams) {
      for (const player of team.players) this.teamByPlayer.set(player.id, team);
    }
    this.state = {
      seed: options.seed,
      puzzleIds: this.puzzles.map((p) => p.manifest.id),
      round: 0,
      phase: 'intro',
      phaseStartedAt: 0,
      phaseDurationMs: null,
      scores: Object.fromEntries(this.teams.map((t) => [t.id, 0])),
      roundResults: {},
      firstSolveAt: null,
      history: [],
      waitingFor: [],
      standings: null,
      endedBy: null,
    };
  }

  get finished(): boolean {
    return this.state.phase === 'finished';
  }

  get paused(): boolean {
    return this.state.waitingFor.length > 0;
  }

  /** The current round's puzzle manifest (the last one once the match is over). */
  get manifest(): AnyPuzzleServerModule['manifest'] {
    return this.currentPuzzle().manifest;
  }

  /** Team membership, for deciding who can hear whom. */
  get rosters(): TeamRoster[] {
    return this.teams.map((t) => ({
      id: t.id,
      name: t.name,
      playerIds: t.players.map((p) => p.id),
    }));
  }

  /**
   * Voice state for the topology: timed voice open or closed, who is live under alternation, and
   * the puzzle's per-player overrides.
   */
  voiceState(): {
    open: boolean;
    activeByTeam: Record<string, string>;
    gates: Record<string, PlayerCommsGate>;
  } {
    const base = this.comms?.voice() ?? { open: true, activeByTeam: {} };
    return { ...base, gates: this.state.phase === 'playing' ? this.gates : {} };
  }

  hasPlayer(playerId: string): boolean {
    return this.teamByPlayer.has(playerId);
  }

  start(): void {
    this.enterIntro(0);
  }

  /** Called every TICK_INTERVAL_MS. */
  tick(): void {
    const s = this.state;
    if (this.paused || s.phase === 'finished') return;

    if (s.phase === 'playing') {
      this.comms?.tick();
      this.settleGates();
      for (const [key, runtime] of this.instances) {
        if (key === SHARED || !s.roundResults[key]?.solved) runtime.tick();
        if (s.phase !== 'playing') return;
      }
      if (s.firstSolveAt !== null && this.clock.now() >= s.firstSolveAt + this.graceMs()) {
        this.endRound();
        return;
      }
    }

    if (s.phaseDurationMs !== null && this.clock.now() >= s.phaseStartedAt + s.phaseDurationMs) {
      this.advance();
    }
  }

  handleAction(playerId: string, payload: unknown): void {
    const team = this.teamByPlayer.get(playerId);
    const type = (payload as { type?: unknown } | null)?.type;
    const shell = typeof type === 'string' && SHELL_ACTIONS.has(type);
    const reject = (reason: string) => {
      if (!shell) this.io.send(playerId, { type: 'match.reject', reason });
    };
    if (!team) return reject('You are not in this match');
    if (this.paused) return reject('The match is paused');
    if (this.state.phase !== 'playing') return reject('The round is not running');
    if (!this.isShared() && this.state.roundResults[team.id]?.solved) {
      return reject('Your team already solved it');
    }
    if (type === '__micLevel') {
      const now = this.clock.now();
      const last = this.lastMicLevelAt.get(playerId);
      if (last !== undefined && now - last < MIC_LEVEL_MIN_GAP_MS) return;
      this.lastMicLevelAt.set(playerId, now);
    }
    this.runtimeFor(team.id)?.handleAction(playerId, payload, shell);
  }

  /**
   * A discrete signal: relayed to the sender's team (or just to `to`), if the puzzle allows it and
   * the sender is off cooldown, then passed to the puzzle's onSignal. Anything else is dropped.
   */
  handleSignal(playerId: string, signal: string, to?: string): void {
    const team = this.teamByPlayer.get(playerId);
    const runtime = team && this.runtimeFor(team.id);
    if (!team || !runtime || this.paused || this.state.phase !== 'playing') return;
    const { comms } = this.currentPuzzle().manifest;
    if (!allowedSignals(comms).includes(signal)) return;
    const signalsRule = findRule(comms, 'signals');
    if (to !== undefined) {
      const reachable = this.isShared()
        ? this.teamByPlayer.has(to)
        : team.players.some((p) => p.id === to);
      if (!reachable || to === playerId) return;
    }

    const now = this.clock.now();
    const cooldown = signalsRule?.cooldownMs ?? DEFAULT_SIGNAL_COOLDOWN_MS;
    const last = this.lastSignalAt.get(playerId);
    if (last !== undefined && now - last < cooldown) return;

    // The puzzle sees it first: a refused signal is neither applied nor relayed.
    const refusal = runtime.handleSignal(playerId, signal, to);
    if (refusal !== null) {
      this.io.send(playerId, { type: 'match.reject', reason: refusal });
      return;
    }
    this.lastSignalAt.set(playerId, now);

    if (signalsRule?.relay !== false) {
      const recipients = to !== undefined ? [to, playerId] : team.players.map((p) => p.id);
      for (const id of recipients)
        this.io.send(id, { type: 'comms.signal', from: playerId, signal });
    }

    // Under a clip rule, 'repeat' re-delivers the latest clip to whoever asked, with parameters
    // worked out from the state as it is now.
    if (clipRule(comms) && signal === 'repeat') this.comms?.repeat(playerId);
  }

  /** A recorded clip, for puzzles with a clip comms rule. */
  handleClip(playerId: string, clip: { mime: string; data: string; durationMs: number }): void {
    const reject = (reason: string) => this.io.send(playerId, { type: 'match.reject', reason });
    if (!this.comms || this.state.phase !== 'playing') return reject('The round is not running');
    if (this.paused) return reject('The match is paused');
    const problem = this.comms.handleClip(playerId, clip);
    if (problem) reject(problem);
  }

  /** Pen samples, for puzzles with the draw rule. */
  handleDraw(playerId: string, batch: DrawBatch): void {
    if (!this.comms || this.paused || this.state.phase !== 'playing') return;
    this.comms.handleDraw(playerId, batch);
  }

  playerDisconnected(playerId: string): void {
    if (!this.hasPlayer(playerId) || this.finished) return;
    if (!this.state.waitingFor.includes(playerId)) this.state.waitingFor.push(playerId);
    this.clock.pause();
    this.broadcast();
  }

  playerReconnected(playerId: string): void {
    const team = this.teamByPlayer.get(playerId);
    if (!team) return;
    this.state.waitingFor = this.state.waitingFor.filter((id) => id !== playerId);
    if (!this.paused) this.clock.resume();
    this.broadcast();
    this.runtimeFor(team.id)?.resendView(playerId);
    this.comms?.resend(playerId);
    this.sendReveal(playerId);
    // A reloaded client lost its replay state; the next request goes out fresh.
    this.replaysSent.delete(playerId);
  }

  /** Ends the whole match as it stands. Only allowed while waiting on a disconnected player. */
  surrender(): string | null {
    if (this.finished) return 'The match is already over';
    if (!this.paused) return 'You can only surrender while waiting for someone to reconnect';
    this.finish('surrender');
    return null;
  }

  view(): MatchView {
    const s = this.state;
    const puzzle = this.currentPuzzle();
    const remaining =
      s.phaseDurationMs === null
        ? null
        : Math.max(0, s.phaseStartedAt + s.phaseDurationMs - this.clock.now());
    return {
      round: s.round,
      totalRounds: this.puzzles.length,
      puzzle: { id: puzzle.manifest.id, manifest: puzzle.manifest },
      phase: s.phase,
      phaseRemainingMs: remaining,
      phaseTotalMs: s.phaseDurationMs,
      paused: this.paused ? { waitingFor: [...s.waitingFor] } : null,
      teams: this.teams.map((team) => ({
        id: team.id,
        name: team.name,
        players: team.players,
        score: s.scores[team.id] ?? 0,
        round: s.roundResults[team.id] ?? { teamId: team.id, solved: false },
      })),
      history: s.history,
      standings: s.standings,
      endedBy: s.endedBy,
    };
  }

  private isShared(): boolean {
    return this.currentPuzzle().manifest.instance === 'shared';
  }

  private runtimeFor(teamId: string): PuzzleRuntime | undefined {
    return this.instances.get(this.isShared() ? SHARED : teamId);
  }

  private currentPuzzle(): AnyPuzzleServerModule {
    const puzzle = this.puzzles[Math.min(this.state.round, this.puzzles.length - 1)];
    if (!puzzle) throw new Error('No puzzle for this round');
    return puzzle;
  }

  private graceMs(): number {
    return this.currentPuzzle().manifest.raceGraceMs ?? this.timings.defaultRaceGraceMs;
  }

  private enterPhase(phase: MatchPhase, durationMs: number | null): void {
    this.state.phase = phase;
    this.state.phaseStartedAt = this.clock.now();
    this.state.phaseDurationMs = durationMs;
  }

  private advance(): void {
    switch (this.state.phase) {
      case 'intro':
        this.enterPhase('countdown', this.timings.countdownMs);
        this.broadcast();
        break;
      case 'countdown':
        this.enterPlaying();
        break;
      case 'playing':
        this.endRound();
        break;
      case 'scoreboard':
        if (this.state.round + 1 < this.puzzles.length) this.enterIntro(this.state.round + 1);
        else this.finish('completed');
        break;
      case 'finished':
        break;
    }
  }

  private enterIntro(round: number): void {
    const s = this.state;
    s.round = round;
    s.firstSolveAt = null;
    s.roundResults = Object.fromEntries(
      this.teams.map((t) => [t.id, { teamId: t.id, solved: false }]),
    );
    this.enterPhase('intro', this.timings.introMs);
    this.broadcast();
  }

  private enterPlaying(): void {
    this.reveals = new Map();
    this.gates = {};
    this.pendingGates = new Map();
    this.replaysSent = new Map();
    const puzzle = this.currentPuzzle();
    const { manifest } = puzzle;
    this.enterPhase('playing', manifest.timeLimitSeconds * 1000);
    const roundStart = this.state.phaseStartedAt;
    const roundSeed = `${this.state.seed}:round-${this.state.round}`;
    const clock = () => this.clock.now() - roundStart;
    const shared = manifest.instance === 'shared';

    const comms = new CommsController({
      comms: manifest.comms,
      seed: roundSeed,
      puzzleId: manifest.id,
      teams: this.teams,
      now: () => this.clock.now(),
      send: (playerId, message) => this.io.send(playerId, message),
      routeClip: (teamId, from) => this.runtimeFor(teamId)?.routeClip(from) ?? null,
      canDraw: (teamId, playerId) => {
        const view = this.runtimeFor(teamId)?.viewFor(playerId);
        return (
          typeof view === 'object' &&
          view !== null &&
          (view as { canDraw?: unknown }).canDraw === true
        );
      },
      onChange: () => {
        for (const runtime of this.instances.values()) runtime.refresh();
        this.io.onStateChange?.();
      },
      micClosed: (playerId) => this.gates[playerId]?.send === false,
    });
    this.comms = comms;

    const round = this.state.round;
    const hooks = (onSolved: () => void, onChange?: () => void) => ({
      sendView: (playerId: string, view: unknown) =>
        this.io.send(playerId, { type: 'match.view', view }),
      sendReject: (playerId: string, reason: string) =>
        this.io.send(playerId, { type: 'match.reject', reason }),
      sendAsset: (playerId: string, id: string, asset: { mime: string; data: string }) =>
        this.io.send(playerId, { type: 'match.asset', round, id, ...asset }),
      onCommsState: () => this.collectGates(),
      onSolved,
      ...(onChange ? { onChange } : {}),
      onError: (error: unknown, context: string) =>
        this.io.onError?.(error, `${manifest.id} ${context}`),
    });

    if (shared) {
      const runtime = new PuzzleRuntime(
        puzzle,
        {
          seed: roundSeed,
          teamId: SHARED,
          players: this.teams.flatMap((t) => t.players),
          teams: this.rosters,
          roundIndex: this.state.round,
          clock,
          comms: () => ({}),
        },
        hooks(
          () => this.endRound(),
          () => this.refreshSharedResults(),
        ),
      );
      this.instances = new Map([[SHARED, runtime]]);
    } else {
      this.instances = new Map(
        this.teams.map((team) => [
          team.id,
          new PuzzleRuntime(
            puzzle,
            {
              seed: roundSeed,
              teamId: team.id,
              players: team.players,
              roundIndex: this.state.round,
              clock,
              comms: () => comms.contextFor(team.id),
            },
            hooks(() => this.onTeamSolved(team.id)),
          ),
        ]),
      );
    }

    this.broadcast();
    comms.begin();
    for (const runtime of this.instances.values()) runtime.start();
  }

  /**
   * A puzzle's commsState() changed: send new replay requests straight away, and start the
   * debounce for voice overrides (voice-gated only; otherwise they apply at once).
   */
  private collectGates(): void {
    if (this.state.phase !== 'playing') return;
    const latest: Record<string, PlayerCommsGate> = {};
    for (const runtime of this.instances.values()) Object.assign(latest, runtime.commsGates());
    const now = this.clock.now();
    for (const [playerId, full] of Object.entries(latest)) {
      const { replay, ...gate } = full;
      if (replay && this.replaysSent.get(playerId) !== replay.id) {
        this.replaysSent.set(playerId, replay.id);
        this.io.send(playerId, { type: 'comms.replay', ...replay });
      }
      const json = JSON.stringify(gate);
      if (json === JSON.stringify(this.gates[playerId] ?? {})) {
        this.pendingGates.delete(playerId);
      } else if (this.pendingGates.get(playerId)?.json !== json) {
        this.pendingGates.set(playerId, { gate, json, since: now });
      }
    }
    this.settleGates();
  }

  /** Applies overrides that have held for the debounce, and re-syncs voice if any did. */
  private settleGates(): void {
    if (this.pendingGates.size === 0) return;
    const gated = findRule(this.currentPuzzle().manifest.comms, 'voice-gated');
    const debounce = gated ? (gated.debounceMs ?? DEFAULT_GATE_DEBOUNCE_MS) : 0;
    const now = this.clock.now();
    let changed = false;
    for (const [playerId, pending] of this.pendingGates) {
      if (now - pending.since < debounce) continue;
      this.gates = { ...this.gates, [playerId]: pending.gate };
      this.pendingGates.delete(playerId);
      changed = true;
    }
    if (changed) {
      this.comms?.refresh();
      this.io.onStateChange?.();
    }
  }

  /** Shared instances: keep each team's live result (for the HUD) in step with the puzzle. */
  private refreshSharedResults(): void {
    const s = this.state;
    const teams = this.instances.get(SHARED)?.score().teams ?? {};
    const next = Object.fromEntries(
      this.teams.map((t) => [t.id, teamResult(t.id, teams[t.id]?.solved ?? false, teams[t.id])]),
    );
    if (JSON.stringify(next) === JSON.stringify(s.roundResults)) return;
    s.roundResults = next;
    if (s.phase === 'playing') this.broadcast();
  }

  private onTeamSolved(teamId: string): void {
    const s = this.state;
    const runtime = this.instances.get(teamId);
    if (s.phase !== 'playing' || !runtime) return;
    const now = this.clock.now();
    const score = runtime.score();
    // A module may report its own elapsed time (e.g. with penalties); otherwise use the clock.
    s.roundResults[teamId] = teamResult(teamId, true, {
      ...score,
      elapsedMs: score.elapsedMs ?? now - s.phaseStartedAt,
    });

    const everyoneDone = this.teams.every((t) => s.roundResults[t.id]?.solved);
    if (this.currentPuzzle().manifest.winCondition === 'race' && s.firstSolveAt === null) {
      s.firstSolveAt = now;
      if (this.graceMs() <= 0) return this.endRound();
    }
    if (everyoneDone) return this.endRound();
    this.broadcast();
  }

  private finalResults(): TeamRoundResult[] {
    const s = this.state;
    if (this.isShared()) {
      const teams = this.instances.get(SHARED)?.score().teams ?? {};
      return this.teams.map((t) => teamResult(t.id, teams[t.id]?.solved ?? false, teams[t.id]));
    }
    return this.teams.map((t) => {
      const recorded = s.roundResults[t.id];
      if (recorded?.solved) return recorded;
      // Unsolved teams still count on points (e.g. placements scored at the buzzer, or grabs in
      // a puzzle everyone plays to the end), with whatever tie-break time the puzzle reports.
      const score = this.instances.get(t.id)?.score();
      return teamResult(t.id, false, score?.points !== undefined ? score : undefined);
    });
  }

  private endRound(): void {
    const s = this.state;
    if (s.phase !== 'playing') return;
    const puzzle = this.currentPuzzle();
    const results = this.finalResults();
    const resolution = resolveRound(puzzle.manifest.winCondition, results);
    const summary = {
      round: s.round,
      puzzleId: puzzle.manifest.id,
      puzzleName: puzzle.manifest.name,
      winCondition: puzzle.manifest.winCondition,
      ...resolution,
      results,
    };
    const points = this.scoring.onRoundResult(summary);
    for (const [teamId, delta] of Object.entries(points)) {
      s.scores[teamId] = (s.scores[teamId] ?? 0) + delta;
    }
    s.history.push({ ...summary, points });
    s.roundResults = Object.fromEntries(results.map((r) => [r.teamId, r]));
    for (const team of this.teams) {
      const runtime = this.runtimeFor(team.id);
      for (const player of team.players) {
        const view = runtime?.revealFor(player.id);
        if (view !== undefined) this.reveals.set(player.id, view);
      }
    }
    this.instances = new Map();
    this.comms = null;
    this.gates = {};
    this.pendingGates = new Map();
    this.enterPhase('scoreboard', this.timings.scoreboardMs);
    this.broadcast();
    for (const playerId of this.reveals.keys()) this.sendReveal(playerId);
  }

  private sendReveal(playerId: string): void {
    const view = this.reveals.get(playerId);
    if (view === undefined || this.state.phase !== 'scoreboard') return;
    this.io.send(playerId, { type: 'match.reveal', round: this.state.round, view });
  }

  private finish(endedBy: 'completed' | 'surrender'): void {
    this.instances = new Map();
    this.comms = null;
    this.state.endedBy = endedBy;
    this.state.standings = this.scoring.finalStandings(this.state.scores);
    this.state.waitingFor = [];
    this.clock.resume();
    this.enterPhase('finished', null);
    this.broadcast();
  }

  private broadcast(): void {
    const message: ServerMessage = { type: 'match.state', match: this.view() };
    for (const playerId of this.teamByPlayer.keys()) this.io.send(playerId, message);
    this.io.onStateChange?.();
  }
}
