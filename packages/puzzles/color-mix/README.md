# Color Mix

One player, dealt at random each round, sees only the target color. Everyone else sees only the current mix. Each player
has their own sliders, and the mix is all of them combined, so nobody can solve it alone.

- **Sliders:** red, green and blue are dealt out at random, each to exactly one player (0-255).
  **2 players:** one gets one color, the other gets two. **3 players:** one color each. Everyone
  is told which colors their teammates have.
- **Win:** race. The match is detected automatically: the mix has to stay within a CIEDE2000
  distance of 5 from the target for 1.5 seconds (no spammable "submit").
- **Comms:** voice, team only.
- **Generation:** every channel has an owner with the full range, so any target is solvable; it
  starts at least 25 ΔE away from the starting mix (every slider at the middle).
- **Tuning note:** the tolerance is perceptual, so big RGB differences can still count as a match
  where the eye can't tell them apart (e.g. a little more or less red in a vivid blue). Tune
  `TOLERANCE` and `HOLD_MS` in `server.ts` after playtesting.
