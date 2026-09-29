/**
 * Puzzle test harness. Drives a puzzle module exactly the way the server runtime does (it wraps
 * the same PuzzleSession), and checks the rules every puzzle must follow after every step:
 *
 *   - init is deterministic for a seed (no Math.random, no clocks)
 *   - state is never mutated (it is deep-frozen, so mutation throws)
 *   - state and views are plain JSON data
 *   - views never leak information marked as hidden
 *
 * Plain Errors are thrown on failure, so it works under any test runner.
 */
import {
  PuzzleSession,
  TICK_INTERVAL_MS,
  createRng,
  validateManifest,
  type ActionOutcome,
  type PlayerInfo,
  type PuzzleScore,
  type PuzzleServerModule,
} from '@split-signal/shared';

/**
 * Something some players must not learn. The harness checks it by changing the hidden thing and
 * confirming that those players' views come out exactly the same.
 */
export interface HiddenInfo<State> {
  /** What is hidden, used in failure messages ("the secret number"). */
  name: string;
  /** Which players must not learn it. */
  hiddenFrom: (player: PlayerInfo) => boolean;
  /** Return a copy of state with the hidden thing changed to some other value. */
  change: (state: State) => State;
}

export interface StartOptions<State> {
  /** Team size. */
  players: number;
  /** Defaults to 'test-seed'. */
  seed?: string;
  hidden?: HiddenInfo<State>[];
}

export type ScriptStep<Action> =
  | { seat: number; action: Action; expect?: 'accept' | 'reject' }
  | { seat: number; signal: string }
  /** Advance simulated time by this many ms, ticking every TICK_INTERVAL_MS. */
  | { advance: number };

export interface PuzzleScript<State, Action> extends StartOptions<State> {
  /** A list of steps, or a function that builds them from the initial state. */
  steps: ScriptStep<Action>[] | ((state: State, players: PlayerInfo[]) => ScriptStep<Action>[]);
  /** Defaults to true. */
  expectSolved?: boolean;
  expectScore?: PuzzleScore;
}

export class HarnessError extends Error {
  override name = 'HarnessError';
}

export function createTestPlayers(count: number): PlayerInfo[] {
  return Array.from({ length: count }, (_, seat) => ({
    id: `player-${seat + 1}`,
    name: `Player ${seat + 1}`,
    seat,
  }));
}

export class PuzzleDriver<State, View, Action> {
  readonly module: PuzzleServerModule<State, View, Action>;
  readonly players: PlayerInfo[];
  readonly session: PuzzleSession<State, View, Action>;
  private readonly hidden: HiddenInfo<State>[];
  private now = 0;

  constructor(module: PuzzleServerModule<State, View, Action>, options: StartOptions<State>) {
    this.module = module;
    this.players = createTestPlayers(options.players);
    this.hidden = options.hidden ?? [];
    this.session = new PuzzleSession(module, {
      seed: options.seed ?? 'test-seed',
      teamId: 'team-1',
      players: this.players,
      clock: () => this.now,
    });
    this.check('after init');
  }

  get state(): State {
    return this.session.state;
  }

  get solved(): boolean {
    return this.session.solved;
  }

  get elapsedMs(): number {
    return this.now;
  }

  score(): PuzzleScore {
    return this.session.score();
  }

  player(seat: number): PlayerInfo {
    const player = this.players[seat];
    if (!player)
      throw new HarnessError(`No player in seat ${seat} (team has ${this.players.length})`);
    return player;
  }

  view(seat: number): View {
    return this.session.view(this.player(seat).id);
  }

  act(seat: number, action: Action): ActionOutcome {
    const outcome = this.session.apply(this.player(seat).id, action);
    if (!outcome.ok && outcome.error !== undefined) {
      const message =
        outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
      const hint = /read.only|not extensible/i.test(message)
        ? ' (state is frozen in tests: return a new object instead of mutating)'
        : '';
      throw new HarnessError(`apply() threw for seat ${seat}: ${message}${hint}`, {
        cause: outcome.error,
      });
    }
    this.check(`after seat ${seat} action ${JSON.stringify(action)}`);
    return outcome;
  }

  signal(seat: number, signal: string): boolean {
    const changed = this.session.signal(this.player(seat).id, signal);
    this.check(`after seat ${seat} signal "${signal}"`);
    return changed;
  }

  /** Advances simulated time, calling tick() every TICK_INTERVAL_MS like the server does. */
  advance(ms: number): void {
    const end = this.now + ms;
    while (this.now + TICK_INTERVAL_MS <= end) {
      this.now += TICK_INTERVAL_MS;
      if (this.session.tick()) this.check(`after tick at ${this.now}ms`);
    }
    this.now = end;
  }

