# Walkie

Two rooms, one per player, seen from above. Each room has a row of switches near the start and
gated walls between the player and their exit. Every switch works something in the _other_
room: some open one of your partner's gates, some hold one shut, some do nothing. Only one player
is live at a time: they can see their room, move, flip switches and talk. The other sees black
and listens. Control swaps at random with no warning, so a sentence can get cut off halfway and
whatever was in the second half is gone.

- **Comms:** `{ type: 'voice-alternating', swapIntervalMs: [15000, 40000] }`. The server picks who
  is live and swaps on a seeded schedule (the same seat is live on every team at the same moment),
  then flips each voice connection's send and hear flags: the listener's browser sends no audio at
  all (`replaceTrack(null)`), so there's nothing to get around. The puzzle reads who's live from
  `ctx.comms.activePlayerId`.
- **Views:** the live player gets their room; the listener's view is `{ role: 'listening' }` and
  nothing else, so their room state never reaches their browser. Actions from the listener are
  refused.
- **Levels** (`level.ts`), seeded: each room has 2-3 gated walls and six switches, each with a
  unique colour and symbol. Wiring: one opener per gate in the other room, two traps, the rest
  dead (2/2/2 with two gates). A gate is open while any of its openers is on and none of its traps
  is, so flipping everything nets zero. The tests solve 30 seeds.
- **Win:** `race`: both players on their exits. The last leg is usually one player waiting on
  their exit for control to come back to the other.
- **Controls:** arrow keys or WASD, Space to flip the switch you're standing on.

Easy mode: add `warningMs: 3000` to the comms rule and players get a countdown before each swap.
