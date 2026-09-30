# Color Mix

One player, dealt at random each round, sees only the target color. Everyone else sees only the current mix. Each player
has their own sliders, and the mix is all of them combined, so nobody can solve it alone.

- **2 players:** each has red, green and blue sliders from 0 to 127; each channel of the mix is the
  sum. **3 players:** one channel each (0-255), also dealt at random.
- **Win:** race. The match is detected automatically: the mix has to stay within a CIEDE2000
  distance of 5 from the target for 1.5 seconds (no spammable "submit").
- **Comms:** voice, team only.
- **Generation:** the target is a sum of slider settings the players could reach, so it is always
  solvable, and it starts at least 25 ΔE away from the starting mix.
- **Tuning note:** the tolerance is perceptual, so big RGB differences can still count as a match
  where the eye can't tell them apart (e.g. a little more or less red in a vivid blue). Tune
  `TOLERANCE` and `HOLD_MS` in `server.ts` after playtesting.
