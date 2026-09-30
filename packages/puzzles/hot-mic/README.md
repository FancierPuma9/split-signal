# Hot Mic

Both players run their own lane of an obstacle course. You can't see your own hazards; you can see
your partner's. Your mic transmits only while you're standing still, and you can only hear while
you're standing still, so a message lands only when you've both stopped. There's no sign of whether
your partner has stopped; the only acknowledgement is them talking back, which costs them the same.
Hitting a hazard costs five seconds.

- **Comms:** `{ type: 'voice-gated', scope: 'team', debounceMs: 300 }`. `commsState` returns
  `send: false, receive: false` for a moving runner. A runner is moving while 'run' inputs keep
  coming (the client sends one every 100 ms while Run is held); 300 ms without one, or 'stop', and
  they've stopped. The engine applies a change once it has held for the debounce, so expect a few
  hundred milliseconds between stopping and the audio opening; the course is paced in seconds.
- **Lanes:** 60 tiles, 14-18 hazards at least two tiles apart, different for each player and the
  same pair for every team. Hurdle: jump. Beam: duck. Pit on the left: step right. Pit on the
  right: step left.
- **Moves:** a hazard is cleared if the right move was made within 0.7 s before reaching it; moves
  can't be repeated faster than every 0.6 s, so spamming all four doesn't work. Otherwise: a 5 s
  stun, then on past it.
- **What you see:** your lane without hazards; the watched lane with its runner and the hazards
  just ahead of them (the next three, or eight tiles, whichever is less), so a team can't brief the
  whole lane while standing at the start.
- **Three players:** a ring: each watches the next player's lane.
- **Win:** `race`; done when everyone is over the line. Time includes stuns.
- **Still to measure:** the real open/close latency of gated voice with people on real networks,
  and whether 300 ms is the right debounce.
