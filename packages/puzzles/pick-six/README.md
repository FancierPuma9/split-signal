# Pick Six

Arena: one instance for the whole room. Every turn, every player secretly picks a number from 1
to 6. Picks are worth face value, but the low numbers hunt the high ones: 1 beats 6, 2 beats 5,
3 beats 4. Everyone's picks are revealed after each turn, and there's no talking, so the only way
to coordinate with your partner is how you split last turn.

- **Scoring per turn** (`scoring.ts`):
  - Each pick scores its face value.
  - A hunter whose prey was picked by someone on _another_ team scores hunter + prey; that prey
    scores 0. You can't hunt your partner. Two hunters of the same prey from different teams
    both score in full.
  - If two teammates pick the same number, the team scores it once.
- **Turns:** 10. Each has an 8s pick phase (it closes early once everyone has picked), then a 3s
  reveal. No pick scores 0.
- **Comms:** `{ type: 'none' }`.
- **Win:** `compare` on each team's total (`score().teams[id].points`).
- **Teams:** 2 per team, 2-3 teams.
- **Reveal:** the last turn and the final totals stay up under the scoreboard.

Knob worth a playtest: friendly fire (hunting your own partner too) is a one-line change to
`pickedBy` in `scoring.ts`.
