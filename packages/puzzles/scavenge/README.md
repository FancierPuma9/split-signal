# Scavenge

One shared bin of parts. Each team is building something different. Parts come in tight families
(a shape and color) of five variants (pattern and motif), so the Reader, who has the schematic, has
to describe the exact variant to the Grabber, who has the bin. Every five seconds all grabs land at
once: a part only one team picked goes to their tray; a part two teams picked stays in the bin.
Each team has twelve grabs for the round.

- **Why three or more teams:** with two, the only way to break a tie between two good teams is a
  scarce bin, and a scarce bin decides it by luck. With three, a team that shadows another hands
  the round to the third, so the bin can be generous. `manifest.teams.min = 3`; the lobby lists it
  under "puzzles that don't fit" otherwise.
- **Instance:** shared (arena). **Comms:** `{ type: 'voice', scope: 'team' }`.
- **Roles:** Reader (schematic of 8 exact parts, the trays, no bin) and Grabber (bin, trays, no
  schematic), swapping each round.
- **Grabs:** hover any part (change freely), optionally commit (locks it until the grab lands).
  At the tick an uncommitted hover counts as a grab; no hover is a pass. Every grab attempt costs
  one of the team's twelve, contested or not. Taken parts never go back. Picks are private until
  they land; trays and results are public.
- **Structure:** 8 families x 5 variants = 40 parts, one of each. Every pair of teams shares exactly
  two required parts and nobody else needs those, so contested parts are known in advance to be
  contested and every team faces the same amount of it. The rest of each schematic is the team's
  own. Spare parts exist, so grabbing to deny someone is possible, at the cost of a grab.
- **Win:** `race`: the first team with all eight. If time runs out, most schematic parts, then
  most grabs left (a hidden tiebreak).
