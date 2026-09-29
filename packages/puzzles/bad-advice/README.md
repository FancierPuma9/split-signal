# Bad Advice

Arena: one instance for the whole room. Every player has their own copy of a 9×9 board, their own
piece and their own target. You can't see your own target, but everyone else can. Each turn,
every other player sends you a direction. Your partner wants you home; the opponents want you
lost. The hints arrive anonymous and shuffled, so you read the _distribution_: two matching hints
might be a conspiracy, and a lone one might be your partner, or a plant.

- **Turns:** a hint phase (10s, or until everyone has hinted everyone still out), a reveal, then a
  move phase (8s, or until everyone still out has moved). Moves happen all at once; walls and
  edges block. Reaching your target ends your run, but you keep sending hints.
- **Comms:** `{ type: 'signals', signals: ['up','down','left','right'], cooldownMs: 0, relay: false }`.
  Hints are targeted signals (`to`) consumed by `onSignal` and never relayed, so the server is
  the only one who knows who sent what. At the reveal each player's hints are stored shuffled;
  the tests check after every step that no view gives a sender away.
- **Feedback:** none. No hot or cold. Getting there is the only signal.
- **Win:** `race`: first team with both players home. At the 30-turn cap, the team closest to home
  wins (`points` = 33 minus the Manhattan distance both still have to go).
- **Teams:** 2 per team, 2-3 teams.
- **Reveal:** under the scoreboard, everyone sees their own target at last.
