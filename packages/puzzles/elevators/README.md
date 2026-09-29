# Elevators

A lobby queue of passenger groups, each bound for a floor. Each turn, each player secretly picks
an elevator and a floor. No communication at all: both players watch the same outcome, and every
pick is revealed after the turn, so the only way to coordinate is to read what your partner was
going for and adapt.

- **Resolution** (`logic.ts`):
  - Different elevators, different floors: both trips run.
  - Same elevator: only one of the floors is served, chosen at random.
  - Different elevators, same floor: only one serves it; the other trip is wasted.
  - A trip boards waiting groups for its floor in queue order while they fit (6 people per car).
- **Turns:** resolve when everyone has picked, or after 12 seconds (no pick means idle).
- **Win:** compare. Fewest turns to clear the lobby; ties go to the faster team.
- **Comms:** none.
- **Teams:** 2 players (2 elevators) or 3 (3 elevators).
- **Queue:** uneven demand (two busy floors, some quiet ones) and a pair of 4-person groups for the
  same floor that can't share a car, so the obvious move isn't always the right one.
