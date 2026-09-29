# Split Signal - Puzzle Batch 2

Ten new puzzle modules and one new match mode, designed after the first build shipped. This document is a companion to `SPLIT_SIGNAL_PLAN.md` and assumes that spec is already implemented: rooms, lobby, match engine, the puzzle contract (section 5 of the plan), voice topology, signals, and the clip pipeline from Radio Tune.

It is written to be handed to Claude Code and worked through in order. Section 3 lists the engine work that must land first; sections 4 and 5 are the modules themselves.

All puzzle names below are **working names**. They are only there so folders and manifest IDs have something to be called. Rename freely.

---

## 1. What this batch adds

Batch 1 used these communication channels: full voice, silence, four-arrow signals, a nudge button, and garbled one-way clips. Batch 2 opens seven channels that were still untouched, and one new way for teams to play against each other.

New channels:
- **Fading ink.** One player draws, the other sees the strokes, and every stroke vanishes about a second after it is drawn.
- **Fixed-delay voice.** You can talk, but everything you say arrives five seconds late.
- **Jittered voice.** Same, but each message is delayed by a different random amount, so messages can arrive out of order.
- **Talk-time budget.** Push-to-talk with a fixed number of seconds of mic time per player per round.
- **One-way, alternating.** Only one player can talk at a time, and control swaps between them without warning.
- **Plan-then-silence.** Voice for the first ten seconds of the round, then nothing.
- **Actions only.** No comms at all, but your partner can see what you do, so a pointless move becomes a message.

New match mode:
- **Arena.** All players in one shared puzzle instance instead of one instance per team. Teams still compete, but now they can see and interfere with each other.

Design rule carried over from batch 1 and reinforced in this batch: **every constraint must be enforced mechanically.** Word counts, "questions only," and similar behavioral rules were rejected because they would need speech transcription to enforce and are otherwise honor-system. If the wire doesn't stop it, it isn't a rule.

---

## 2. At a glance

| # | Working name | Channel | Instance | Win | Team shape |
|---|---|---|---|---|---|
| 1 | Ghost Ink | Fading ink | Per team | Compare (accuracy) | 2 per team, 2-3 teams |
| 2 | Split Hairs | Fading ink | Per team | Race (with lockouts) | 2 per team, 2-3 teams |
| 3 | Echo Claw | Fixed-delay voice | Per team | Compare (grabs) | 2 per team, 2-3 teams |
| 4 | Color Sweep | Jittered voice | Per team | Compare (color distance) | 2 per team, 2-3 teams |
| 5 | Airtime | Talk-time budget | Per team | Race | 2 per team, 2-3 teams |
| 6 | Walkie | One-way alternating | Per team | Race | 2 per team, 2-3 teams |
| 7 | Swap Stack | Actions only | Per team | Compare (height) | 2 per team, 2-3 teams |
| 8 | Bad Advice | Anonymous hints (arena) | Shared | Race | 2 per team, 2-3 teams |
| 9 | Pick Six | None (arena) | Shared | Compare (points) | 2 per team, 2-3 teams |
| 10 | Going Once | Voice, all (arena) | Shared | Compare (money) | 2 per team, 2-3 teams |

Suggested build order is in section 7. It front-loads engine work and orders the modules so each one reuses something the previous one built.

---

## 3. Engine additions (do these first)

Everything in this section is a change to `packages/shared`, `packages/server`, or `packages/client`. None of it should require touching batch 1 puzzles.

### 3.1 CommsRule extensions

Extend the discriminated union in `packages/shared`. Existing variants are unchanged.

```ts
type CommsRule =
  // --- existing (batch 1) ---
  | { type: 'voice'; scope: 'team' | 'all' }
  | { type: 'none' }
  | { type: 'signals'; signals: string[]; cooldownMs?: number }
  | { type: 'clips'; maxSeconds: number; direction: 'one-way' | 'two-way'; extraSignals?: string[] }

  // --- new (batch 2) ---

  // Push-to-talk clips, delivered late. Built on the clip pipeline, not WebRTC.
  // delayMs: fixed hold. delayRangeMs: per-clip random hold drawn from the seeded RNG.
  // Exactly one of the two must be set.
  | { type: 'delayed-clips'; maxSeconds: number; delayMs?: number; delayRangeMs?: [number, number]; extraSignals?: string[] }

  // Push-to-talk clips with a per-player mic budget for the round.
  | { type: 'budget-clips'; maxSeconds: number; budgetSeconds: number; extraSignals?: string[] }

  // Live voice, one direction at a time. The server decides who is live and flips it on a schedule.
  | { type: 'voice-alternating'; swapIntervalMs: [number, number]; warningMs?: number }

  // Live team voice that the server tears down after openSeconds.
  | { type: 'voice-timed'; scope: 'team' | 'all'; openSeconds: number }

  // Continuous stroke stream from one or more players to their teammates, rendered with fade.
  | { type: 'draw'; fadeMs: number; from: 'any' | 'role'; extraSignals?: string[] };
```

Notes:
- `delayed-clips` and `budget-clips` are both push-to-talk clips because that is the only comms path the server actually controls end to end. Live WebRTC is peer-to-peer, so the server cannot delay it or meter it. The delay channels *want* latency, so the round trip through the server is free. The budget channel could in principle be live audio with server-metered PTT and receiver-side muting, but that is enforced on the receiver's client, and both players on a team gain from cheating it. Ship clips; revisit only if playtests say the record-then-release feel is a problem.
- `voice-alternating` is the one place live WebRTC has to be reconfigured mid-round. See 3.4.
- `draw` is not audio. It is a high-rate signal stream. See 3.3.

