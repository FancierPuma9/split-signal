# Sliding Grid

A grid of sliding tiles. Each player owns a few tiles, each with a target square. You only see your
own tiles and targets; your teammates' tiles are invisible obstacles.

- **Turns:** everyone picks one of their tiles and a direction (or passes). The turn resolves when
  everyone has chosen, or after 10 seconds.
- **Simultaneous resolution:** a move succeeds if its destination is free once every move is
  applied, so you can follow a tile that is leaving. Two tiles claiming the same square both fail,
  tiles can't swap places, and a blocked tile blocks anyone moving into it. Order never matters.
- **Comms:** arrow signals only (`up`, `down`, `left`, `right`), 750 ms cooldown.
- **Win:** compare. Fewest turns to place every tile; ties go to the faster team.
- **Teams:** 2-4 players per team. 2 players get a 4x4 board, 3-4 players get 5x5, with 3 tiles
  each.
- **Generation:** a solved layout is scrambled with random legal moves from the seed, so every board
  is solvable and every team gets the same one.
