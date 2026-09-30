# Writing a puzzle

Every Split Signal puzzle is mechanically simple. The twist is always in how players are allowed to
communicate. A puzzle is a self-contained folder; adding one never touches the lobby, networking, or
match engine.

## Quick start

1. Copy `packages/puzzles/_template` to `packages/puzzles/<your-puzzle>` (kebab-case).
2. Set `id` in `manifest.ts` to the folder name, then fill in `manifest.ts`, `types.ts`,
   `server.ts`, and `client.tsx`.
3. Register the server module in `packages/puzzles/index.ts` (in `puzzles`, or in `devPuzzles`
   while it isn't ready for real matches). The client is discovered automatically from your
   folder's `client.tsx`.
4. Write harness tests (see below) and run `pnpm test`.
5. Play it: `pnpm dev --puzzle <your-puzzle>` makes every round use your puzzle. Open
   http://localhost:5173 in one browser tab per player, create a room in one and join it from the
   others, set the teams to fit your puzzle, lock, and start.
6. Open a PR.

## The files

| File           | Purpose                                                                |
| -------------- | ---------------------------------------------------------------------- |
| `manifest.ts`  | Name, description, team sizes, win condition, time limit, comms rule   |
| `types.ts`     | `State`, `View`, and `Action` types, shared by server and client       |
| `server.ts`    | The rules. Runs only on the server                                     |
| `client.tsx`   | A React component that renders a view and sends actions. Loaded lazily |
| `*.module.css` | Optional styles. CSS modules load with your puzzle's chunk             |
| `*.test.ts`    | Harness tests                                                          |
| `README.md`    | What the puzzle is, for players and reviewers                          |

Split pure game logic into its own file (e.g. `logic.ts`) when it gets interesting; Sliding Grid's
simultaneous move resolution is a good example, tested case by case. Generators belong in their own
file too, with tests over many seeds: Airtime's `building.ts` checks 200 buildings are solvable and
inside a route-length band.

## The manifest

```ts
export const manifest: PuzzleManifest = {
  id: 'my-puzzle', // the folder name
  name: 'My Puzzle',
  description: 'One or two sentences, shown at round intro.',
  teams: { min: 1, max: 3 },
  playersPerTeam: { min: 2, max: 2 },
  winCondition: 'race', // or 'compare'
  goal: 'First team out wins', // optional line for the intro; see Win conditions
  timeLimitSeconds: 180,
  comms: { type: 'voice', scope: 'team' }, // or a list of rules; see Comms rules
  commsLabel: 'Voice, but only while you stand still', // optional; replaces the generated line
  pointsUnit: '% right', // optional; how points read in results (default ' pts')
  instance: 'per-team', // default; 'shared' for arena puzzles
  raceGraceMs: 2000, // optional, race only
};
```

## The server module

```ts
interface PuzzleServerModule<State, View, Action> {
  manifest: PuzzleManifest;
  init(ctx): State; // build the starting state
  view(state, playerId, ctx): View; // what THIS player may see
  apply(state, playerId, action, ctx): { state } | { reject: string };
  tick?(state, nowMs, ctx): State; // every 100ms, for turn timers
  onSignal?(state, fromPlayerId, signal, ctx, to?): State | { reject: string }; // before relaying
  onClip?(state, fromPlayerId, ctx): ClipRouting; // who hears a clip, with what params
  commsState?(state, playerId, ctx): PlayerCommsGate; // per-player voice overrides
  assets?(state, playerId, ctx): Record<string, PuzzleAsset | (() => PuzzleAsset)>; // files
  reveal?(state, playerId, ctx): View; // shown under the scoreboard after the round
  isSolved(state): boolean;
  score(state): PuzzleScore;
}
```

Modules never send messages or keep timers. The runtime calls `view()` for every player after each
change and sends each player only their own view, only when it changed. On reconnect it simply
re-sends the view, so you never write reconnect logic.

`init` gets `{ seed, rng, teamId, players, teams, roundIndex }`. `roundIndex` is the round number in
the match, handy for rotating roles (Ghost Ink's Drawer and Going Once's Seller team rotate on it).
`ctx` everywhere else carries `teamId`, `players`, `teams`, `elapsedMs`, `rng`, and `comms` (see
Engine-managed comms state).

### Rules

- **Randomness comes from `ctx.rng`.** Never `Math.random()` or `Date.now()` (lint enforces this).
  Every team calls `init` with the same seed, so every team gets an identical puzzle. For things
  that must line up across teams regardless of timing (Echo Claw's bounces), derive a seed in
  `init` and fork per event with ``createRng(`${seed}:${eventIndex}`)``.
- **State is immutable.** Return a new object when something changes and the same object when
  nothing does. The harness deep-freezes state, so mutation throws in tests.
- **State and views are plain JSON.** No `Map`, `Set`, `Date`, class instances, or `Infinity`.
- **`view()` is where asymmetry lives.** Return only what that player is allowed to know. Anything
  you leave out of a view never reaches that player's browser. Walkie's listening player gets
  `{ role: 'listening' }` and nothing more.
- **Validate actions.** They arrive straight from the network. Check the shape and return
  `{ reject: 'reason' }` for anything invalid; the reason is shown to the player. If `apply`
  throws, the runtime treats it as a rejection.
- **Views only go out when state changes.** If something moves on its own (a toy, a sweep), either
  put its current position in state from `tick`, or send what the client needs to animate it
  (`lib/useRoundClock.ts`) and keep the view still.

### Win conditions

- `race`: the first team to solve wins; others get `raceGraceMs` to finish too, and the fastest
  solve wins. A race puzzle may also report `points` (progress, say): they only decide the round
  if nobody finishes. Airtime uses objectives done plus distance to the next one.
- `compare`: every team plays until solved or out of time. If `score()` reports `points`, the most
  points wins, solved or not (so report them at the buzzer too: Ghost Ink scores placements whether
  or not the team submitted). Ties go to the lower `elapsedMs`: the runtime records it when a team
  solves, and a team that never solves can report its own (Echo Claw's time of last grab).
  Without points, fewest `moves` wins, ties broken by time, and unsolved teams never win. A
  module's `elapsedMs` may include penalties.
- A score may also carry `tiebreak` (higher wins), which settles equal points before time and
  isn't shown: Scavenge uses grabs left.

The round intro says what wins from `winCondition`; for compare it assumes fewest moves. Set
`goal` whenever that's wrong ("Most grabs wins").

### Reveal

`reveal(state, playerId)` is optional. When the round ends, the engine sends each player one more
view from it, and the shell shows it under the scoreboard with your client component. Use it for
the answer next to what the team did: Ghost Ink's scene beside the rebuild, Split Hairs' word and
picture, Color Sweep's gradient with the target and the lock. It's only called after the round, so
it may show anything.

### Comms rules

| Rule                                                                   | Meaning                                        |
| ---------------------------------------------------------------------- | ---------------------------------------------- |
| `{ type: 'voice', scope: 'team' }`                                     | Voice chat with teammates only                 |
| `{ type: 'voice', scope: 'all' }`                                      | Everyone in the room can hear everyone         |
| `{ type: 'none' }`                                                     | No communication at all                        |
| `{ type: 'signals', signals: ['up', 'down'] }`                         | Only these discrete buttons, to teammates      |
| `{ type: 'clips', maxSeconds: 5, direction: 'one-way' }`               | Short recorded clips, routed by `onClip`       |
| `{ type: 'delayed-clips', maxSeconds: 5, delayMs: 5000 }`              | Clips that arrive a fixed time late            |
| `{ type: 'delayed-clips', maxSeconds: 5, delayRangeMs: [2000, 8000] }` | Each clip late by a seeded random amount       |
| `{ type: 'budget-clips', maxSeconds: 5, budgetSeconds: 30 }`           | Push-to-talk with a mic-time budget per player |
| `{ type: 'voice-alternating', swapIntervalMs: [15000, 40000] }`        | One-way voice; who's live swaps at random      |
| `{ type: 'voice-timed', scope: 'team', openSeconds: 10 }`              | Voice for the first N seconds, then silence    |
| `{ type: 'draw', fadeMs: 1000, from: 'role' }`                         | Fading ink; `from: 'any'` lets everyone draw   |
| `{ type: 'voice', scope: 'all', reportLevel: true }`                   | Voice, and clients report mic loudness         |
| `{ type: 'clips', maxSeconds: 5, direction: 'ring' }`                  | Clips go to the next seat round the team       |
| `{ type: 'clips', ..., transform: { kind: 'shuffle', sliceMs: 600 } }` | Receivers hear clips scrambled (or `reverse`)  |
| `{ type: 'budget-clips', maxSeconds: 2, budgetSends: 12 }`             | A number of sends, each hard-capped            |
| `{ type: 'budget-clips', ..., budgetScope: 'team' }`                   | One budget pooled for the team                 |
| `{ type: 'voice-oneway', scope: 'team' }`                              | Voice where `commsState` decides who may talk  |
| `{ type: 'voice-gated', scope: 'team', debounceMs: 300 }`              | Voice switched per player by `commsState`      |
| `{ type: 'voice-replay', scope: 'team', vad, bufferSeconds: 60 }`      | Voice, plus replays of what teammates said     |

The server enforces every rule. Nothing is honor-system: if the wire doesn't stop it, it isn't a
rule.

**Combining rules.** `comms` may be a list, applied together, with at most one of each kind (voice,
clips, signals, draw): Dictionary uses
`[{ type: 'signals', ... }, { type: 'voice-oneway', scope: 'team' }]`. The shared helpers
`findRule(comms, 'signals')`, `clipRule(comms)` and `voiceRule(comms)` pick them out.

**Signals.** The server drops anything not in the list and anything sent faster than `cooldownMs`
(default 750 ms), relays the rest to the sender's team, and calls your `onSignal` if you have one.
The shell renders buttons for allowed signals and a feed of incoming ones; your client also gets
them as `props.signals`. Two options for puzzles that need more:

- `props.signals.send(signal, to)` aims a signal at one player; only they (and the sender) get it,
  and `onSignal` receives `to`.
- `relay: false` means signals are never relayed at all, only passed to `onSignal`. Bad Advice uses
  both so its hints stay anonymous: the server is the only one who knows who sent what. The shell
  hides its signal bar for these; your client provides the targeting UI.
- `buttons: 'puzzle'` hides the shell's bar because your client draws its own controls (Telegraph's
  hold key, Dictionary's pad of unlocked sounds).
- `onSignal` runs before the relay, and may return `{ reject: 'reason' }`: the signal is then
  neither applied nor relayed. Dictionary refuses sounds that aren't unlocked yet; Telegraph refuses
  anyone but the Sender. Render only what's allowed, and refuse the rest on the server.

**Voice.** Peer-to-peer WebRTC; the server tells each browser exactly who to connect to and relays
signaling only between those players. You don't write any voice code. Under `voice-alternating`
the server flips each connection's send and hear flags on every swap, so the listener's browser
sends no audio at all. Under `voice-timed` the connections close when time's up.

**Shaping voice per player: `commsState`.** Return, for one player:

```ts
commsState(state, playerId, ctx) {
  return {
    send: false, // their mic transmits to nobody
    receive: true, // they can hear (the default)
    peers: { [ghostId]: { audible: true, gain: 0.4 } }, // per source: can they hear it, how loud
    replay: { id, from, windowStartMs, windowEndMs }, // voice-replay only; see below
  };
}
```

A link from A to B carries sound only if A may send, B may receive and B can hear A; the server
enforces that by telling both browsers. `gain` is a volume hint the receiving client applies through
Web Audio (audibility itself is the server's call). The engine calls `commsState` after every state
change and applies a change once it has held for `debounceMs` under `voice-gated` (immediately
otherwise), so expect a few hundred milliseconds before audio follows: design for seconds. If
something should flip on its own (a runner standing still), keep it in state from `tick` so the
change happens. Hot Mic gates on stillness, Dictionary mutes its Sender, Earshot gives every Hunter
a per-Ghost gain by distance. A player whose mic you've switched off gets `comms.micClosed`.

**Mic loudness.** With `reportLevel: true` each client measures its mic (100 ms windows) and sends a
`{ type: '__micLevel', db }` action about ten times a second (the server drops faster ones). The
shell shows a loudness meter. Actions starting with `__` come from the shell, never your UI: accept
them by returning the same state, and their rejections are never shown.

**Replays: `voice-replay`.** Voice is ordinary team voice, and each client also keeps a minute of
what each teammate said, cut into utterances by voice activity detection (`vad`) and stamped with
round time. To replay something, return `replay` from `commsState` with a new `id`: that client
plays the longest utterance from `from` that lies wholly inside the window, with no indicator, or
answers `{ type: '__replayMissed', id }` if there was none, so you can try another window. The
server never gets the audio. A modified client could skip replays, which only helps its own team
(accepted for friends-only rooms). `/dev/vad` tunes the detection with your own mic. YappinMaze is
the example.

**Clips.** The shell handles the mic, recording and upload. For `clips`, your client calls
`props.clips.record()` (and `stop()`); the server enforces the length and a 2 s cooldown, then calls
your `onClip`, which decides who hears the clip and with what parameters:

```ts
onClip(state, fromPlayerId) {
  if (fromPlayerId !== state.sender) return { reject: 'Only the Sender can transmit' };
  return { deliveries: [{ to: state.receiver, params: distortionFor(state) }] };
}
```

Because `onClip` runs on the server, the parameters can depend on secrets (Radio Tune's distortion
depends on how far the receiver's panel is from the answer). Recipients get the clip in
`props.clips.incoming` and apply them. If `repeat` is in the rule's `extraSignals`, sending it
re-delivers the latest clip to the asker with freshly computed params.

For `delayed-clips` and `budget-clips` the shell does everything: a hold-to-talk bar (or hold V),
clips in flight, budget bars, and clean playback on arrival. `onClip` is optional (default: every
teammate, clean). Delayed clips are held until `max(end of recording, start + delay)`; jittered
delays come from a seeded sequence per seat, so every team gets the same delays in the same order,
and clips are never reordered. Budget clips longer than what's left are cut to fit.

`direction: 'ring'` sends each clip to the next seat in team order (wrapping), so `onClip` is
optional, and every player's `comms.ring` says who they hear from and speak to. `transform`
scrambles clips on the receiver's client: the server adds the transform and a seed to each
delivery's params, and `playClip(delivery)` from `lib/audio.ts` applies it (and `playMs`) with
`transformPcm` from the shared audio module (same trust model as Radio Tune's distortion). With
`budgetSends`, `maxSeconds` is a hard cap: longer clips are cut off at playback and still cost a
whole send; `comms.sends` has what's left, and `budgetScope: 'team'` pools it. `<RecordButton>` in
`lib/` is the hold-to-record button with a ring that runs down to the cap, if you draw your own.

**Draw.** Strokes travel on their own channel, never through `apply()` or your state: batched pen
samples, rate-limited by the server, relayed to teammates, faded on arrival. Use the shared
`<FadingCanvas>` from `lib/FadingCanvas.tsx`, passing it `props.draw`; its `overlay` renders under
the ink. With `from: 'role'`, only players whose view has `canDraw: true` may draw, and the server
drops ink from anyone else.

### Engine-managed comms state

`ctx.comms` (and `props.comms` on the client) tells you what the engine is doing with the channel:

| Field               | When                                                        |
| ------------------- | ----------------------------------------------------------- |
| `activePlayerId`    | `voice-alternating`: who is live right now                  |
| `swapInMs`          | `voice-alternating` with `warningMs`: time until the swap   |
| `voiceRemainingMs`  | `voice-timed`: time before voice closes                     |
| `budgets`           | `budget-clips`: each player's mic time left                 |
| `pendingDeliveries` | clip rules: the sender's clips not yet delivered            |
| `ring`              | ring clips: `{ next, prev }` for this player                |
| `sends`             | `budget-clips` with `budgetSends`: `{ left, total, scope }` |
| `micClosed`         | your `commsState` has switched this player's mic off        |

When it changes, the runtime recomputes every view, so a view can depend on it (Walkie shows the
live player their room and blacks out the other).

## Arena puzzles (shared instance)

Set `instance: 'shared'` and the whole room plays one instance instead of one per team:

- `init` gets every player and `teams`, a list of `{ id, name, playerIds }`.
- `apply`, `view`, `tick` and `onSignal` work as before; views are still per player. The client's
  `props.team` is only your own team, so put names and team ids for everyone in the view.
- `isSolved` means "the round is over". There is no grace window.
- `score()` reports every team: `{ teams: { [teamId]: { solved?, elapsedMs?, points?, tiebreak? } } }`,
  ranked by the win condition as above. The shell shows these live as the round goes, so only mark
  a team `solved` once it really is done.
- `commsState` works the same, for every player in the room (Earshot's hearing crosses teams).
- For per-team roles, either derive them from seat and `roundIndex` so they rotate, or deal them
  with `rng.fork('roles').shuffle(players)` (Radio Tune, Melody Sort, Color Mix, Recipe Cipher). A
  fork keeps the rest of the puzzle's randomness unchanged.
- A puzzle that needs three or more teams sets `teams.min = 3`; the lobby lists it with the reason
  when a room doesn't fit ("needs 3+ teams"). Rooms allow up to four teams.

Pick Six, Bad Advice, Going Once, Card Talk, Earshot and Scavenge are the examples. Team colours are
available to CSS as `var(--team-<id>)` (red, blue, green, gold).

## The client component

```tsx
export default function MyPuzzle({
  view,
  send,
  signals,
  clips,
  draw,
  comms,
  timer,
  me,
  team,
}: PuzzleClientProps<View, Action>) {
  // Render `view`, call `send(action)`. No network code, no knowledge of other teams.
}
```

`timer.remainingMs` counts down the round and freezes while the match is paused. If your puzzle
has its own turn clock, put the turn's end (in round time) in the view and compute the rest from
`timer.totalMs - timer.remainingMs`, as Pick Six does. For smooth animation, `useRoundClock(timer)`
from `lib/useRoundClock.ts` gives you round time inside `requestAnimationFrame`.

`props.assets` holds the files your `assets()` sent this player (see Content packs), and
`props.micLevel` their own loudness under `reportLevel`.

Shared pieces in `packages/puzzles/lib/`:

- `<FadingCanvas>` for the draw stream, `<Blackout>` for players who can't see anything right now,
  and `useRoundClock`.
- `audio.ts`: one Web Audio context the shell unlocks on every tap (phones only start sound inside
  a gesture). Play every sound through `audioContext()`, `playClip()` or `playPcm()`; decode assets
  with `useAssetBuffer()`.
- `<RecordButton>` (hold to record, with the cutoff ring) and `useHoldRepeat()` (arrow pads that
  repeat while held, like a held key).
- `glyphs.ts` / `<GlyphSvg>` (Recipe Cipher and Pass It On's procedural glyphs), `composite.ts` /
  `<CompositeSvg>` (look-alike pictures from shape, color, pattern and motif: Overdraft, Card Talk,
  Scavenge), and `maze.ts` (perfect mazes, braiding, path distances: YappinMaze, Earshot).

## Content packs

Puzzles that need writing rather than code can keep it in files. Split Hairs keeps its word clusters
in `content/clusters.json` and one SVG per word in `content/pictures/`, so contributors add clusters
without touching code. The server module reads them with `node:fs` (import that only from server
code, never from `client.tsx`) and sends each picture's sanitized markup in the view, so neither the
files nor their names (which spell the answers) ever reach a browser. A validator runs over the
whole pack in the tests.

Binary content goes through `assets()` rather than the view (views go out on every change).
Patchwork keeps sentences in `content/sentences.json` with a pre-rendered 16-bit WAV per sentence
(`pnpm gen:patchwork` renders them with whatever text-to-speech is installed). Its `assets()` gives
each player one file, `half-0` or `half-1`, built on the server from the WAV with `splitClip` and
`maskedClip` from the shared audio module, so the full clip never reaches a browser. Asset ids must
be stable (each is sent to a player once per round, and again on reconnect) and must not give
anything away; return a function for data that's costly to build and it's only built when needed.

## Testing with the harness

The harness drives your module exactly like the server does and checks the rules above after every
step: deterministic `init`, no mutation, JSON-only state and views, and no leaks of hidden
information.

```ts
import { runPuzzleScript, startPuzzle, type HiddenInfo } from '../harness';
import puzzle from './server';

// Mark what each player must not know. The harness changes it and checks that those players'
// views come out identical, after every step.
const hidden: HiddenInfo<State>[] = [
  {
    name: 'the secret number',
    hiddenFrom: (player) => player.seat !== 0,
    change: (state) => ({ ...state, secret: (state.secret % 20) + 1 }),
    // Optional: from here on it may be shown (after the team submits, say).
    until: (state) => state.solved,
  },
];

// A scripted solve. Steps can be a list, or a function of the initial state.
runPuzzleScript(puzzle, {
  players: 2,
  seed: 'fixed-seed',
  hidden,
  steps: (state) => [
    { seat: 1, action: { type: 'guess', value: state.secret } },
    { advance: 1000 }, // simulated time; tick() runs every 100ms
  ],
  expectSolved: true,
  expectScore: { moves: 1 },
});

// Or drive it by hand.
const game = startPuzzle(puzzle, { players: 3, hidden, roundIndex: 0 });
game.act(2, { type: 'guess', value: 99 }); // returns { ok: false, reason: '...' }
game.view(0);
game.state;
game.reveal(0); // the end-of-round view, if the module has reveal()
```

More on the driver:

- **Arena puzzles** take `teams: [2, 2]` instead of `players`; players are numbered team by team
  (`t1-p1`, `t1-p2`, `t2-p1`, ...), teams are `team-1`, `team-2`.
- **Signals:** `game.signal(seat, 'up')`, or `game.signal(seat, 'up', toSeat)` for a targeted one;
  it returns `{ ok: false, reason }` when `onSignal` refuses it. In scripts:
  `{ seat: 0, signal: 'POW', expect: 'reject' }`.
- **commsState:** `game.commsGate(seat)`, or a script step `{ seat: 0, expectComms: { send: false } }`
  (absent send/receive count as open).
- **Assets:** `game.assets(seat)` returns every file the puzzle would send that seat.
- **Clips:** `game.clip(seat)` returns what `onClip` routes (or null without one).
- **Comms state:** start with `comms: { activePlayerId: 'player-1' }` and change it with
  `game.setComms(...)`; views are re-checked each time.

## Design tips

- **Twist the channel, not the mechanic.** Take something simple and make the way people have to
  talk about it weird, funny, or constrained.
- Don't lean on "one sees this, the other sees that" for every puzzle. Constrain the channel
  (signals only, no talking, distorted clips, late or rationed voice) or split control instead of
  information.
- Make feedback readable. When players can't talk, the outcome itself has to show what each
  player was trying to do. (Swap Stack, whose only message was whether the Sorter swapped, was cut
  after playtesting.)
- **Enforce it mechanically.** Word counts, "questions only" and other behavioural rules need
  someone to police them. Build the constraint into the wire instead.
