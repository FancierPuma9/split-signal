# Split Signal - Build Plan

Open-source, browser-based party game. Teams of two (or more) solve communication-based puzzles cooperatively while racing other teams in the same room. Every puzzle is mechanically simple; the twist is always in how players are allowed to communicate.

Inspirations: *We Were Here* (asymmetric information, you can't see your partner's screen) and *Jackbox* (room codes, play with people you know).

This document is the spec for the first build. It is written to be handed to Claude Code and worked through phase by phase.

---

## 1. Design principles

These are the decisions that shape everything else. Don't drift from them without a reason.

1. **Communication is the game.** Each puzzle declares its own communication rule (full voice, teammates only, discrete signals only, none). The server enforces it; the client never decides who it can talk to.
2. **Friends only.** Rooms are created and joined by short code. No matchmaking, no strangers, no rankings, no anti-cheat beyond server authority.
3. **Server-authoritative.** The server owns all game state. Clients render a per-player view and send actions. This is what makes asymmetric views, comms gating, and rejoin trivial.
4. **Thin puzzle contract.** A puzzle is a self-contained module. Adding puzzle number twenty must never require touching the lobby, networking, or match engine. Contributors should be able to copy a template and ship.
5. **Random by seed.** Nobody picks puzzles, not even the host. A secret seed generated at match start selects and orders them, and every team gets an identical instance of each puzzle.
6. **Tight sync inside a team, loose sync across teams.** Teams play their own instance of each puzzle in real time. Cross-team competition is by score (time or moves), so teams don't need to be synchronized with each other.
7. **Twist the channel, not the mechanic.** When designing new puzzles: take something simple and make the way people have to talk about it weird, funny, or constrained. Avoid leaning on "one sees this, one sees that" for every puzzle.

---

## 2. Stack

Decided:
- **Server:** Node.js, WebSockets, TypeScript
- **Client:** React, TypeScript
- **Voice:** WebRTC audio (peer-to-peer between browsers), signaled over the game WebSocket. Server dictates the peer topology per round.
- **Auth:** guest by default (display name only), optional one-click Google sign-in for accounts
- **Room state:** in-memory on the server, behind a store interface so Redis can be swapped in later
- **Puzzle client code:** lazy-loaded per module, not one big bundle

Suggested (change freely):
- pnpm workspaces monorepo
- Vite for the client
- `ws` or `socket.io` for WebSockets
- Canvas or PixiJS inside puzzles that need it (sliding grid, color mix); plain React DOM for the rest
- SQLite for v1 stats storage (Postgres later if needed)
- Vitest for tests

---

## 3. Repo layout

```
split-signal/
  packages/
    shared/          # message types, puzzle contract types, comms rule types, seeded RNG
    server/          # HTTP + WebSocket server, room manager, match engine, puzzle runtime, auth, stats
    client/          # React shell: home, lobby, match HUD, results; puzzle host; voice manager
    puzzles/
      _template/     # copy-me starter for contributors
      sliding-grid/
      recipe-cipher/
      padlock/
      color-mix/
      melody-sort/
      radio-tune/
      elevators/
      split-keyboard/
      index.ts       # catalog registration (or auto-discovery)
  docs/
    PUZZLE_AUTHORING.md
  README.md
  CONTRIBUTING.md
```

Each puzzle folder contains `manifest.ts`, `server.ts`, `client.tsx`, `README.md`, and tests.

---

## 4. Architecture

### 4.1 Server responsibilities
- **HTTP:** serves the client bundle, auth endpoints (Google OAuth), stats endpoints
- **WebSocket:** one connection per player. Message families: `room.*` (create/join/leave), `lobby.*` (seat changes, lock teams, start), `match.*` (round intro, view updates, actions, scoreboard), `comms.*` (WebRTC signaling, discrete signals, clip upload/delivery)
- **Room manager:** create room, generate code, roster, teams, host, room lifecycle
- **Match engine:** seed generation, catalog filtering, puzzle ordering, round loop, timers, resolution, scoring, pause/rejoin/surrender
- **Puzzle runtime:** instantiates one puzzle state per team per round, routes actions to the module, recomputes per-player views after every change, broadcasts only what changed
- **Comms controller:** on each round start, tells clients which WebRTC peers to open or close, which signal buttons to expose, and rate-limits signals server-side