### 3.2 Clip pipeline: hold, jitter, budget

The Radio Tune pipeline is: record -> upload -> server decides params -> deliver to receiver. Add three behaviors on the server side of that path.

**Hold (delayed-clips, fixed).**
- Server records `recordStartMs` (client-reported, clamped to server receive time minus clip duration) and `recordEndMs` (server receive time).
- `deliverAt = max(recordEndMs, recordStartMs + delayMs)`.
- With `delayMs = 5000` and `maxSeconds = 5`, this means every clip arrives exactly five seconds after the speaker started talking, which is what "your voice arrives five seconds late" should feel like. The client should show a small "sent, arrives in Ns" indicator so the speaker understands the lag.

**Jitter (delayed-clips, range).**
- Same as hold, but `delay` for the nth clip a player sends is the nth draw from a seeded sequence: `rng(seed + puzzleId + playerSeatIndex)`. All teams get the same delay sequence in the same order, so the randomness is fair across teams.
- Deliveries are scheduled independently, so a clip sent second can arrive first. Do not reorder. Out-of-order arrival is the point.

**Budget (budget-clips).**
- Server keeps `remainingMs` per player per round.
- On upload, if `clipDurationMs <= remainingMs`, deduct and deliver immediately. Otherwise truncate the clip to `remainingMs`, deliver the truncated audio, and set `remainingMs = 0`.
- Budget is part of the player's view (`comms.budgetRemainingMs`) and should also be visible to teammates so they can plan around each other.
- Client: hold-to-record with the remaining budget shown as a draining bar. Recording stops automatically when the budget hits zero.

**Generic.**
- The existing distortion step becomes optional; for these rules `params` is empty and the receiver plays the clip clean.
- Cooldown between clips still applies (see tuning).
- Expose a `pendingDeliveries` count in the sender's view so the client can render "3 messages in flight."

### 3.3 Draw stream

A stroke channel from one player to their teammates, relayed by the server, rendered with a fade on the receiving side.

