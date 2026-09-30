# Split Signal

Browser party game; the spec is [docs/PLAN.md](docs/PLAN.md). Every phase (0-8) is built, plus
puzzle batch 2 ([docs/PUZZLES_BATCH2.md](docs/PUZZLES_BATCH2.md): new comms rules, arena mode, ten
more puzzles) and batch 3 ([docs/PUZZLES_BATCH3.md](docs/PUZZLES_BATCH3.md): rule composition,
commsState, signal rejection, ring/scrambled/budgeted clips, mic level, voice replay, ten more
puzzles). MIT licensed; self-hosted with Docker + Caddy ([docs/DEPLOY.md](docs/DEPLOY.md)). The
plans call for playtests (after phases 3 and 5, batch 2's B2, B5, B8, batch 3's C2, C5, C8) that
haven't happened yet. [docs/PUZZLE_AUTHORING.md](docs/PUZZLE_AUTHORING.md) documents the contract.

Accounts (phase 7) are optional and off unless `SPLIT_SIGNAL_GOOGLE_CLIENT_ID` is set: the server
verifies Google ID tokens itself (server/src/auth/google.ts), keeps sessions and stats in SQLite via
`node:sqlite` (server/src/stats/), and never requires sign-in to play.

Clips: `onClip` (optional contract hook) routes each clip and computes per-recipient params on the
server; the engine enforces length/cooldown and handles the 'repeat' signal. Delayed, jittered and
budgeted clips, alternating and timed voice, and the draw stream live in
server/src/comms/controller.ts (one `CommsController` per round); puzzles read its state from
`ctx.comms`.

Lineups: `LobbySettings.playlist` (puzzle ids, in order, repeats allowed; null = random draw of
`rounds`). `RoomView.puzzles` is the catalog marked with fits/reason for the picker, and
`startBlockers` checks every playlist entry fits. `match.playAgain` with a `puzzleId` starts a
one-off match of that puzzle without touching the playlist.

Arena puzzles (`instance: 'shared'`) run one runtime for the whole room; `score().teams` ranks them.
`reveal()` views are sent after a round and shown under the scoreboard.

Voice topology (server/src/comms/voice.ts): everyone in lobby/results, own team between rounds, the
puzzle's rule while playing, narrowed per player by the puzzle's `commsState()` (the engine
debounces it into `voiceState().gates`, and sends `comms.replay` requests). The server relays
`comms.rtc` only between current peers. `manifest.comms` may be a list of rules: use
`findRule`/`clipRule`/`voiceRule`, never `comms.type`.

`assets()` sends per-player binary files once per id (`match.asset`); Patchwork builds its masked
audio halves there. Shared audio primitives (transformPcm, splitClip, maskedClip, WAV/base64) are
in shared/src/audio. Shell actions start with `__` (`__micLevel`, `__replayMissed`).

## Commands

- `pnpm dev` / `pnpm dev --puzzle <id>`: server on :3001 plus Vite on :5173 (proxies `/ws`)
- `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`
- Run all five before calling work done; CI runs the same.
- `pnpm gen:patchwork [--voice <name>] [--force]`: render Patchwork's sentences to WAV (Windows
  SAPI, say, piper or espeak-ng). `/dev/vad` in the client tunes voice-replay detection.

## Architecture rules (from the plan; don't drift without a reason)

- Server-authoritative. Clients render a per-player view and send actions; the server enforces comms
  rules. Never let the client decide who it can talk to.
- Puzzle modules (`packages/puzzles/<id>/`) are pure: `init/view/apply/tick/onSignal/onClip/reveal/isSolved/score`.
  No I/O (except reading the puzzle's own content files, server-side only, as Split Hairs does), no
  timers, no `Math.random`/`Date.now` (lint-enforced; use `ctx.rng`). State is immutable plain
  JSON. Adding a puzzle must never require touching lobby, networking, or engine.
- `PuzzleSession` in `packages/shared/src/session.ts` is the single core used by both the server
  runtime and the test harness. Change semantics there, not in two places.
- Room state goes behind `RoomStore` (`get/set/delete/list`); never read the room map directly.
  Rooms are plain data; live objects (match engines, sockets) live in `GameServer`.
- `GameServer` (server/src/game-server.ts) routes messages; lobby rules are pure functions in
  `rooms/lobby.ts`; `MatchEngine` runs rounds on a pausable clock.
- Match catalog is `puzzles` in packages/puzzles/index.ts; `devPuzzles` are only reachable via
  `--puzzle`.
- Imports are extensionless (bundler resolution). Workspace packages export TypeScript source.

## Gotchas

- Windows: child processes in `scripts/dev.mjs` must not share stdin (tsx watch blocks Vite), and
  must be tree-killed with `taskkill /T`.
- Windows + Vite: several writes to the same file within milliseconds can leave Vite serving a stale
  transform (and new puzzle folders may not show up in `import.meta.glob`). `touch` the file to fix.
- Seat tokens: saved per room as a list in localStorage; sessionStorage marks which seat a tab holds.
  Only that tab auto-rejoins, so one-tab-per-player testing works.
- TypeScript is pinned to 6.0.x because typescript-eslint doesn't support 7.x yet.
- Phones: play every sound through `packages/puzzles/lib/audio.ts` (one shared AudioContext that
  taps unlock; iOS won't start audio outside a gesture, and most game sound is server-triggered).
  Held arrow pads use `lib/useHoldRepeat.ts`. Phone layout lives in `@media (width < 600px)` blocks;
  check puzzles at 375px wide.
