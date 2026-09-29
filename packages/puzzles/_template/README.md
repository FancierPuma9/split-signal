# Guess the Number (template)

Copy this folder to start a new puzzle. See [docs/PUZZLE_AUTHORING.md](../../../docs/PUZZLE_AUTHORING.md).

One player (seat 0) sees a number from 1 to 20. Everyone else guesses it. Fewest guesses wins.

| File               | What goes in it                                                    |
| ------------------ | ------------------------------------------------------------------ |
| `manifest.ts`      | Name, description, team sizes, win condition, time limit, comms    |
| `types.ts`         | `State`, `View`, and `Action` types shared by server and client    |
| `server.ts`        | The rules: `init`, `view`, `apply`, `isSolved`, `score`            |
| `client.tsx`       | A React component that renders the view and calls `send`           |
| `template.test.ts` | Harness tests: a scripted solve, rejections, and hidden-info leaks |