  /** Runs every invariant check against the current state. Called automatically after each step. */
  check(when: string): void {
    const state = this.session.state;
    deepFreeze(state);
    assertJson(state, `state ${when}`);

    const ctx = {
      teamId: this.session.teamId,
      players: this.players,
      elapsedMs: this.now,
      rng: createRng('harness-view'),
    };
    for (const player of this.players) {
      const view = this.module.view(state, player.id, ctx);
      assertJson(view, `view for seat ${player.seat} ${when}`);

      for (const hidden of this.hidden) {
        if (!hidden.hiddenFrom(player)) continue;
        const changedState = hidden.change(state);
        if (deepEqual(changedState, state)) {
          throw new HarnessError(
            `hidden "${hidden.name}": change() returned an identical state, so nothing was tested`,
          );
        }
        const otherView = this.module.view(changedState, player.id, ctx);
        if (!deepEqual(view, otherView)) {
          throw new HarnessError(
            `view for seat ${player.seat} leaks "${hidden.name}" ${when}.\n` +
              `  view:                ${JSON.stringify(view)}\n` +
              `  after changing it:   ${JSON.stringify(otherView)}`,
          );
        }
      }
    }
  }
}

/** Creates a driver after checking the manifest, the team size, and that init is deterministic. */
export function startPuzzle<State, View, Action>(
  module: PuzzleServerModule<State, View, Action>,
  options: StartOptions<State>,
): PuzzleDriver<State, View, Action> {
  const problems = validateManifest(module.manifest);
  if (problems.length > 0) {
    throw new HarnessError(`invalid manifest for "${module.manifest.id}": ${problems.join('; ')}`);
  }
  const { min, max } = module.manifest.playersPerTeam;
  if (options.players < min || options.players > max) {
    throw new HarnessError(
      `"${module.manifest.id}" supports ${min}-${max} players per team, not ${options.players}`,
    );
  }

  const first = new PuzzleDriver(module, options);
  const second = new PuzzleDriver(module, options);
  if (!deepEqual(first.state, second.state)) {
    throw new HarnessError(
      'init() is not deterministic: the same seed produced different states. ' +
        'Use ctx.rng for randomness, never Math.random or the clock.',
    );
  }
  return first;
}

/** Plays a scripted sequence of steps and asserts the outcome. Returns the driver for more checks. */
export function runPuzzleScript<State, View, Action>(
  module: PuzzleServerModule<State, View, Action>,
  script: PuzzleScript<State, Action>,
): PuzzleDriver<State, View, Action> {
  const game = startPuzzle(module, script);
  const steps =
    typeof script.steps === 'function' ? script.steps(game.state, game.players) : script.steps;

  steps.forEach((step, index) => {
    if ('advance' in step) {
      game.advance(step.advance);
    } else if ('signal' in step) {
      game.signal(step.seat, step.signal);
    } else {
      const outcome = game.act(step.seat, step.action);
      const expected = step.expect ?? 'accept';
      if (expected === 'accept' && !outcome.ok) {
        throw new HarnessError(`step ${index}: expected accept, got reject "${outcome.reason}"`);
      }
      if (expected === 'reject' && outcome.ok) {
        throw new HarnessError(`step ${index}: expected reject, but the action was accepted`);
      }
    }
  });

  const expectSolved = script.expectSolved ?? true;
  if (game.solved !== expectSolved) {
    throw new HarnessError(`expected solved=${expectSolved} after the script, got ${game.solved}`);
  }
  if (script.expectScore) {
    const score = game.score();
    for (const key of Object.keys(script.expectScore) as (keyof PuzzleScore)[]) {
      if (score[key] !== script.expectScore[key]) {
        throw new HarnessError(
          `expected score ${JSON.stringify(script.expectScore)}, got ${JSON.stringify(score)}`,
        );
      }
    }
  }
  return game;
}

function deepFreeze(value: unknown): void {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
}

function isPlainObject(value: object): boolean {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Structural equality for JSON-like data. Keys holding undefined count as absent. */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((item, i) => deepEqual(item, b[i]));
  }
  if (!isPlainObject(a) || !isPlainObject(b)) return false;
  const recA = a as Record<string, unknown>;
  const recB = b as Record<string, unknown>;
  const keysA = Object.keys(recA).filter((k) => recA[k] !== undefined);
  const keysB = Object.keys(recB).filter((k) => recB[k] !== undefined);
  return keysA.length === keysB.length && keysA.every((k) => deepEqual(recA[k], recB[k]));
}

function assertJson(value: unknown, label: string): void {
  let roundTripped: unknown;
  try {
    roundTripped = JSON.parse(JSON.stringify(value) ?? 'null');
  } catch (error) {
    throw new HarnessError(`${label} is not JSON-serializable: ${String(error)}`);
  }
  if (!deepEqual(value, roundTripped)) {
    throw new HarnessError(
      `${label} is not plain JSON data (Maps, Sets, Dates, class instances, NaN and Infinity ` +
        `do not survive the network). Got: ${JSON.stringify(roundTripped)}`,
    );
  }
}
