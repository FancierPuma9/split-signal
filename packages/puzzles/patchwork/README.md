# Patchwork

A text-to-speech sentence is chopped into random-length slices and dealt between two players. Each
hears their own slices, with the other player's slices replaced by noise at the same loudness, so
neither has the sentence and neither can tell how long the gaps are. They talk it over and type the
sentence into one shared text box.

- **Comms:** `{ type: 'voice', scope: 'team' }`.
- **Win:** `compare`. Score is the percentage of words right: `1 - wordDistance / longerLength`,
  word-level Levenshtein after lowercasing and stripping punctuation. Ties go to whoever submitted
  first. Unsubmitted teams are scored on whatever they had typed when time ran out.
- **Round:** 90 s. Replays are unlimited (the clip plays on the client, from the start or from any
  point on the waveform).
- **What each side knows:** each player's view names only their own clip asset (`half-0` or
  `half-1`); the asset is built on the server (`maskedClip`), so the full clip, the sentence and
  the slice layout never reach a client. The slicing is seeded, so every team hears identical
  halves.
- **Shared text:** edits are `insert`/`delete` operations applied to the server's copy in arrival
  order (last write wins); both carets are shown. Either player can submit, which ends the team's
  round.
- **Reveal:** the sentence with a word-by-word diff against the guess.

## Adding sentences

Add entries to `content/sentences.json` (an `id` in kebab-case and 10-15 words of `text`; confusable
words make the best rounds), then render them:

```bash
pnpm gen:patchwork
```

It uses whatever text-to-speech is installed: Windows' built-in voices, macOS `say`, `piper` (set
`PIPER_MODEL` to a voice model), or `espeak-ng`, and writes 16-bit mono 22.05 kHz WAVs next to the
JSON. `--voice <name>` picks a voice, `--force` re-renders everything. The shipped pack was rendered
with Windows' "Microsoft Zira Desktop" voice. Sentences without a WAV are skipped at runtime.
