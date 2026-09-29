# Contributing to Split Signal

Thanks for helping. The most useful thing you can add is a puzzle: every puzzle is its own folder,
and adding one never touches the lobby, networking or match engine.

## Setting up

Requires Node 24+ and pnpm (the version is pinned in `package.json`; `corepack enable` picks it up).

```sh
pnpm install
pnpm dev
```

Open http://localhost:5173 in one browser tab per player. `pnpm dev --puzzle <id>` makes every
round use one puzzle while you work on it.

## Adding a puzzle

Copy `packages/puzzles/_template` and follow [docs/PUZZLE_AUTHORING.md](docs/PUZZLE_AUTHORING.md).
It covers the puzzle contract, comms rules, arena puzzles, the test harness and design tips. The
short version of the rules:

- The server is authoritative. Views contain only what each player may know; the harness checks
  that hidden information doesn't leak, after every step.
- All randomness comes from the seeded `ctx.rng`, so every team gets the same puzzle.
- Every constraint is enforced mechanically. If the server can't stop it, it isn't a rule.
- Give your puzzle a `README.md` with its rules, and harness tests.

## Before you open a pull request

Run all five checks; CI runs the same:

```sh
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test
pnpm build
```

Keep changes focused: one puzzle or one fix per pull request is easiest to review. For anything
that changes the engine, the protocol or the puzzle contract, open an issue first so we can talk it
through.

## Reporting bugs

Open an issue with what you did, what you expected, and what happened, plus your browser and OS.
Voice problems are often network-specific: say whether players were on the same network.

## Code of conduct

Be kind and constructive. This is a party game; keep the project a friendly place to work on it.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
