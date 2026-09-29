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
simultaneous move resolution is a good example, tested case by case.

## The server module

```ts
interface PuzzleServerModule<State, View, Action> {
  manifest: PuzzleManifest;
  init(ctx): State; // build the starting state
  view(state, playerId, ctx): View; // what THIS player may see
  apply(state, playerId, action, ctx): { state } | { reject: string };
  tick?(state, nowMs, ctx): State; // every 100ms, for turn timers
  onSignal?(state, fromPlayerId, signal, ctx): State; // signals that change state
  onClip?(state, fromPlayerId, ctx): ClipRouting; // required for clips puzzles
  isSolved(state): boolean;
  score(state): { moves?: number; elapsedMs?: number };
}
```

Modules never send messages or keep timers. The runtime calls `view()` for every player after each
change and sends each player only their own view, only when it changed. On reconnect it simply
re-sends the view, so you never write reconnect logic.

### Rules

- **Randomness comes from `ctx.rng`.** Never `Math.random()` or `Date.now()` (lint enforces this).
  Every team calls `init` with the same seed, so every team gets an identical puzzle.
- **State is immutable.** Return a new object when something changes and the same object when
  nothing does. The harness deep-freezes state, so mutation throws in tests.
- **State and views are plain JSON.** No `Map`, `Set`, `Date`, or class instances.
- **`view()` is where asymmetry lives.** Return only what that player is allowed to know. Anything
  you leave out of a view never reaches that player's browser.
- **Validate actions.** They arrive straight from the network. Check the shape and return
  `{ reject: 'reason' }` for anything invalid; the reason is shown to the player. If `apply`
  throws, the runtime treats it as a rejection.

### Win conditions

- `race`: the first team to solve wins the round, and the round ends for everyone.
- `compare`: every team plays until solved or out of time; fewest moves wins, ties broken by time.
  Use `tick` to enforce turn timers so teams keep moving.

### Comms rules

| Rule                                                     | Meaning                                   |
| -------------------------------------------------------- | ----------------------------------------- |
| `{ type: 'voice', scope: 'team' }`                       | Voice chat with teammates only            |
| `{ type: 'voice', scope: 'all' }`                        | Everyone in the room can hear everyone    |
| `{ type: 'none' }`                                       | No communication at all                   |
| `{ type: 'signals', signals: ['up', 'down'] }`           | Only these discrete buttons, to teammates |
| `{ type: 'clips', maxSeconds: 5, direction: 'one-way' }` | Short recorded voice clips                |

The server enforces the rule. For signals, it drops anything not in the list and anything sent
faster than `cooldownMs` (default 750 ms), relays the rest to the sender's team, and calls your
`onSignal` if you have one. The shell already renders buttons for allowed signals and a feed of
incoming ones; your client also gets them as `props.signals` if it wants to show them in context.

Voice is peer-to-peer WebRTC; the server tells each browser exactly who to connect to (teammates,
everyone, or nobody) and relays signaling only between those players. You don't write any voice
code.

For clips, your client calls `props.clips.record()` (and `stop()`), and the shell handles the mic,
recording and upload. The server enforces the length limit and a 3 s cooldown, then calls your
`onClip`, which decides who hears the clip and with what parameters:

```ts
onClip(state, fromPlayerId) {
  if (fromPlayerId !== state.sender) return { reject: 'Only the Sender can transmit' };
  return { deliveries: [{ to: state.receiver, params: distortionFor(state) }] };
}
```

Because `onClip` runs on the server, the parameters can depend on secrets (Radio Tune's distortion
depends on how far the receiver's panel is from the answer) without the secret reaching anyone.
Recipients get the clip in `props.clips.incoming` (base64 audio plus your params) and apply them.
If `repeat` is in the rule's `extraSignals`, sending it re-delivers the latest clip to the asker
with freshly computed params.

## The client component

```tsx
export default function MyPuzzle({
  view,
  send,
  signals,
  timer,
  me,
  team,
}: PuzzleClientProps<View, Action>) {
  // Render `view`, call `send(action)`. No network code, no knowledge of other teams.
}
```

`timer.remainingMs` counts down the round and freezes while the match is paused. If your puzzle
has its own turn clock, put the turn's start (in round time) in the view and compute the rest from
`timer.totalMs - timer.remainingMs`, as Sliding Grid does.

## Testing with the harness

The harness drives your module exactly like the server does and checks the rules above after every
step: deterministic `init`, no mutation, JSON-only state and views, and no leaks of hidden
information.

```ts
import { runPuzzleScript, startPuzzle, type HiddenInfo } from '../harness';
import puzzle from './server';

// Mark what each player must not know. The harness changes it and checks that those players'
// views come out identical.
const hidden: HiddenInfo<State>[] = [
  {
    name: 'the secret number',
    hiddenFrom: (player) => player.seat !== 0,
    change: (state) => ({ ...state, secret: (state.secret % 20) + 1 }),
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
const game = startPuzzle(puzzle, { players: 3, hidden });
game.act(2, { type: 'guess', value: 99 }); // returns { ok: false, reason: '...' }
game.view(0);
game.state;
```

## Design tips

- **Twist the channel, not the mechanic.** Take something simple and make the way people have to
  talk about it weird, funny, or constrained.
- Don't lean on "one sees this, the other sees that" for every puzzle. Constrain the channel
  (signals only, no talking, distorted clips) or split control instead of information.
- Make feedback readable. When players can't talk, the outcome itself has to show what each
  player was trying to do.