**Transport.** Strokes are ordinary `comms.signal` messages with a payload, batched: the client accumulates pointer samples and sends one `draw` signal every 50ms containing `{ strokeId, points: [{x, y, t}], done }`. Coordinates are normalized to `[0, 1]` so canvases of different sizes line up. The server validates the shape, rate-limits (max 25 batches/sec/player), and relays to the players the manifest says (`from: 'any'` means everyone on the team can draw and everyone sees everyone's ink; `from: 'role'` means the module's `view` decides, by including a `canDraw: boolean` in each player's view).

**Fade.** Purely client-side rendering. Each point has a server timestamp; the client draws each segment with alpha `1 - (now - t) / fadeMs` and drops it once that goes negative. The server does not need to keep stroke history; it never enters puzzle state. On rejoin, the returning player just misses whatever was drawn while they were gone, which is the right behavior.

**Why not module actions.** Strokes at 20 Hz through `apply()` -> `view()` for every teammate would hammer the puzzle runtime for data that is never part of game state. Keep it on the comms path, next to arrow signals and nudges.

**Client component.** Build one reusable `<FadingCanvas>` that takes `{ canDraw, incomingStrokes, fadeMs, onStroke, overlay? }` so Ghost Ink and Split Hairs share it. `overlay` lets a module render its own content (a target scene, placed objects) under the ink.

### 3.4 One-way alternating voice

For `voice-alternating`:
- Server picks `activePlayerId` at round start (seeded) and schedules the next swap at `now + rng.between(swapIntervalMs)`. On each swap, flip active and reschedule. The swap schedule is seeded so all teams swap at the same times.
- On each swap the comms controller sends both clients an updated peer instruction: the active player gets `{ peer, direction: 'sendonly' }`, the inactive player gets `{ peer, direction: 'recvonly' }`. The voice manager renegotiates the existing WebRTC connection (swap transceiver directions, not tear down and rebuild) so the gap is well under a second.
- Renegotiation is the enforcement: the inactive player's browser is not sending an audio track. There is nothing to bypass.
- The server also pushes `comms.activePlayerId` into every player's view so modules can render "you're live" / "listen" states. If `warningMs` is set, the server pushes `comms.swapInMs` for the last `warningMs` before a swap; if it is not set, swaps are unannounced.
- Fallback if renegotiation proves flaky across browsers: run it on the clip pipeline and reject uploads from the inactive player. This loses the mid-sentence cutoff feel but keeps the rule enforced.

### 3.5 Timed voice

For `voice-timed`: normal `voice` topology at round start, then at `openSeconds` the comms controller sends every client a peer list of `[]`, which tears the connections down using the existing logic. Push `comms.voiceRemainingMs` into views for the countdown. This is the smallest change in this section.

### 3.6 Arena mode (shared instance)

Batch 1 assumed one puzzle instance per team. Arena puzzles have one instance for the whole room.

**Manifest.**

```ts
interface PuzzleManifest {
  // ... existing fields ...
  instance: 'per-team' | 'shared';   // default 'per-team' so batch 1 manifests need no change
}
```

**Runtime.**
- For `shared`, the puzzle runtime instantiates once per round with `InitContext.players` set to every player in the room and a new `InitContext.teams: Array<{ id, playerIds }>`.
- `apply`, `view`, `tick`, `onSignal` behave exactly as before; `view` is still per player.
- `isSolved` means "the round is over."
- `score` gains a shared-instance form:

```ts
score(state): { moves?: number; elapsedMs?: number }                      // per-team modules, unchanged
score(state): { teams: Record<TeamId, { moves?: number; elapsedMs?: number; points?: number }> }  // shared modules
```

- Round resolution for shared modules: the engine ranks teams from the returned `teams` map using the module's `winCondition` (`race`: lowest `elapsedMs` among solved teams; `compare`: highest `points`, or lowest `moves` if `points` is absent). The grace window does not apply; there is only one instance, so there is nothing to wait for.
- Signals in a shared instance may target a specific player. Extend the signal message with an optional `to: playerId`. The manifest's `signals` list is still the allowed set; the server relays to `to` if present, otherwise to teammates as before.

**Comms.** Existing rules already cover arena puzzles: `voice` with `scope: 'all'`, `none`, and `signals`. No new rule types needed.

**Catalog filtering.** Unchanged. Shared modules declare `teams` and `playersPerTeam` like anything else.

**Disconnect.** Unchanged. The round pauses for everyone in the room, which is already the batch 1 behavior.

### 3.7 Per-module score adjustments

Two batch 2 modules (Split Hairs, Ghost Ink) need to report a score that is not raw elapsed time or move count. The contract already allows this: `score()` returns whatever the module computes, and the engine only compares. Document in `PUZZLE_AUTHORING.md` that a module's `elapsedMs` may include penalties and that `points` (new, see 3.6) may be used by per-team compare modules too, ranked highest-first. Update the compare-resolution code to accept `points` on per-team modules.

### 3.8 View helpers for blind states

Several modules black out a player entirely (Walkie's inactive player, Melody Sort already does something similar for audio). Add a tiny shared client component `<Blackout label="Listen" />` so modules don't each invent one.

---

## 4. Per-team puzzle modules

Each entry: concept, views, actions, resolution, comms, win, team shape, content needs, and a **Defaults I chose** list of things that were not explicitly decided in design and should be treated as knobs.

### 4.1 Ghost Ink

- **Concept.** One player (Drawer) sees a target scene: a handful of labeled objects at specific positions on a canvas. The other (Placer) has the same object palette and a blank canvas, and has to place the objects where they belong. The only channel is the Drawer's ink, which fades about a second after it is drawn, so the Drawer can gesture but never build up a diagram, and the Placer can't look away.
- **Views.**
  - Drawer: the target scene (objects with labels at their positions), the Placer's canvas overlaid semi-transparently so they can see what has been placed so far, the drawing surface, their own ink fading as they draw.
  - Placer: blank canvas, palette of the full object set (labels + icons), their placed objects (draggable), the Drawer's incoming fading ink overlaid on the canvas, a Submit button.
- **Actions.** Placer: `place { objectId, x, y }`, `move { objectId, x, y }`, `remove { objectId }`, `submit`. Drawer: none through the puzzle; all their input is the draw stream.
- **Resolution.** Round ends on `submit` or timer. Per-object accuracy = `max(0, 1 - distance / maxDistance)` where `distance` is between the placed position and the target position (normalized coordinates) and `maxDistance` is half the canvas diagonal. Objects in the target that were never placed score 0. Placed objects that are not in the target are ignored. Team score = mean accuracy across target objects.
- **Result screen.** Show the target and the placement side by side with per-object accuracy, so the team sees exactly which ones they botched. The number that gets compared is the mean.
- **Comms.** `{ type: 'draw', fadeMs: 1000, from: 'role' }`. Drawer's view has `canDraw: true`, Placer's has `canDraw: false`. No voice, no other signals.
- **Win.** `compare`, highest mean accuracy; tie by earlier submit time.
- **Teams.** 2 per team (3-player: two Placers each own half the palette; Drawer sees both canvases).
- **Content.** A palette of about 12 objects. Start with simple SVG icons or emoji (tree, house, dog, boat, sun, ladder, bucket, chair, key, cloud, fish, hat) so no art dependency blocks the build.
- **Defaults I chose.**
  - The target scene uses a subset of the palette (5-7 of 12), so the Drawer has to convey *which* objects as well as *where*. If that is too hard, use all 12 and it becomes pure positioning.
  - The Drawer sees the Placer's canvas. Without this there is no feedback loop and the Drawer is broadcasting into the void. If that makes it too easy (Drawer draws correction arrows), hide it.
  - Fade 1000ms, round 90s.

### 4.2 Split Hairs

- **Concept.** The Guesser sees a list of six to eight words that are all very close in meaning (sad, gloomy, bummed out, reluctant, defeated, wistful). The Drawer sees a *picture* that represents the target word, never the word itself and never the list. Using fading ink, the Drawer has to convey not just "sad" but "sad and not any of those neighbors." Every wrong guess locks the Guesser out for an escalating number of seconds while the Drawer keeps drawing.
- **Why the picture and not the word.** Give the Drawer the word and they will spell it with the pen; fading ink barely slows that down. Give them a picture and there is nothing to spell. The accepted cost is that a picture blurs the nuance between clustered words; the Drawer is in the same fog as the Guesser, which is the joke.
- **Why the tight cluster is the base, not a mode.** Serving similar words is what makes the Drawer's job hard and funny. Don't build a "mixed difficulty" list generator; every list is a cluster.
- **Views.**
  - Drawer: the picture, the drawing surface, a wrong-guess indicator (flash + "locked out for Ns") that does *not* show which word was guessed, and no word list.
  - Guesser: the word list as buttons, incoming fading ink, their own wrong picks greyed out, a lockout countdown when locked.
- **Actions.** Guesser: `guess { word }`. Drawer: draw stream only.
- **Resolution.** Correct guess solves. Wrong guess: `lockoutMs = lockoutBase * 2^(wrongCount - 1)` (5s, 10s, 20s, 40s). During lockout `guess` is rejected. Round timer keeps running.
- **Comms.** `{ type: 'draw', fadeMs: 1000, from: 'role' }`. No voice.
- **Win.** `race`, first team to guess correctly. Round cap; no correct guess = no point.
- **Teams.** 2 per team.
- **Content.** This module lives or dies on its content. Define a JSON schema and ship a starter pack:

```json
{
  "clusters": [
    {
      "id": "sadness",
      "words": ["sad", "gloomy", "bummed out", "reluctant", "defeated", "wistful", "homesick"],
      "pictures": {
        "sad": ["sad-01.svg", "sad-02.svg"],
        "gloomy": ["gloomy-01.svg"]
      }
    }
  ]
}
```

  The seed picks a cluster, a target word from it, a picture for that word, and the six to eight words to show (always including the target). Pictures should be simple, expressive line art; a starter pack of ~15 clusters with one picture per word is enough to playtest. Contributors can add clusters without code.
- **Defaults I chose.**
  - Lockout instead of "add N seconds to the clock." Lockout is the same idea but works natively with `race` resolution and is more visceral. If Jonathan prefers a visible clock penalty, switch the module to `compare` on `elapsedMs + penalties`.
  - Lockout base 5s, doubling. The design conversation settled on "small and escalating" for tight clusters; these are the numbers.
  - The Drawer does not see which word was guessed wrong. Showing it leaks vocabulary the Drawer could then spell. If playtests show the Drawer needs more feedback, show the wrong word to the Drawer but disable the pen for 2s afterward.
  - Fading ink is kept even though the spelling cheat is gone. Persistent ink is a legitimate easy mode; expose `fadeMs` as a tunable and try `0` (no fade) once.

### 4.3 Echo Claw

- **Concept.** A claw machine seen from above. A toy drifts around inside it, bouncing off the walls. The Spotter can see the toy; the Operator can only see the claw, and drives it. They can talk, but every message arrives five seconds late, so the Spotter has to stop reporting where the toy *is* and start predicting where it *will be*. The toy's bounces make that prediction reliable right up until it hits a wall, at which point everything the Spotter just said is wrong.
- **Views.**
  - Spotter: machine interior top-down, toy position (live), claw position, walls, record button, "messages in flight" indicator.
  - Operator: machine interior, claw position, walls, drop button, incoming clip player. No toy.
- **Actions.** Operator: `move { dx, dy }` (held-key, applied per tick, capped speed), `drop`. Spotter: clips only.
- **Toy motion (in `tick`).** Constant speed, reflects off walls, plus a small seeded angular perturbation (±15°) on each bounce so it is not perfectly predictable. Deterministic from the seed and a fixed tick rate, so every team's toy follows the identical path. Speed tuned so crossing the machine takes about as long as the delay.
- **Drop.** Claw descends over ~1.5s, grabs if the toy is within `grabRadius` at the moment it closes, returns. Cooldown 2s. A successful grab scores one and the toy respawns at a seeded position.
- **Comms.** `{ type: 'delayed-clips', maxSeconds: 5, delayMs: 5000 }`, two-way.
- **Win.** `compare`, most grabs when the round ends; tie by time of last grab.
- **Teams.** 2 per team.
- **Defaults I chose.**
  - Compare on grab count with respawn, rather than race to the first grab. A single grab through a five-second delay is too luck-driven to settle a round on.
  - Both directions delayed. The Operator rarely needs to speak, but "I'm dropping now" arriving late is funny.
  - Round 75s, claw speed such that crossing the machine takes ~6s, toy crossing ~5s.

### 4.4 Color Sweep

- **Concept.** A large swatch drifts through a color gradient and back, five times. The Locker has to hit the button when the swatch matches a target they cannot see. The Spotter can see both the target and the live sweep, but every message they send is delayed by a *different random amount*, so "now" might arrive in two seconds or eight, and "a bit more orange" might arrive after "now." If the Locker has not pressed by the end of the fifth sweep the team automatically loses the round.
- **Views.**
  - Locker: the sweeping swatch, sweep counter (1 of 5 ...), a single Lock button, incoming clips.
  - Spotter: the target swatch, the live sweeping swatch beside it, record button, messages-in-flight indicator.
- **Actions.** Locker: `lock` (once; further presses rejected). Spotter: clips only.
- **Gradient.** Seeded: five random color stops define a gradient; the target is a random parameter `t* ∈ [0.1, 0.9]` along it. The sweep moves `t` from 0 to 1 and back at constant speed. All teams see the same gradient, target, and sweep timing.
- **Resolution.** On `lock`, score = `|t_lock - t*|` (distance along the gradient parameter, lower is better), reported as `points = 1 - distance`. Not locking by the end of sweep 5 = `points = 0` and marked as auto-loss. Round ends for the team on lock.
- **Comms.** `{ type: 'delayed-clips', maxSeconds: 5, delayRangeMs: [2000, 8000] }`, two-way.
- **Win.** `compare`, highest `points`; tie by earlier lock.
- **Teams.** 2 per team.
- **Defaults I chose.**
  - The Spotter sees the live sweep, not just the target. If they saw only the target they would describe it once and the delay would never matter; the mechanic needs them reacting to the sweep.
  - One lock per round, not best-of-several. The design discussion landed on "five opportunities, you commit on one." If that feels too punishing, allow one lock per sweep and keep the best.
  - Distance along the gradient parameter rather than perceptual color distance. It is simpler, exactly fair, and easy to display as a percentage. Swap in a Lab delta later if the gradient makes some regions feel unfairly wide.
  - Sweep: 6s each direction, so 12s per full sweep, 60s round.

### 4.5 Airtime

- **Concept.** A building with a couple of floors, corridors, dead ends, and stairs. The Navigator sees the whole map and an ordered list of objectives inside it (pull the lever in the boiler room, then take the file from office 3, then get out). The Walker is inside, with vision of about one tile: enough to see they are at a junction, not enough to see where any branch leads. They can talk, but each player has thirty seconds of push-to-talk for the entire round. Wrong turns cost only time, which is punishment enough when the mic is draining.
- **Views.**
  - Navigator: full map, objective markers numbered in order, the Walker's live position, both players' remaining mic budgets, record button.
  - Walker: fog-of-war view (radius 1 tile), the objective list as text with done/not-done (no locations), an Interact button that lights up when standing on the current objective, both budgets, record button.
- **Actions.** Walker: `move { dir }` (grid step, rejected into walls), `interact` (only valid on the *current* objective tile; objectives are ordered). Navigator: clips only.
- **Building generation.** Seeded: a grid floor plan, 1-3 floors connected by stair tiles, rooms with doors, some dead-end corridors, an entrance tile. Place 2-3 objectives in rooms that are reasonably far apart, then verify with BFS that the full route (entrance -> obj 1 -> obj 2 -> obj 3 -> exit) exists and has length within a target band so rounds are consistent. Exit = entrance tile.
- **Resolution.** Solved when all objectives are done in order and the Walker is back on the exit tile.
- **Comms.** `{ type: 'budget-clips', maxSeconds: 5, budgetSeconds: 30 }`, two-way, both players budgeted.
- **Win.** `race`. Round cap 3 min. If nobody finishes, `compare` fallback on objectives completed, then distance to the next objective.
- **Teams.** 2 per team.
- **Defaults I chose.**
  - The Navigator sees the Walker's position. Hiding it (so the Walker has to describe their surroundings and the Navigator dead-reckons) is a great hard mode; make it a manifest option and playtest both.
  - Both players get a budget, not just the Navigator. The Walker occasionally needs "which door?" and having a budget to burn on it is part of the pressure.
  - 30s each. Tune against route length; the design intent is that it is *not enough* to narrate the whole route.
  - Walker's mic-off default while locked out; clips are the only speech, so there is no "accidental talking."

### 4.6 Walkie

- **Concept.** Two rooms, one per player, seen top-down. Each room has a locked exit gate and a row of switches. Every switch does something in the *other* room: some open one of your partner's gates, some close one, some do nothing. Only one player is active at a time: the active player can see their room, move, and flip switches, and their mic is live. The inactive player's screen is black and they are frozen; all they can do is listen. Control swaps between the two of them at random, with no warning, so a sentence can get cut off halfway and the information in the second half is just gone.
- **Views.**
  - Active player: their room (walls, gates with open/closed state, switches with labels), their character, `comms.activePlayerId` (them), a "you're live" indicator.
  - Inactive player: `<Blackout label="Listen" />`. Nothing else in the view. Their room state is not sent while inactive, so they cannot peek.
- **Actions.** Active player: `move { dir }`, `flip { switchId }` (toggle). Inactive player: all actions rejected.
- **Level generation.** Seeded. Each room: 6 switches with distinguishable labels (color + symbol), 2-3 gates between the player and their exit. Cross-wiring: in room A's switches, 2 open gates in room B, 2 close gates in room B (they are "traps": if a gate was opened and a trap is flipped on, it closes again), 2 are dead. Symmetric for room B. Wiring is never visible; the only way to learn it is to flip something while active and hear from your partner, on their turn, what changed. Because flipping everything nets zero, brute force does not work.
- **Resolution.** Solved when both players are standing on their exit tiles. Since only one is active at a time, the last leg is: active player reaches exit, waits for swap, other player reaches exit.
- **Comms.** `{ type: 'voice-alternating', swapIntervalMs: [15000, 40000] }`. No `warningMs`.
- **Win.** `race`. Round cap 4 min.
- **Teams.** 2 per team.
- **Defaults I chose.**
  - Unannounced swaps. Adding `warningMs: 3000` is the obvious easy mode.
  - Six switches per room in a 2 open / 2 close / 2 dead split. Adjust the split for difficulty.
  - The inactive player's room state is withheld entirely, not just blacked out client-side. This matches the batch 1 principle that hidden information never reaches the client.

### 4.7 Swap Stack

- **Concept.** Build the tallest tower you can. The Builder places pieces onto a set of columns, but every piece looks like plain wood to them. The Sorter can see the real materials (wood, iron, steel, concrete), each piece's weight and strength, and the load on every placed piece. The Sorter never places anything. All they control is a two-piece queue: before each placement, they can swap the next two pieces or leave them. Whether they swapped is the only thing the Builder ever learns. There is no other channel. "They swapped" might mean "this one is better first" or "the other one was terrible," and not swapping is also a message.
- **Views.**
  - Builder: the columns and placed pieces (all rendered as wood), the two-piece queue (as wood), a "swapped!" animation when the Sorter swaps, the current phase (waiting for Sorter / your move), pieces remaining.
  - Sorter: the same structure with true materials, per-piece load bars, the integrity readout, the queue with true materials, Swap / Keep buttons during their phase.
- **Actions.** Sorter: `swap`, `keep` (or timeout = keep). Builder: `place { column }`.
- **Turn structure.** Per piece: Sorter phase (up to 5s) -> Builder phase (up to 8s; timeout places on the shortest column). Repeat for a fixed piece count.
- **Structural model.** Each material has `{ weight, strength }`: wood `{1, 2}`, iron `{3, 5}`, steel `{4, 8}`, concrete `{5, 6}`. Pieces stack by gravity in one of 5 columns. For each placed piece, `load = sum of weights of pieces above it in its column`. If `load > strength`, that piece fails: it and everything above it fall off and are removed. Failure resolves immediately after a placement, and the Sorter sees the load bars so they can see it coming; the Builder just sees pieces fall.
- **Resolution.** After the last piece, `points = height of the tallest surviving column`; tie by total surviving pieces.
- **Comms.** `{ type: 'none' }`. The swap indicator is puzzle state (it is in the Builder's view), not a comms signal.
- **Win.** `compare`, highest `points`.
- **Teams.** 2 per team (3-player: two Builders on separate column sets sharing one Sorter and one queue).
- **Defaults I chose.**
  - Multiple columns, so the Builder has a real decision (where) and not just "place." A single column would make the Sorter's swap the only decision in the game.
  - The load rule and the material numbers. The design conversation gave the idea (concrete on wood breaks it); the model is mine. Keep it deterministic and legible over realistic.
  - 24 pieces per round with a seeded material sequence identical for all teams.
  - Optional: give the Builder 2 discards per round. It adds a second signal (Sorter swap -> Builder discards) and more to read. Off by default.

---

## 5. Arena modules (shared instance)

These use `instance: 'shared'` from 3.6. All players are in one instance; teams compete inside it.

### 5.1 Bad Advice

- **Concept.** Every player has their own small grid, their own piece, and their own hidden target. You cannot see your own target, but everyone else can. Each turn, every other player in the room sends you a direction hint. Your partner wants you home; the opponents want you lost. Hints are anonymous and shown as an unordered set, so you never know who sent what. You read the *distribution*, not the content: two matching hints look like a conspiracy, so opponents can poison a true answer just by echoing it, or split their lies to fake a lone truth-teller. Hints are submitted simultaneously and revealed together, so opponents cannot see each other's submission and coordinate.
- **Views.** Each player sees: their own grid with their piece (no target), every other player's grid with piece *and* target, the hint panel (one row per other player, four arrows), incoming hints for this turn as an anonymous shuffled list of directions, the turn timer, and the score state (who is home).
- **Actions.** Per turn: `hint { to: playerId, dir }` for each other player (may skip), then after reveal, `move { dir }` for your own piece (or skip). The module runs phases in `tick`: hint phase (10s or all in) -> reveal -> move phase (8s or all in) -> resolve.
- **Grid.** Seeded: 9x9 per player with a few wall blocks, piece start and target at least 6 steps apart. Identical grids per player across the room are fine (everyone has the same layout but their own piece and target).
- **Feedback.** None. No hot/cold, no distance readout. Reaching the target is the only signal, and it ends your run.
- **Resolution.** A team is done when both members reach their targets. First team done wins. Turn cap 30; at cap, `compare` fallback on sum of remaining Manhattan distances (lower wins).
- **Comms.** `{ type: 'signals', signals: ['up','down','left','right'] }` with per-player targeting (`to`). No voice. Signals are consumed by the module via `onSignal` (they are the hints) rather than relayed as free-form pings.
- **Win.** `race`.
- **Teams.** 2 per team, 2-3 teams. Works with 3 teams unchanged.
- **Defaults I chose.**
  - Opponents see your target. Discussed and preferred ("more aggressive"); precise lies are funnier than accidental ones.
  - Anonymous, shuffled hints. This is load-bearing: if the Builder could see which hint came from their partner, the game collapses to "follow partner."
  - A player who has reached their target still sends hints. They are now a full-time liar or helper.
  - 9x9 with walls. Walls let a lie steer you into a dead end, not just sideways.

### 5.2 Pick Six

- **Concept.** Every turn, every player secretly picks a number from 1 to 6. Picks are worth face value, but the low numbers hunt the high ones: 1 beats 6, 2 beats 5, 3 beats 4. If you pick a hunter and an *opponent* picked its prey, you score your number plus theirs and they score zero. Within a team, duplicate picks only count once, so partners want to spread out: one scoring high, one hunting. Everyone's picks are revealed after every turn, so the opponents read your split and re-split to counter it. No talking. The only way to coordinate with your partner is how you split last turn.
- **Scoring per turn.**
  - Base: each pick scores its face value.
  - Hunt: for each pair (1,6), (2,5), (3,4): if any player picked the hunter and any player on a *different team* picked the prey, every hunter-picker scores `hunter + prey` instead of `hunter`, and every prey-picker on an opposing team scores 0.
  - Team dedupe: if two teammates pick the same number, the team scores it once.
  - Team turn score = sum of its members' scores after the rules above.
- **Views.** Everyone sees the same thing: the six buttons, the turn timer, last turn's picks by player name, running team totals, turns remaining.
- **Actions.** `pick { n }` during the pick phase (8s); no pick = 0 for that player. Module reveals in `tick`.
- **Resolution.** 10 turns. Highest team total wins the round.
- **Comms.** `{ type: 'none' }`.
- **Win.** `compare`, highest `points`.
- **Teams.** 2 per team, 2-3 teams. With 3 teams, "different team" in the hunt rule means any of the others.
- **Defaults I chose.**
  - Hunting is cross-team only; you cannot zero out your own partner. The friendly-fire variant (hunting applies to anyone) adds a coordination dimension and is a one-line change; try it in playtest.
  - Two hunters of the same number from different teams both score the full `hunter + prey`.
  - 10 turns, 8s each.

### 5.3 Going Once

- **Concept.** A piece of art goes up for auction. One player from each team bids, in the open, with everyone on voice. One team also has an Appraiser who knows the true value; the other team's second player is the Seller and knows nothing. The Appraiser has to steer their Bidder to win the piece below its value without saying enough for the opposing Bidder to work out the number. Silence is a weapon: let the bidding climb and say nothing, and the opponent may overpay. But if the opponent bails first, your own partner is stuck holding an overpriced painting. Both Bidders are listening to everything, trying to tell who is helping and who is setting a trap.
- **Roles per round.** Seller team rotates each round. Seller team: Seller + Bidder. Every other team: Appraiser + Bidder. With 2 teams that is Seller, Bidder, Appraiser, Bidder. With 3 teams there are two informed teams competing plus the Seller team's blind Bidder.
- **Views.**
  - Appraiser: the art, its true value, the live bid ladder. No buttons.
  - Bidders: the art, the live bid ladder, bid buttons (+50, +100, +250), a Pass button, the going-once timer. No value.
  - Seller: the art, the bid ladder, an Open Bidding button at the start, and the Sold hammer when the timer expires. No value.
- **Auction mechanics.** Ascending. Any Bidder may bid at any time while the auction is open. Each bid resets a 10s timer. At 10s the Seller's hammer lights ("going once"); if no bid by 15s the piece is sold to the high Bidder. No bids at all after 20s = no sale.
- **Scoring.** `V` = true value (seeded, $200-$2,000 in $50 steps). The winning Bidder's team gains `V - price`, which can be negative. Every other team gains 0. No sale = 0 for everyone. Round winner = highest gain; a team that overpaid therefore hands the round to the other side.
- **Comms.** `{ type: 'voice', scope: 'all' }`. The whole room hears everything.
- **Win.** `compare`, highest `points` (money delta this round).
- **Teams.** Exactly 2 per team, 2-3 teams.
- **Content.** The art is flavor. Generate an abstract SVG from the seed with a pompous auto-generated title ("Study in Ochre No. 4"). No assets.
- **Defaults I chose.**
  - The Seller has no money stake. Giving the Seller's team the sale price was considered and rejected on balance: the informed team would need to win at under half of value to beat the Seller's revenue, which makes bidding up the dominant strategy and the Appraiser's job pointless. The Seller's team competes through its blind Bidder, who is effectively a shill: bid up to make the informed team overpay, but you don't know `V`, so if they stop you are the one who bought it.
  - The rotation puts the Appraiser on the non-selling team. With 2 teams each team is informed every other round.
  - Bid increments and timers as above. The 10s window is deliberately long so silence can happen.

---

## 6. Content and assets

| Module | Needs | Blocking? |
|---|---|---|
| Ghost Ink | ~12 object icons | No: use emoji or 12 simple SVGs to start |
| Split Hairs | Word clusters + one picture per word | **Yes for playtest.** Ship a starter pack of ~15 clusters, 6-8 words each, with simple line-art SVGs. Define the JSON schema in 4.2 so contributors can add clusters without code. |
| Airtime | Tile art for floors/walls/doors/stairs/objectives | No: colored rectangles are fine for v1 |
| Walkie | Switch/gate/character sprites | No |
| Swap Stack | Four material textures + "wood" disguise | No: flat colors |
| Going Once | None | Procedural |
| Others | None | |

Word clusters are the one place this batch depends on writing rather than code. Start the starter pack early so it doesn't gate the Split Hairs playtest.

---

## 7. Build order

Ordered so each step reuses something the previous one built. Playtest after B2, B5, and B8.

**B0: Engine, comms**
- `CommsRule` extensions (3.1)
- Clip pipeline hold / jitter / budget (3.2)
- `voice-timed` teardown (3.5) - smallest change, do it first to touch the comms controller
- Draw stream + `<FadingCanvas>` (3.3)
- `<Blackout>` (3.8)
- Update the puzzle test harness to drive the new comms rules in scripted tests

**B1: Engine, arena**
- `instance: 'shared'` runtime path, `InitContext.teams`, shared `score()` form, per-target signals (3.6)
- Compare resolution accepts `points` (3.7)
- A dummy shared puzzle ("everyone press the button, first team with both pressed wins") to exercise it end to end

**B2: Ghost Ink, Split Hairs**
- Both on the draw stream. Ghost Ink first (no content dependency), then Split Hairs with the starter word pack.
- **Playtest checkpoint.** Validates the draw channel and the fade timing.

**B3: Echo Claw, Color Sweep**
- Both on `delayed-clips`. Echo Claw first (fixed delay is simpler to reason about), then Color Sweep (jitter).

**B4: Airtime**
- `budget-clips` plus the building generator. The generator is the biggest single piece of non-engine code in this batch; keep it in its own file with tests that assert every generated building is solvable and within the route-length band.

**B5: Pick Six, Bad Advice**
- First real arena modules. Pick Six is nearly UI-free and validates shared scoring; Bad Advice validates per-target signals and the simultaneous-reveal pattern.
- **Playtest checkpoint.** You now have 5 new per-team puzzles and 2 arena puzzles.

**B6: Swap Stack**
- `comms: none` with the swap-as-message pattern. Pure puzzle logic, no comms work.

**B7: Going Once**
- `voice: all` in a shared instance. Role rotation across rounds is new: the match engine needs to pass round index into `InitContext` (add `roundIndex: number`) so the module can rotate the Seller team.

**B8: Walkie**
- Last because `voice-alternating` (3.4) is the only WebRTC renegotiation in the project and the most likely thing to fight browsers. Build the puzzle against the clip-pipeline fallback first so the level logic can be tested, then swap in renegotiation.
- **Playtest checkpoint.** Full batch.

**B9: Docs**
- Update `PUZZLE_AUTHORING.md` with the new comms rules, the shared-instance form, `points` scoring, and the draw stream. Add each module's `README.md`.

---

## 8. Tuning defaults

All of these are starting values.

| Setting | Default |
|---|---|
| Fade (draw stream) | 1000ms |
| Draw batch interval | 50ms |
| Draw rate limit | 25 batches/s/player |
| Ghost Ink round | 90s |
| Ghost Ink palette / scene | 12 objects / 5-7 placed |
| Split Hairs lockout | 5s, doubling |
| Split Hairs list size | 6-8 words |
| Split Hairs round cap | 120s |
| Echo Claw delay | 5000ms |
| Echo Claw round | 75s |
| Echo Claw grab cooldown | 2s |
| Color Sweep jitter | 2000-8000ms |
| Color Sweep sweeps | 5 (6s per direction) |
| Airtime mic budget | 30s per player |
| Airtime round cap | 180s |
| Airtime objectives | 2-3, ordered |
| Airtime walker vision | radius 1 tile |
| Walkie swap interval | 15-40s, unannounced |
| Walkie switches per room | 6 (2 open / 2 close / 2 dead) |
| Walkie round cap | 240s |
| Swap Stack pieces | 24 |
| Swap Stack columns | 5 |
| Swap Stack phase timers | Sorter 5s / Builder 8s |
| Bad Advice grid | 9x9, 30-turn cap |
| Bad Advice phase timers | hint 10s / move 8s |
| Pick Six turns | 10, 8s each |
| Going Once value range | $200-$2,000 |
| Going Once bid timer | 10s, hammer at 15s, no-sale at 20s |
| Clip cooldown (all clip rules) | 2s |

---

## 9. Decisions made in this document that were not made in design

These are the calls I made to turn the design conversation into a buildable spec. Each is flagged inline above; this is the short list so they are easy to veto in one pass.

1. Ghost Ink: target scene is a subset of the palette; the Drawer sees the Placer's canvas.
2. Split Hairs: escalating lockout instead of a clock penalty; the Drawer is not shown which word was guessed wrong; fading ink kept.
3. Echo Claw: compare on grab count with respawn, not race to first grab; both directions delayed.
4. Color Sweep: the Spotter sees the live sweep; one lock per round; scored on gradient-parameter distance.
5. Airtime: the Navigator sees the Walker's position (hard mode hides it); both players have a budget.
6. Walkie: unannounced swaps; 2/2/2 switch split; inactive player's room state withheld server-side.
7. Swap Stack: five columns, the load model, and the material numbers are all mine. Builder discards are off by default.
8. Bad Advice: hints are anonymous and shuffled (load-bearing); opponents see your target; no hot/cold feedback.
9. Pick Six: cross-team hunting only; team dedupe.
10. Going Once: the Seller has no money stake; round winner is the highest money delta; Appraiser sits on the non-selling team.

Two engine calls worth a second look:
- Delay and budget channels are clip-based rather than live audio. This is the only enforceable option without a media server, and the delay channels don't lose anything from it. The budget channel does lose a little immediacy.
- Walkie is the only place WebRTC gets renegotiated mid-round. If that turns out to be painful across browsers, the clip fallback keeps the rule enforced at the cost of the mid-sentence cutoff.

---

## 10. Still on the shelf

Ideas from the design session that were discussed but not specified, kept here so they aren't lost:
- A channel where your vocabulary of sendable tokens grows as you solve (start with three symbols, earn more).
- Arena variants: a shared board where blocking the other team is possible but telegraphs your own plan; a common resource pool where taking what you need starves someone else; hints that cost something so silence is a real choice.
- Spectator mode, garbled-voice lobby mode, and the other batch 1 deferrals are unchanged.
