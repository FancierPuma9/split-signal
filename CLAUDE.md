# Split Signal

Browser party game; the spec is [docs/PLAN.md](docs/PLAN.md). Work through it phase by phase and keep
each phase runnable. Phases 0-6 are done (scaffolding, rooms/lobby, match engine, signals + Sliding
Grid, WebRTC voice + Padlock + Color Mix, Melody Sort + Split Keyboard + Elevators, Recipe Cipher +
clips + Radio Tune). Phase 7 (Google sign-in, stats) needs OAuth credentials from the owner; phase 8
(release) needs a license and hosting decision. The plan calls for playtests after phases 3 and 5.

Clips: `onClip` (optional contract hook) routes each clip and computes per-recipient params on the
server; the engine enforces length/cooldown and handles the 'repeat' signal.

Voice topology (server/src/comms/voice.ts): everyone in lobby/results, own team between rounds, the
puzzle's rule while playing. The server relays `comms.rtc` only between current peers.

## Commands

- `pnpm dev` / `pnpm dev --puzzle <id>`: server on :3001 plus Vite on :5173 (proxies `/ws`)
- `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm build`
- Run all five before calling work done; CI runs the same.

## Architecture rules (from the plan; don't drift without a reason)

- Server-authoritative. Clients render a per-player view and send actions; the server enforces comms
  rules. Never let the client decide who it can talk to.
- Puzzle modules (`packages/puzzles/<id>/`) are pure: `init/view/apply/tick/onSignal/isSolved/score`.
  No I/O, no timers, no `Math.random`/`Date.now` (lint-enforced; use `ctx.rng`). State is
  immutable plain JSON. Adding a puzzle must never require touching lobby, networking, or engine.
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
