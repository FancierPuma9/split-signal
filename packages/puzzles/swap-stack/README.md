# Swap Stack

Build the tallest tower you can. The Builder places pieces onto five columns, but every piece
looks like plain wood to them. The Sorter sees the real materials, their strength, and the load on
every placed piece, and never places anything: all they control is the next two pieces, which
they can swap or leave. Whether they swapped is the only thing the Builder ever learns.

- **Comms:** `{ type: 'none' }`. The swap cue is puzzle state in the Builder's view, not a signal.
- **Materials** (`tower.ts`), as `{ weight, strength }`: wood `{1, 2}`, iron `{3, 5}`,
  steel `{4, 8}`, concrete `{5, 6}`. A piece's load is the weight of everything above it in its
  column. After each placement, the lowest piece carrying more than its strength fails, and it
  and everything above it fall off.
- **Turns:** 24 pieces, a seeded sequence identical for every team. Before each one, the Sorter has
  5s to swap or keep (timeout: keep); then the Builder has 8s to place it (timeout: the shortest
  column, leftmost first).
- **Win:** `compare` on `points` = height of the tallest surviving column + pieces still
  standing / 100 (the spec's tie-break, folded in). Scored at the buzzer if time runs out.
- **Roles:** the Sorter rotates with the round. With three players, two Builders take turns on their
  own sets of columns, sharing one Sorter and one queue.
- **What each side knows:** the Builder's view never contains a material; the tests check that
  changing every material leaves it identical. Both see pieces fall.

Knobs: `PIECES`, `SORT_MS`, `BUILD_MS` in `manifest.ts`; the material numbers in `tower.ts`. The
spec's optional Builder discards are not built.