### 4.2 Client responsibilities
- **Shell:** home (create / join / name / optional sign-in), lobby, match HUD (round name, timer, scoreboard), results
- **Puzzle host:** when a round starts, lazy-loads that puzzle's client bundle and mounts it with `view`, `send`, `signals`, and `timer` props
- **Voice manager:** opens and closes WebRTC audio connections exactly as instructed by the server. Never opens a connection the server didn't ask for.
- **Signal UI:** renders whatever discrete signals the current puzzle allows (arrow buttons, a nudge button, a record button)
- **Seat token:** stored in `localStorage` on join, used for rejoin

### 4.3 Message flow (one action)
1. Client sends `match.action { payload }`
2. Server looks up the player's team and puzzle instance, calls `module.apply(state, playerId, action)`
3. If rejected, server replies with the reason; state unchanged
4. If accepted, server stores new state, calls `module.view(state, playerId)` for every player on that team, and sends each player their updated view
5. Server checks `module.isSolved(state)`; if true, hands off to round resolution

Modules never send messages. They only transform state and project views.

### 4.4 Room store interface
Keep all room access behind a small interface (`get`, `set`, `delete`, `list`) with an in-memory implementation. Do not read the room map directly from elsewhere in the code. This is what makes a later Redis swap a one-file change.

---

## 5. Puzzle module contract

This is the most important section for an open-source project. Keep it thin. The engine only knows about: manifest, init, view, apply, tick, isSolved, score.

### 5.1 Manifest

```ts
interface PuzzleManifest {
  id: string;                  // 'sliding-grid'
  name: string;                // 'Sliding Grid'
  description: string;         // one or two sentences, shown at round intro
  teams: { min: number; max: number };            // how many teams can compete in this puzzle
  playersPerTeam: { min: number; max: number };   // how many players per team it supports
  winCondition: 'race' | 'compare';
  timeLimitSeconds: number;
  comms: CommsRule;
}

type CommsRule =
  | { type: 'voice'; scope: 'team' | 'all' }
  | { type: 'none' }
  | { type: 'signals'; signals: string[]; cooldownMs?: number }
  | { type: 'clips'; maxSeconds: number; direction: 'one-way' | 'two-way'; extraSignals?: string[] };
```

- `race`: first team to solve wins the round, everyone else stops.
- `compare`: every team plays until solved or time expires; best score wins.
- The catalog is filtered against the actual lobby (team count and team sizes) at match start. A puzzle that can't fit the roster is never picked.

### 5.2 Server module

```ts
interface PuzzleServerModule<State, View, Action> {
  manifest: PuzzleManifest;

  // Called once per team per round. All randomness comes from ctx.rng (seeded). Never use Math.random.
  init(ctx: InitContext): State;

  // Per-player projection. This is where asymmetry lives. Return only what THIS player is allowed to know.
  view(state: State, playerId: string, ctx: Context): View;

  // Validate and apply. Return the new state, or a rejection reason.
  apply(state: State, playerId: string, action: Action, ctx: Context): { state: State } | { reject: string };

  // Optional. Called on a fixed interval (e.g. 100ms) for puzzles with turn timers or simultaneous resolution.
  tick?(state: State, nowMs: number, ctx: Context): State;

  // Optional. Called when a player sends a discrete signal, for puzzles where signals affect state (e.g. a nudge that highlights something).
  onSignal?(state: State, fromPlayerId: string, signal: string, ctx: Context): State;

  isSolved(state: State): boolean;

  // Used by the match engine to rank teams. Provide whichever apply to this puzzle.
  score(state: State): { moves?: number; elapsedMs?: number };
}

interface InitContext {
  seed: string;       // shared across all teams this round
  rng: Rng;           // seeded PRNG derived from seed + puzzle id
  teamId: string;
  players: PlayerInfo[];   // the players on this team, in seat order
}
```

Rules the runtime guarantees, so modules don't have to:
- `view()` is called after every accepted action and every tick that changes state; each player receives only their own view
- On rejoin, the runtime simply re-sends `view()` to the returning player; modules need no reconnect logic
- Elapsed time is tracked by the runtime; modules don't need their own clocks unless they have internal turn timers
- The same `seed` goes to every team, so calling `init` with it produces identical puzzle layouts for all teams

### 5.3 Client module

