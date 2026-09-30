# Card Talk

One board of picture cards, every team in one voice room, everyone talking at once. Each team's
Caller sees a key: which cards are their team's, which are contested (on every team's list) and
which are traps. Each team's Grabber sees the unmarked board and clicks. All claims are public, so
you're describing your cards in front of the competition, who may take a contested card off your
description, or be baited into grabbing one of yours.

- **Instance:** shared (arena). Board: 8 cards per team + 5 contested + 4 traps (25 with two
  teams), from the composite generator's `similarLooks`, so most cards share two attributes with
  several others and "the striped one" is never enough.
- **Roles:** Caller (key, can't click) and Grabber (board, clicks), swapping each round.
- **Comms:** `{ type: 'voice', scope: 'all' }`.
- **Grabs:** one per second per Grabber, enforced on the server. Own card +5, contested +10 (first
  claim wins), trap -3, another team's card -3 to you and +5 to its owner.
- **End:** when every contested card and every team's cards are claimed (traps aside), or at 2 min.
- **Win:** `compare` on points, ties to whoever scored last first.
- **What each side knows:** only Callers' views carry the key (including other teams' cards, which
  is what makes baiting possible).
