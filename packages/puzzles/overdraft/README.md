# Overdraft

Three players, each with a board of eight look-alike pictures. Each must pick the right ones, but
which ones are right is known only by their teammates: the answers for A's board are split between
B and C, and so on round. Every clip goes to both teammates at once, the team has twelve for the
whole round, and each is cut off at two seconds, about five words, so you can't address someone
and instruct them in the same breath. Nobody knows how many answers they need, so a listener can
never assume a clip was for them.

- **Comms:** `{ type: 'budget-clips', maxSeconds: 2, budgetSends: 12, budgetScope: 'team' }`.
  Clips go to every teammate (the default routing); longer clips are cut off at playback and still
  cost a send. Received clips can be replayed for free.
- **Deal:** 5-7 answers spread unevenly over the three boards (a board may have none, at most four),
  each known to exactly one of its owner's teammates, shown to them as a picture and whose board
  it's on. Boards are tight clusters from the composite picture generator (`lib/composite.ts`):
  one shape, two or three colors, patterns and motifs.
- **Submit:** each player locks their own picks. The round ends when all three have submitted or
  time runs out (anyone who hasn't counts with what they'd picked).
- **Scoring:** `correct - missed - surplus`, where `missed = quota - correct` and `surplus` is picks
  past the quota. A blank costs as much as a wrong pick, so caution is never safe.
- **Win:** `compare` on points, ties to the earlier final submit.
- **Reveal:** all three boards with the answers and every pick.