```ts
interface PuzzleClientProps<View, Action> {
  view: View;
  send: (action: Action) => void;
  signals: {
    allowed: string[];
    send: (signal: string) => void;
    incoming: Array<{ from: string; signal: string; at: number }>;
  };
  clips?: {
    record: () => Promise<void>;   // handles mic capture and upload
    incoming: Array<{ from: string; url: string; at: number }>;
  };
  timer: { remainingMs: number; totalMs: number };
  me: PlayerInfo;
  team: TeamInfo;
}

export default function PuzzleView(props: PuzzleClientProps<View, Action>): JSX.Element;
```

The client module renders the view and calls `send`. It has no network code and no knowledge of other teams.

### 5.4 Contributor path (document this in `docs/PUZZLE_AUTHORING.md`)
1. Copy `packages/puzzles/_template` to `packages/puzzles/<your-puzzle>`
2. Fill in `manifest.ts`, `server.ts`, `client.tsx`
3. Register it in `packages/puzzles/index.ts`
4. Run the puzzle test harness: it calls `init` with a fixed seed, replays a scripted action sequence, and asserts `isSolved` and `score`. Also asserts that `view()` for each player never leaks fields marked hidden.
5. Run locally with `pnpm dev --puzzle <id>` which starts a room with a single forced puzzle for quick iteration
6. Open a PR

---

## 6. Room and lobby flow

1. **Home:** "Create room" or "Join room" (enter code). Display name required. Optional Google sign-in.
2. **Create:** server generates a short code (4 letters, unambiguous alphabet, no vowels to avoid accidental words). Creator is host.
3. **Lobby:**
   - Roster shows everyone who joined
   - Host sets the number of teams and max players per team (within engine limits)
   - Players drag themselves into team seats
   - Host locks teams once everyone is seated
   - Room caps at its max size; extra joiners see "room full"
4. **Start (host only):**
   - Roster is frozen
   - Server generates a secret seed
   - Catalog is filtered to puzzles whose `teams` and `playersPerTeam` fit the locked lobby
   - Seeded shuffle picks N puzzles (see tuning defaults)
   - Match begins
5. **No spectators in v1.** Deferred; see section 15.

Room state shape: `{ code, hostId, players: [{ id, name, seatToken, connected, userId? }], teams: [{ id, playerIds }], status: 'lobby' | 'in-match' | 'ended', match?: MatchState }`

Rooms are garbage-collected after a period of no connected players.

---

## 7. Match flow

For each round:
1. Server instantiates the puzzle for each team with the shared seed
2. Round intro screen to all players: puzzle name, description, comms rule, time limit. 3-2-1 countdown.
3. Comms controller applies the puzzle's `CommsRule`: opens or closes WebRTC peers, enables signal buttons or clip recording
4. Round runs until resolved (section 8)
5. Scoreboard screen (short, auto-advances) showing round result and running totals
6. Next round

After the last round: final results screen. Signed-in players get stats saved automatically; guests see "Sign in to save these results." Options: play again (new seed, same roster) or back to lobby.

---

## 8. Round resolution

**Race puzzles**
- First team to solve triggers a grace window (default 2s, tunable per puzzle)
- Any other team that solves inside the window is also recorded; lowest elapsed time wins
- After the window, the round ends for everyone, immediately. Nobody waits for the other team to finish.
- Timer expires with no solves: no point awarded

