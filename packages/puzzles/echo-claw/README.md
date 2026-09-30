# Echo Claw

A claw machine, seen from above. A toy drifts around inside, bouncing off the glass. The Spotter
can see the toy; the Operator can only see the claw, and drives it. Both see a 6x6 grid of
labelled squares (A-F across, 1-6 down, each about one grab ring wide), so the Spotter can call
"C4, heading right" and the Operator can chase it.

- **Comms:** `{ type: 'voice', scope: 'team' }`. It used to be clips arriving five seconds late,
  which playtesting found far too hard.
- **Win:** `compare` on `points`, the number of grabs when the round ends; ties go to whoever
  made their last grab first (reported as `elapsedMs`). Nobody finishes early.
- **Toy motion:** constant speed, reflected off the walls with a seeded nudge of up to ±15° per
  bounce (never flatter than 20° to a wall). Bounces are computed at their exact times, not at
  tick times, so every team's toy follows the same path. Each grab respawns the toy at the next
  seeded spot.
- **Claw:** the Operator holds a direction (arrow keys, WASD, or the on-screen pad); the server
  moves the claw each tick. A drop closes after 1.5s and grabs if the toy's centre is within the
  ring drawn around the claw; the claw is busy for 2s in all.
- **Roles:** swap on alternate rounds.

Knobs in `physics.ts`: `TOY_SPEED`, `CLAW_SPEED`, `GRAB_RADIUS`, `DROP_MS`, `BUSY_MS`.
