# Earshot

Hide and seek where the hider can't hide. Each team has a Ghost and a Hunter. The Ghost drifts
through a maze on its own and sees everything; its only input is how loudly it talks, which sets
how far away it can be heard. The Hunter sees walls near them but no ghosts, and navigates by ear:
louder means closer. Enemy hunters hear your Ghost at the same range yours does and can catch it,
which mutes it and teleports it for five seconds. Hunters carry a flashlight with a slow battery:
ears for the approach, light for the catch.

- **Instance:** shared (arena). Maze: 13x13, braided (most dead ends knocked through) so there are
  loops to chase round.
- **Comms:** `{ type: 'voice', scope: 'all', reportLevel: true }` shaped by `commsState`: Ghosts
  `send` unless muted and don't `receive`; Hunters never `send`, and get `peers` for every Ghost:
  audible within its radius measured along the maze, with `gain = 1 - distance / radius` (applied
  by the receiving client through Web Audio). Audibility is enforced by the server; only the
  falloff is client-side.
- **Loudness:** each client reports its mic level (`__micLevel`, ~10 Hz). Radius =
  2 + 10 x clamp((dB + 50) / 40) tiles, smoothed over 0.5 s, back to 2 after a second of silence.
  Misreporting can't favour you: the range is the same for your hunter and the enemy's
  (`ENEMY_RANGE_MULTIPLIER`, default 1).
- **Ghosts:** one tile every 1.5 s, never straight back unless at a dead end.
- **Flashlight:** lights up to 2 tiles ahead (walls stop it). Battery drains 20/s while on, recharges
  5/s while off. A Ghost in a lit tile shows on that Hunter's screen. Walking into a wall turns you.
- **Catch:** only a Ghost in your beam, 2 s cooldown. Your own Ghost: +5 and it respawns far from
  every hunter. An enemy Ghost: +3, and it's muted for 5 s and teleported far away.
- **Roles:** swap each round. **Win:** `compare` on points, ties to the earlier last catch.
- **No panning:** a mono speaker has to work; direction comes from moving and hearing the gain
  change.