**Compare puzzles**
- Round continues until every team has solved or the timer expires
- Unsolved at timeout counts as infinite moves
- Best score wins: fewest moves, ties broken by elapsed time
- A per-turn timer inside the puzzle keeps teams moving (module's responsibility via `tick`)

**Ties:** v1, no point awarded. Revisit after playtesting.

---

## 9. Scoring

v1: one point per round won, zero otherwise. Most points at the end wins the match.

Implement scoring as a pluggable `ScoringMode` (interface: `onRoundResult(results) -> deltas`, `finalStandings()`) so tournament-style, best-of, and weighted modes can be added later without touching the match engine.

---

## 10. Communication system

**Voice (WebRTC)**
- Peer-to-peer audio between browsers; server only does signaling
- At round start the server sends each client an explicit list of peers to connect to, based on the rule (`team` = teammates only, `all` = everyone in the room, `none` = nobody)
- Client tears down any connection not on the list
- If the rule is `none`, no connection exists, so there is nothing to bypass client-side
- Mic permission is requested once, on first join, not per round

**Signals**
- Discrete, server-relayed messages defined by the puzzle manifest (e.g. `['up','down','left','right']` or `['nudge']`)
- Server enforces the allowed set and the cooldown; anything else is dropped
- Delivered to teammates only

**Clips (radio puzzle)**
- Push-to-record, max N seconds, uploaded as a short audio blob
- Server decides distortion parameters (based on receiver's current puzzle state) and delivers the clip plus parameters to the receiver
- v1: receiver's client applies the distortion with Web Audio before playback. This is not cheat-proof but is fine for a friends game and avoids a media server entirely. Server-side processing (ffmpeg) is a drop-in upgrade later.
- Cooldown between clips to prevent spam

**Future:** host-selectable "garbled voice" lobby mode that distorts all voice puzzles. Not in v1.

---

## 11. Disconnects, rejoin, surrender

- On join, each player gets a seat token, stored in `localStorage`
- On socket drop mid-round: player marked disconnected, the round pauses for everyone (timers freeze), all players see "Waiting for [name] to reconnect"
- Rejoin: same room code and seat token. Server restores the seat, re-sends the current view, unpauses when all are back
- While waiting, other players see a **Surrender match** button. Surrender ends the entire match (not just the round), shows the final scoreboard as it stood, and closes the room
- Disconnect in the lobby: seat is held for a grace period, then freed

---

## 12. Auth and stats

- **Guest:** display name only. Nothing persisted.
- **Google sign-in:** one click. Creates an account keyed on Google ID. No other providers in v1.
- **Stats tracked per account:** matches played, matches won, rounds won, and per-puzzle personal bests (fastest time for race puzzles, fewest moves for compare puzzles)
- **After a match:** signed-in players' results save automatically; guests see a prompt to sign in and claim theirs (results held briefly server-side to allow this)
- **Schema (minimal):** `users`, `matches`, `match_players`, `puzzle_results`
- Auth must never be required to create, join, or play in a room

---

## 13. Puzzle catalog (v1: 8 modules)

Each entry: concept, views, actions, comms, win condition, team shape, implementation notes.

### 13.1 Sliding Grid (build this one first)
- **Concept:** A grid of sliding tiles. Each player owns a few tiles, each with a target position. You see only your own tiles and their targets. Teammates' tiles are invisible to you, so the board is full of obstacles you can't perceive.
- **Views:** own tiles (with color/label), own targets, empty-looking board elsewhere. Failed-move feedback (bump/shake) on your tile.
- **Actions:** each turn, choose one of your tiles and a direction, or pass. Turn timer forces resolution.
- **Resolution (simultaneous):** collect all players' moves, then resolve as one step. A move succeeds if its destination is free after all moves are applied, so following a vacating tile works. Two tiles claiming the same square both fail. Order of submission never matters.
- **Comms:** `signals: ['up','down','left','right']`, with a short cooldown. No voice.
- **Win:** `compare`, fewest turns to place all tiles; tie by time.
- **Teams:** 2-4 players per team, 2-3 teams.
- **Notes:** generate the solved layout, then scramble by applying valid random moves from the seeded RNG so every instance is solvable. Tile count scales with team size. This puzzle exercises the most engine surface (asymmetric views, simultaneous tick resolution, signals comms, lazy loading), which is why it's first.

### 13.2 Recipe Cipher
- **Concept:** A cooking recipe whose instructions are written in invented glyphs. One player holds the glyph instructions; the other holds the glyph-to-letter key. They decode by describing symbols to each other. Once they know the steps, the instruction-holder preps ingredients and relays steps while the key-holder cooks.
- **Views:** Player A: glyph instructions + prep station (ingredients to chop/measure, hand-off tray). Player B: decoding key + stove (pan, heat, actions, plate). Neither sees the other's panel.
- **Actions:** A: prep ingredient, hand off. B: add to pan, adjust heat, stir, plate.
- **Comms:** `voice`, team.
- **Win:** `race`, first team to plate the correct dish. Wrong steps burn or ruin the dish (penalty, not restart).
- **Teams:** 2 or 3 per team (3-player: glyph holder, key holder/prepper, cook as separate roles).
- **Notes:** single clock, no enforced phase boundary; teams choose whether to fully decode first or cook on a partial decode. Glyphs must be abstract and hard to name ("the one that looks like a P" defeats it). Generate glyphs procedurally as SVG from the seed so contributors never hand-draw them.

### 13.3 Padlock
- **Concept:** A four-dial combination lock. Each player controls two dials. Feedback after a turn is a single shared sound that means "at least one of the dials just turned is now correct," without saying which. The puzzle is designing experiments together to isolate which dial was right.
- **Views:** both players see all four dial positions, but can only turn their own.
- **Actions:** each turn, each player turns exactly one of their dials up or down by one (or holds). Server resolves both simultaneously and emits one feedback sound.
- **Feedback rule (starting point, tune in playtest):** chime if at least one of the dials moved this turn landed on its correct value; buzz otherwise. Consider variants (chime only if the count of correct dials increased).
- **Comms:** `voice`, team.
- **Win:** `compare`, fewest turns to open; tie by time.
- **Teams:** 2 per team (scale to 3 players with 6 dials).
- **Notes:** trivial UI, good second puzzle for validating compare-mode scoring.

### 13.4 Color Mix
- **Concept:** One player sees only the target color. The other sees only the current mix. Each player controls their own set of color channel sliders with limited ranges, and the mix is the combination, so neither can solve it alone.
- **Views:** Player A: target swatch + own sliders. Player B: current mix swatch + own sliders. A never sees the mix; B never sees the target.
- **Actions:** move a slider.
- **Mix model (starting point):** each player has R, G, B sliders in 0-127; the final channel is the sum. Optionally give one player a hue-rotate knob for a second twist. Tune so both players must contribute.
- **Win:** `race`. Auto-detects when the mix is within a tolerance of the target and held for ~1.5s (avoids a spammable "submit").
- **Comms:** `voice`, team.
- **Teams:** 2 per team (3-player: split channels three ways).
- **Notes:** perceptual color distance (e.g. CIEDE2000 or a Lab delta) for the tolerance check, not raw RGB distance.

### 13.5 Melody Sort
- **Concept:** One player (Listener) hears a short target melody. The other (Arranger) has the notes as tiles and arranges them into slots, then plays the arrangement back. Only the Listener ever hears anything. The Arranger is completely deaf to the puzzle: they never hear the target and never hear their own playback.
- **Views:** Listener: replay-target button (limited uses), playback of whatever the Arranger plays. Arranger: opaque note tiles and slots, a Play button. The Arranger's view carries opaque tile IDs only, never pitches, so deafness is enforced by the server, not by client-side muting.
- **Actions:** Arranger: reorder tiles, play. Listener: replay target.
- **Comms:** `voice`, team.
- **Win:** `race`, first correct arrangement played.
- **Teams:** 2 per team (3-player: two Arrangers each own half the tiles).
- **Notes:** 6-8 notes. Synthesize with Web Audio (no audio assets needed). Consider labeling tiles with abstract symbols rather than note names so the Arranger can't reason from music theory.

### 13.6 Radio Tune
- **Concept:** The Sender sees the correct settings for a radio panel (several switches and knobs). The Receiver sees the panel. The Sender records short voice clips telling them what to set; the Receiver hears each clip distorted, with the distortion getting lighter as their settings approach correct. Several controls, not one, so feedback stays ambiguous ("something got better, but which thing?").
- **Views:** Sender: target panel settings + record button. Receiver: live panel + incoming clips.
- **Actions:** Sender: record and send clip. Receiver: flip switch, turn knob.
- **Comms:** `clips`, one-way Sender to Receiver, max ~5s per clip, cooldown. Give the Receiver a `['repeat']` signal so they can ask for the last clip again.
- **Distortion design:** each control maps to a distinct distortion layer (static, pitch shift, bandpass narrowing, chop/stutter) so a careful ear can eventually tell them apart. Severity per layer is a function of that control's distance from correct.
- **Win:** `race`, first team whose panel matches.
- **Teams:** 2 per team.
- **Notes:** clip pipeline is MediaRecorder -> upload -> server computes distortion params from Receiver's state -> Receiver client applies Web Audio effects before playback. Build the distortion as a standalone function that takes (clip, params) so it can move server-side later.

### 13.7 Elevators
- **Concept:** Two elevators and a lobby queue of passenger groups, each bound for a different floor. Each turn, each player secretly picks an elevator and a floor. No communication at all. Both players watch the identical outcome, so the only way to coordinate is to infer what your partner was going for and adapt next turn.
- **Views:** both players see the same thing: the queue, the elevators, the outcome animation.
- **Actions:** per turn, pick (elevator, floor). Turn timer; no pick = idle.
- **Resolution:**
  - Different elevators, different floors: two groups delivered
  - Same elevator: only one floor is served (pick randomly from the two, or the first submitted)
  - Different elevators, same floor: only one group moves; the other trip is wasted
- **Comms:** `none`.
- **Win:** `compare`, fewest turns to clear the queue; tie by time.
- **Teams:** 2 per team (3-player: three elevators).
- **Notes:** design queues to create real dilemmas (two large groups, urgent groups, uneven floors). The outcome animation must make it obvious what each elevator did so players can read their partner's intent.

### 13.8 Split Keyboard
- **Concept:** Both players see the same target phrase. Each owns a random scattered subset of the keyboard's letters (not a contiguous half), shown highlighted on an on-screen keyboard. The phrase must be typed collaboratively: the server only accepts a keypress from the owner of that letter, and only if it's the next character.
- **Views:** target phrase with progress, own keyboard with owned keys highlighted, error flash on wrong key or wrong owner.
- **Actions:** keypress (physical keyboard on desktop, on-screen on mobile).
- **Comms:** `signals: ['nudge']`. No voice. A nudge just pings the teammate's screen ("I think it's yours").
- **Win:** `race`, first team to complete the phrase (or a short set of phrases).
- **Teams:** 2-3 per team (letters split N ways).
- **Notes:** assign space and punctuation like any other key. Choose phrases from a seeded word list so every team gets the same text.

---

## 14. Build phases

Each phase should end with something runnable. Playtest with real people after phases 3 and 5 before going further.

**Phase 0: Scaffolding**
- Monorepo, TypeScript, lint, test runner, CI
- `shared` package: message types, puzzle contract types, `CommsRule`, seeded RNG
- Puzzle `_template` and the puzzle test harness
- A trivial "press the button" dummy puzzle to exercise the pipeline end to end

**Phase 1: Rooms and lobby**
- Create/join by code, display names, host
- Team seats, host locks teams
- Start: freeze roster, generate seed, filter catalog, pick puzzles
- Room store interface with in-memory implementation

**Phase 2: Match engine**
- Round loop with intro, countdown, timers, scoreboard, results
- Race and compare resolution, grace window
- Scoring mode interface with the v1 one-point mode
- Disconnect pause, rejoin by seat token, surrender
- Lazy-loading puzzle host on the client
- Still using the dummy puzzle

**Phase 3: Sliding Grid**
- First real module. Validates asymmetric views, simultaneous tick resolution, signals comms, and lazy loading.
- **Playtest checkpoint.**

**Phase 4: Voice, then two simple voice puzzles**
- WebRTC audio with server-driven topology (team / all / none)
- Padlock (validates compare scoring, minimal UI)
- Color Mix

**Phase 5: Melody Sort, Split Keyboard, Elevators**
- Three more modules with modest UI. Elevators validates `comms: none`.
- **Playtest checkpoint.** You now have six puzzles and a real game.

**Phase 6: Recipe Cipher and Radio Tune**
- The two heaviest builds: procedural glyphs + cooking UI, and the clip recording/distortion pipeline

**Phase 7: Auth and stats**
- Google sign-in, database, personal bests, post-match save flow

**Phase 8: Open-source release**
- README, CONTRIBUTING, `docs/PUZZLE_AUTHORING.md`, license, deploy config, hosted instance

---

## 15. Deferred (not in v1)

- Spectator mode (open question: what does a spectator see in an asymmetric puzzle?)
- Garbled-voice lobby mode across all voice puzzles
- Additional scoring modes (tournament, best-of, weighted)
- Redis-backed room store
- Additional puzzle ideas already discussed and worth revisiting: bomb defusal with a word budget, shared drawing where each player controls one cursor axis

---

## 16. Tuning defaults and open questions

Starting values. Expect all of these to change after playtesting.

| Setting | Default |
|---|---|
| Rounds per match | 5 |
| Room max players | 12 |
| Max teams | 3 |
| Max players per team | 4 |
| Race grace window | 2s |
| Round intro / countdown | 10s + 3s (was 5s; too short to read in playtesting) |
| Scoreboard screen | 6s |
| Signal cooldown (arrows) | 750ms |
| Clip max length | 5s |
| Clip cooldown | 3s |
| Disconnect hold in lobby | 60s |
| Room GC after empty | 10 min |

Open questions to settle during the build:
- Exact padlock feedback rule (see 13.3)
- Tie handling beyond "no point"
- Whether sliding grid should be `race` or `compare` (spec says compare; race may be more fun)
- Per-puzzle turn timer lengths
- Whether the host can set round count in the lobby (probably yes, within a range)
