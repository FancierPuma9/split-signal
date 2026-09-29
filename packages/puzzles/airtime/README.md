# Airtime

A building with a floor or three, corridors, dead ends and stairs. The Navigator sees the whole
map and an ordered list of objectives in it. The Walker is inside and can see one step around
them: enough to tell they're at a junction, not enough to see where any branch goes. They can
talk, but each of them has thirty seconds of push-to-talk for the whole round.

- **Comms:** `{ type: 'budget-clips', maxSeconds: 5, budgetSeconds: 30 }`, both players budgeted.
  The shell's clip bar shows both budgets draining; a clip longer than what's left is cut to fit.
- **Win:** `race`: every objective in order, then back to the exit (the entrance tile). If nobody
  makes it out, the most progress wins: a point per objective, plus the fraction of the way to
  the next stop covered (by walking distance).
- **Actions:** the Walker moves a tile at a time (`n`, `s`, `e`, `w`, and `up`/`down` on stairs),
  refused into walls; `interact` only works on the current objective. Steps closer than 90ms are
  refused; the client repeats held keys every 150ms.
- **Roles:** swap on alternate rounds.
- **Hard mode:** set `NAVIGATOR_SEES_WALKER = false` in `manifest.ts` and the Navigator has to work
  out where the Walker is from what they say.

## The building generator

`building.ts`, seeded, so every team gets the same building. Each floor is 13×9 tiles:

1. Place three to five rooms, with a wall between any two.
2. Wrap each room in a wall ring that corridors can't enter; doors are the only way in, straight
   off the middle of a side.
3. Join each room to the rooms already joined with a corridor dug by a small Dijkstra search that
   charges for turns, so corridors run straight.
4. Add one to three dead ends.
5. Link floors with stairs dug through to the corridors above, and put the entrance on the ground
   floor.
6. Pick two or three objectives in different rooms, at least eight steps apart, and check with BFS
   that the full route (entrance, objectives in order, back out) is 40-90 steps. Anything that
   fails starts over.

`building.test.ts` checks 200 seeds: solvable, inside the route band, walled rooms, paired stairs,
every room reachable, and dead ends in most buildings.
