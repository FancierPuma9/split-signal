# Split Signal

An open-source, browser-based party game. Teams of two or more solve communication-based puzzles
cooperatively while racing other teams in the same room. Every puzzle is mechanically simple; the
twist is always in how players are allowed to communicate.

Inspired by _We Were Here_ (asymmetric information) and _Jackbox_ (room codes, play with friends).

> **Status:** early, but complete: every phase of [the build plan](docs/PLAN.md) plus two more
> batches of puzzles ([batch 2](docs/PUZZLES_BATCH2.md), [batch 3](docs/PUZZLES_BATCH3.md)). Rooms,
> the lobby, the full match loop (rounds, scoring, pause and rejoin, surrender), optional Google
> sign-in with stats, and every comms channel work: voice (per team, whole room, one way,
> alternating, timed, gated by what you're doing, shaped by distance, replayed), signals, recorded
> clips (late, jittered, rationed, passed round a ring, scrambled), and fading ink. Twenty-eight
> puzzles:
>
> - **Batch 1:** Sliding Grid, Padlock, Color Mix, Melody Sort, Split Keyboard, Elevators, Recipe
>   Cipher, Radio Tune.
> - **Batch 2:** Ghost Ink, Split Hairs, Echo Claw, Color Sweep, Airtime, Walkie, and
>   three arena puzzles where the whole room shares one game: Pick Six, Bad Advice and Going Once.
> - **Batch 3:** Patchwork, Pass It On (and Reverse Charges), Telegraph, Dictionary, Overdraft,
>   YappinMaze, Hot Mic, and the arena puzzles Card Talk, Earshot and Scavenge (three or more teams).
>
> Each puzzle's folder has a README with its rules. It still needs playtesting with real groups:
> expect the tuning to change.

Voice is WebRTC between browsers; the server only relays signaling and decides who can hear whom.
Players on different networks may need a TURN server: set `SPLIT_SIGNAL_ICE_SERVERS` to a JSON array
of ICE servers (the default is a public STUN server only).

## Getting started

Requires Node 24+ and pnpm.

```sh
pnpm install
pnpm dev
```

Open http://localhost:5173, create a room, and share the code (or invite link). Everyone joins,
sits on a team, the host locks teams and starts. Rounds are drawn at random from the puzzles that
fit the teams, unless the host picks a lineup in the lobby (in order, repeats allowed); after a
match the host can replay any single puzzle from it. To try it alone, open one browser tab per
player.

To make every round use one puzzle while developing it:

```sh
pnpm dev --puzzle sliding-grid
```

Patchwork's spoken sentences are pre-rendered WAVs in its `content/` folder. After adding sentences,
render them with whatever text-to-speech is installed (Windows voices, macOS `say`, `piper` or
`espeak-ng`):

```sh
pnpm gen:patchwork
```

`/dev/vad` is a tool page for tuning YappinMaze's speech detection with your own mic.

## Accounts and stats (optional)

Everyone can play as a guest; nothing about playing needs an account. Google sign-in adds stats:
matches played and won, rounds won, and personal bests per puzzle. Guests who finish a match can
sign in within 30 minutes to keep its results. It's off unless configured:

| Variable                        | What it does                                                           |
| ------------------------------- | ---------------------------------------------------------------------- |
| `SPLIT_SIGNAL_GOOGLE_CLIENT_ID` | A Google OAuth client ID (Web application). Turns sign-in on           |
| `SPLIT_SIGNAL_DB`               | Where the SQLite stats database lives (default `data/split-signal.db`) |

In the Google Cloud console, add your site's origin to the client's authorized JavaScript origins
(for development, `http://localhost` and `http://localhost:5173`). The server verifies Google's ID
tokens itself and stores only the Google account ID, the player's name, and match results.

## Scripts

| Command          | What it does                           |
| ---------------- | -------------------------------------- |
| `pnpm dev`       | Game server (:3001) and client (:5173) |
| `pnpm test`      | All tests (Vitest)                     |
| `pnpm typecheck` | TypeScript across every package        |
| `pnpm lint`      | ESLint                                 |
| `pnpm format`    | Prettier                               |
| `pnpm build`     | Production client bundle               |

## Layout

```
packages/
  shared/    protocol, puzzle contract, comms rules, seeded RNG, puzzle session core
  server/    HTTP + WebSocket server, rooms and lobby, match engine, puzzle runtime
  client/    React shell (home, lobby, match), lazy-loading puzzle host
  puzzles/   the puzzle catalog, the test harness, and one folder per puzzle
deploy/      Caddy and TURN config for self-hosting
docs/        build plan, puzzle authoring guide, deployment guide
```

## Hosting it yourself

`docker compose up -d` runs the game behind Caddy with automatic HTTPS (browsers only allow the
microphone on secure pages). [docs/DEPLOY.md](docs/DEPLOY.md) walks through a server from scratch,
on AWS EC2 or anywhere else with Docker.

## Writing a puzzle

Copy `packages/puzzles/_template` and follow [docs/PUZZLE_AUTHORING.md](docs/PUZZLE_AUTHORING.md).
[CONTRIBUTING.md](CONTRIBUTING.md) covers setup and pull requests.

## License

[MIT](LICENSE).
