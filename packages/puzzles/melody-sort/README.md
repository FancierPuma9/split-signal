# Melody Sort

The Listener (dealt at random each round) hears a short "melody" of six very different sounds: a
boom, a ding, a buzz, a clap, a zap and a honk, in a random order. The Arranger has them as tiles
marked with abstract symbols and has to put them in order. Only the Listener ever hears anything: the
target, and every time the Arranger plays their current order.

- **Deafness is server-enforced:** the Arranger's view carries tile ids and symbols only, never
  sounds (the harness checks this by swapping every sound). Symbols are unrelated to sounds.
- **Actions:** the Arranger swaps two tiles or plays the order (then waits for the playback to
  finish before playing again, so orders can't be brute-forced). The Listener can replay the target
  as often as they like.
- **Win:** race. The first team to _play_ the correct order.
- **Comms:** voice, team only.
- **Teams:** 2 players, or 3 with two Arrangers who each own half the tiles (a swap needs at least
  one of your own tiles).
- **Sound:** the sound effects in `lib/sounds.ts` (shared with Dictionary), synthesized with Web
  Audio; no audio assets. Playtesting found six close notes of a C major scale far too hard to
  tell apart, so the notes differ in texture as well as pitch.
