# Color Sweep

A big swatch sweeps through a gradient and back, five times. The Locker has one press to stop it
on a colour they can't see. The Spotter sees the target and the live sweep, but every message
they send is delayed by a different random amount, so "now" might arrive in two seconds or eight,
and "a bit more orange" might arrive after "now".

- **Comms:** `{ type: 'delayed-clips', maxSeconds: 5, delayRangeMs: [2000, 8000] }`, both ways.
  Each player's delays are a seeded sequence, so every team gets the same delays in the same
  order. Clips are never reordered on the way: out-of-order arrival is the point.
- **Gradient:** five seeded colour stops, each a big hue step from the last; the target is a
  seeded point 10-90% of the way along. The sweep runs 6s each way (12s a sweep, 60s a round),
  the same for every team.
- **Win:** `compare` on `points` = 100 × (1 − distance along the gradient). Ties go to the earlier
  lock. No lock by the end of the fifth sweep scores 0, which never wins.
- **Timing:** the lock is scored at the server's round time when it arrives. The client animates
  the swatch from a smoothed copy of the round clock (`lib/useRoundClock.ts`).
- **Roles:** swap on alternate rounds.
- **Reveal:** under the scoreboard, the whole gradient with the target and the lock marked.

Knobs: `SWEEP_MS` and `SWEEPS` in `gradient.ts`; the delay range in `manifest.ts`.
