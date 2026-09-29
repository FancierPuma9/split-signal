# Ghost Ink

The Drawer sees a scene: five to seven objects from a palette of twelve, each at a spot on the
canvas. The Placer has the full palette and a blank canvas and has to rebuild the scene. The only
channel is the Drawer's ink, which fades a second after it is drawn, so the Drawer can point and
gesture but never build up a diagram.

- **Comms:** `{ type: 'draw', fadeMs: 1000, from: 'role' }`. Only the Drawer's view has
  `canDraw: true`, and the server drops ink from anyone else.
- **Win:** `compare` on `points`: the mean accuracy across the scene's objects, as a percentage.
  Each object scores `max(0, 1 - distance / halfDiagonal)`, measured in scene heights. Objects
  never placed score 0; placed objects that aren't in the scene are ignored. Placements count at
  the buzzer too, so a team that runs out of time still scores. Ties go to the earlier submit.
- **Roles:** the Drawer rotates with the round number. With three players, the two Placers split
  the palette between them and the team is done once both have submitted.
- **Feedback loop:** the Drawer sees the team's placements as faint outlines on their scene.
- **Reveal:** after submitting, everyone sees the scene and the rebuild side by side, with each
  object's accuracy.

Knobs: `FADE_MS` in `manifest.ts` (try `0` once, for persistent ink), `SCENE_SIZE` in `server.ts`,
and the palette in `scene.ts`.
