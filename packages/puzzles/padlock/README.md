# Padlock

A combination lock. Each player controls two dials (so 4 dials for 2 players, 6 for 3). Everyone
sees every dial, but can only turn their own.

- **Turns:** each player turns one of their dials up or down by one, or holds. The turn resolves
  when everyone has chosen, or after 15 seconds.
- **Feedback:** one shared sound per turn. A **chime** if at least one dial turned this turn landed
  on its correct number, a **buzz** otherwise, silence if everyone held. It never says which dial,
  so the team has to design experiments to isolate it. The full turn history is on screen.
- **Comms:** voice, team only.
- **Win:** compare. Fewest turns to open; ties go to the faster team.
- **Open question:** the exact feedback rule (plan 13.3). The alternative worth playtesting is
  "chime only if the count of correct dials went up". It lives in `feedback()` in `server.ts`.
