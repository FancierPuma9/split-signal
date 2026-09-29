import {
  CLIP_COOLDOWN_MS,
  DEFAULT_SIGNAL_COOLDOWN_MS,
  allowedSignals,
  type AnyPuzzleServerModule,
  type MatchPhase,
  type MatchView,
  type PlayerInfo,
  type RoundSummary,
  type ServerMessage,
  type Standing,
  type TeamRoundResult,
} from '@split-signal/shared';
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
  /** Called after every match state change (phase, solves, pause), e.g. to update voice. */
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

/**
 * Runs one match: for each round, intro → countdown → playing → scoreboard, then final results.
 * Timers run on a pausable clock, so a disconnect freezes everything until the player returns.
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
  private readonly lastClipAt = new Map<string, number>();
  /** Each team's latest clip this round, for 'repeat'. */
  private readonly lastClip = new Map<string, { from: string; mime: string; data: string }>();
  private clipCounter = 0;
  private runtimes = new Map<string, PuzzleRuntime>();

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
  get rosters(): Array<{ id: string; playerIds: string[] }> {
    return this.teams.map((t) => ({ id: t.id, playerIds: t.players.map((p) => p.id) }));
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
      for (const [teamId, runtime] of this.runtimes) {
        if (!s.roundResults[teamId]?.solved) runtime.tick();
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
    const reject = (reason: string) => this.io.send(playerId, { type: 'match.reject', reason });
    if (!team) return reject('You are not in this match');
    if (this.paused) return reject('The match is paused');
    if (this.state.phase !== 'playing') return reject('The round is not running');
    if (this.state.roundResults[team.id]?.solved) return reject('Your team already solved it');
    this.runtimes.get(team.id)?.handleAction(playerId, payload);
  }

  /**
   * Relays a discrete signal to the sender's team, if the current puzzle allows it and the sender
   * is off cooldown. Anything else is dropped silently.
   */
  handleSignal(playerId: string, signal: string): void {
    const team = this.teamByPlayer.get(playerId);
    const runtime = team && this.runtimes.get(team.id);
    if (!team || !runtime || this.paused || this.state.phase !== 'playing') return;
    const { comms } = this.currentPuzzle().manifest;
    if (!allowedSignals(comms).includes(signal)) return;

    const now = this.clock.now();
    const cooldown =
      (comms.type === 'signals' ? comms.cooldownMs : undefined) ?? DEFAULT_SIGNAL_COOLDOWN_MS;
    const last = this.lastSignalAt.get(playerId);
    if (last !== undefined && now - last < cooldown) return;
    this.lastSignalAt.set(playerId, now);

    for (const member of team.players) {
      this.io.send(member.id, { type: 'comms.signal', from: playerId, signal });
    }
    runtime.handleSignal(playerId, signal);

    // Under a clips rule, 'repeat' re-delivers the team's latest clip to whoever asked, with
    // parameters worked out from the state as it is now.
    if (comms.type === 'clips' && signal === 'repeat') {
      const clip = this.lastClip.get(team.id);
      if (clip) this.deliverClip(team.id, runtime, clip, playerId);
    }
  }

  /** A recorded clip, for puzzles with a clips comms rule. */
  handleClip(playerId: string, clip: { mime: string; data: string; durationMs: number }): void {
    const team = this.teamByPlayer.get(playerId);
    const runtime = team && this.runtimes.get(team.id);
    const reject = (reason: string) => this.io.send(playerId, { type: 'match.reject', reason });
    if (!team || !runtime) return reject('No round in progress');
    if (this.paused || this.state.phase !== 'playing') return reject('The round is not running');
    const { comms } = this.currentPuzzle().manifest;
    if (comms.type !== 'clips') return reject("This puzzle doesn't use clips");
    if (clip.durationMs > comms.maxSeconds * 1000 + 500) {
      return reject(`Clips can be at most ${comms.maxSeconds} seconds`);
    }
    const now = this.clock.now();
    const last = this.lastClipAt.get(playerId);
    if (last !== undefined && now - last < CLIP_COOLDOWN_MS) return reject('Wait a moment first');

    const stored = { from: playerId, mime: clip.mime, data: clip.data };
    const delivered = this.deliverClip(team.id, runtime, stored);
    if (delivered) {
      this.lastClipAt.set(playerId, now);
      this.lastClip.set(team.id, stored);
    }
  }

  /** Routes a clip through the puzzle and sends it; returns false if the puzzle refused it. */
  private deliverClip(
    teamId: string,
    runtime: PuzzleRuntime,
    clip: { from: string; mime: string; data: string },
    onlyTo?: string,
  ): boolean {
    const routing = runtime.routeClip(clip.from);
    if ('reject' in routing) {
      if (!onlyTo) this.io.send(clip.from, { type: 'match.reject', reason: routing.reject });
      return false;
    }
    const team = this.teams.find((t) => t.id === teamId);
    for (const { to, params } of routing.deliveries) {
      if (onlyTo !== undefined && to !== onlyTo) continue;
      if (!team?.players.some((p) => p.id === to)) continue;
      this.clipCounter += 1;
      this.io.send(to, {
        type: 'comms.clip',
        id: this.clipCounter,
        from: clip.from,
        mime: clip.mime,
        data: clip.data,
        params,
      });
    }
    return true;
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
    this.runtimes.get(team.id)?.resendView(playerId);
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
    this.lastClip.clear();
    s.roundResults = Object.fromEntries(
      this.teams.map((t) => [t.id, { teamId: t.id, solved: false }]),
    );
    this.enterPhase('intro', this.timings.introMs);
    this.broadcast();
  }

  private enterPlaying(): void {
    const puzzle = this.currentPuzzle();
    this.enterPhase('playing', puzzle.manifest.timeLimitSeconds * 1000);
    const roundStart = this.state.phaseStartedAt;
    const roundSeed = `${this.state.seed}:round-${this.state.round}`;

    this.runtimes = new Map(
      this.teams.map((team) => [
        team.id,
        new PuzzleRuntime(
          puzzle,
          {
            seed: roundSeed,
            teamId: team.id,
            players: team.players,
            clock: () => this.clock.now() - roundStart,
          },
          {
            sendView: (playerId, view) => this.io.send(playerId, { type: 'match.view', view }),
            sendReject: (playerId, reason) =>
              this.io.send(playerId, { type: 'match.reject', reason }),
            onSolved: () => this.onTeamSolved(team.id),
            onError: (error, context) =>
              this.io.onError?.(error, `${puzzle.manifest.id} ${context}`),
          },
        ),
      ]),
    );

    this.broadcast();
    for (const runtime of this.runtimes.values()) runtime.start();
  }

  private onTeamSolved(teamId: string): void {
    const s = this.state;
    const runtime = this.runtimes.get(teamId);
    if (s.phase !== 'playing' || !runtime) return;
    const now = this.clock.now();
    s.roundResults[teamId] = {
      teamId,
      solved: true,
      elapsedMs: now - s.phaseStartedAt,
      ...(runtime.score().moves !== undefined ? { moves: runtime.score().moves } : {}),
    };

    const everyoneDone = this.teams.every((t) => s.roundResults[t.id]?.solved);
    if (this.currentPuzzle().manifest.winCondition === 'race' && s.firstSolveAt === null) {
      s.firstSolveAt = now;
      if (this.graceMs() <= 0) return this.endRound();
    }
    if (everyoneDone) return this.endRound();
    this.broadcast();
  }

  private endRound(): void {
    const s = this.state;
    const puzzle = this.currentPuzzle();
    const results = this.teams.map((t) => s.roundResults[t.id] ?? { teamId: t.id, solved: false });
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
    this.runtimes = new Map();
    this.enterPhase('scoreboard', this.timings.scoreboardMs);
    this.broadcast();
  }

  private finish(endedBy: 'completed' | 'surrender'): void {
    this.runtimes = new Map();
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
