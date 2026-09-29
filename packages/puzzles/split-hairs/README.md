# Split Hairs

The Guesser sees six to eight words that all mean nearly the same thing (sad, gloomy, homesick,
heartbroken, lonely...). The Drawer sees a _picture_ of the target word, never the word and never
the list, and has to get across not just "sad" but "sad, and not any of those neighbours" with ink
that fades a second after it is drawn. Every wrong guess locks the Guessers out, for 5s, then 10s,
20s, 40s.

- **Comms:** `{ type: 'draw', fadeMs: 1000, from: 'role' }`. Only the Drawer can draw.
- **Win:** `race`. First team to pick the right word. Lockouts cost time, not points.
- **Roles:** the Drawer rotates with the round number. With three players, the two Guessers share
  the list, the wrong guesses and the lockout.
- **What each side knows:** the Drawer's view has the picture (as sanitized SVG markup) and how many
  wrong guesses there have been, but not which words, so they can't learn the vocabulary and spell
  it. The Guesser's view has the list and their wrong picks, never the picture. Picture file names
  never leave the server, since they name the word.
- **Reveal:** under the scoreboard, everyone sees the word, the picture and the list.

## Adding clusters

Everything lives in `content/`; no code changes needed.

1. Add a cluster to `content/clusters.json`:

   ```json
   {
     "id": "ways-to-sit",
     "words": ["sit", "slouch", "perch", "sprawl", "squat", "kneel"],
     "pictures": { "slouch": ["slouch-01.svg"], "perch": ["perch-01.svg"] }
   }
   ```

   Every list is a tight cluster: that is the game. Six to eight words. Words without a picture can
   still show up as decoys, but only pictured words are ever the target.

2. Add each picture to `content/pictures/` as a kebab-case `.svg` with a `viewBox`. Simple line
   art reads best at about 200x160. Pictures may not contain text, links, images or scripts, and
   the server strips titles, comments and ids before sending them.

3. Run `pnpm test`. The content test validates the whole pack, including that no picture's markup
   contains one of its cluster's words.

The starter pack is 15 clusters with one picture per word.
