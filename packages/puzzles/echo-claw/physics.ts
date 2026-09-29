import { createRng } from '@split-signal/shared';
import type { Point, Segment, State } from './types';

/** Machine widths per ms: the toy crosses the machine in about five seconds. */
export const TOY_SPEED = 0.18 / 1000;
export const TOY_RADIUS = 0.04;
/** Machine widths per ms: the claw crosses in about six seconds. */
export const CLAW_SPEED = 1 / 6000;
/** How far the claw's centre can go: it stays inside the glass. */
export const CLAW_LIMIT = { min: 0.06, max: 0.94 };
/** Toy centre within this distance of the claw centre when it closes: a grab. */
export const GRAB_RADIUS = 0.08;
/** The claw closes this long after the drop starts... */
export const DROP_MS = 1500;
/** ...and is busy (can't move or drop again) until this long after. */
export const BUSY_MS = 2000;
/** Each bounce turns the toy by up to this much, so it isn't perfectly predictable. */
const NUDGE = (15 * Math.PI) / 180;
/** The toy never runs flatter than this against a wall. */
const MIN_ANGLE = (20 * Math.PI) / 180;

const LO = TOY_RADIUS;
const HI = 1 - TOY_RADIUS;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number, places = 3) => Math.round(v * 10 ** places) / 10 ** places;

export const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

export function toyAt(toy: Segment, t: number): Point {
  const dt = t - toy.since;
  return { x: clamp(toy.x + toy.vx * dt, LO, HI), y: clamp(toy.y + toy.vy * dt, LO, HI) };
}

/** Round time the toy next touches a wall. */
export function nextBounce(toy: Segment): number {
  const until = (p: number, v: number) => (v > 0 ? (HI - p) / v : v < 0 ? (LO - p) / v : Infinity);
  return toy.since + Math.max(0, Math.min(until(toy.x, toy.vx), until(toy.y, toy.vy)));
}

/** A velocity at `angle`, pointing away from any wall named, never too flat. */
function heading(angle: number, awayX: number, awayY: number): { vx: number; vy: number } {
  let vx = Math.cos(angle) * TOY_SPEED;
  let vy = Math.sin(angle) * TOY_SPEED;
  if (awayX) vx = awayX * Math.abs(vx);
  if (awayY) vy = awayY * Math.abs(vy);
  const min = TOY_SPEED * Math.sin(MIN_ANGLE);
  const rest = Math.sqrt(TOY_SPEED ** 2 - min ** 2);
  if (Math.abs(vx) < min) {
    vx = (Math.sign(vx) || awayX || 1) * min;
    vy = (Math.sign(vy) || 1) * rest;
  } else if (Math.abs(vy) < min) {
    vy = (Math.sign(vy) || awayY || 1) * min;
    vx = (Math.sign(vx) || 1) * rest;
  }
  return { vx, vy };
}

/** The toy at the wall at time t: reflected, then nudged by `r` (0..1, seeded). */
export function bounce(toy: Segment, t: number, r: number): Segment {
  const at = toyAt(toy, t);
  const eps = 1e-9;
  const awayX = at.x <= LO + eps ? 1 : at.x >= HI - eps ? -1 : 0;
  const awayY = at.y <= LO + eps ? 1 : at.y >= HI - eps ? -1 : 0;
  const vx = awayX ? -toy.vx : toy.vx;
  const vy = awayY ? -toy.vy : toy.vy;
  const angle = Math.atan2(vy, vx) + (r * 2 - 1) * NUDGE;
  return { x: at.x, y: at.y, ...heading(angle, awayX, awayY), since: t };
}

/** The nth toy of a round (0 is the first; each grab respawns it), identical for every team. */
export function spawn(pathSeed: string, n: number, t: number): Segment {
  const rng = createRng(`${pathSeed}:spawn:${n}`);
  let spot = { x: 0.2, y: 0.2 };
  for (let i = 0; i < 50; i++) {
    spot = { x: 0.15 + rng.next() * 0.7, y: 0.15 + rng.next() * 0.7 };
    // Not right under the claw's starting spot.
    if (distance(spot, { x: 0.5, y: 0.5 }) >= 0.25) break;
  }
  return { ...spot, ...heading(rng.next() * Math.PI * 2, 0, 0), since: t };
}

function moveClaw(state: State, now: number): Point {
  const { dx, dy } = state.steer;
  const start =
    state.dropAt === null ? state.movedTo : Math.max(state.movedTo, state.dropAt + BUSY_MS);
  const dt = now - start;
  if (dt <= 0 || (dx === 0 && dy === 0)) return state.claw;
  const len = Math.hypot(dx, dy);
  const step = CLAW_SPEED * dt;
  return {
    x: round(clamp(state.claw.x + (dx / len) * step, CLAW_LIMIT.min, CLAW_LIMIT.max), 4),
    y: round(clamp(state.claw.y + (dy / len) * step, CLAW_LIMIT.min, CLAW_LIMIT.max), 4),
  };
}

/**
 * Brings the machine up to round time `now`: bounces and grabs in the order they happen (exact
 * times, not tick times, so every team sees the same path), then the claw's movement.
 */
export function advance(state: State, now: number): State {
  let { toy, respawns, bounces, closed, grabs, lastDrop } = state;
  for (let guard = 0; guard < 1000; guard++) {
    const bounceAt = nextBounce(toy);
    const closeAt = state.dropAt !== null && !closed ? state.dropAt + DROP_MS : Infinity;
    if (Math.min(bounceAt, closeAt) > now) break;
    if (closeAt <= bounceAt) {
      // The claw hasn't moved since the drop started, so state.claw is where it closes.
      closed = true;
      const hit = distance(toyAt(toy, closeAt), state.claw) <= GRAB_RADIUS;
      lastDrop = { at: closeAt, hit };
      if (hit) {
        grabs = [...grabs, closeAt];
        respawns += 1;
        bounces = 0;
        toy = spawn(state.pathSeed, respawns, closeAt);
      }
    } else {
      bounces += 1;
      toy = bounce(toy, bounceAt, createRng(`${state.pathSeed}:${respawns}:${bounces}`).next());
    }
  }

  const claw = moveClaw(state, now);
  const free = state.dropAt !== null && now >= state.dropAt + BUSY_MS;
  const pos = toyAt(toy, now);
  const toyPos = { x: round(pos.x), y: round(pos.y) };
  const unchanged =
    toy === state.toy &&
    claw === state.claw &&
    !free &&
    closed === state.closed &&
    toyPos.x === state.toyAt.x &&
    toyPos.y === state.toyAt.y;
  // A stale movedTo is harmless while nothing moves; apply() stamps it when steering changes.
  if (unchanged) return state;
  return {
    ...state,
    toy,
    toyAt: toyPos,
    respawns,
    bounces,
    claw,
    dropAt: free ? null : state.dropAt,
    closed: free ? false : closed,
    movedTo: now,
    grabs,
    lastDrop,
  };
}
