# Melody Sort

The Listener (seat 0) hears a short melody of 6 notes. The Arranger has the notes as tiles marked
with abstract symbols and has to put them in order. Only the Listener ever hears anything: the
target, and every time the Arranger plays their current order.

- **Deafness is server-enforced:** the Arranger's view carries tile ids and symbols only, never
  pitches (the harness checks this by shifting every pitch). Symbols are unrelated to pitch.
- **Actions:** the Arranger swaps two tiles or plays the order (then waits for the playback to
  finish before playing again, so orders can't be brute-forced). The Listener can replay the target
  up to 6 times.
- **Win:** race. The first team to _play_ the correct order.
- **Comms:** voice, team only.
- **Teams:** 2 players, or 3 with two Arrangers who each own half the tiles (a swap needs at least
  one of your own tiles).
- **Sound:** synthesized with Web Audio (two octaves of C major), no audio assets.
- **Known gap:** the Listener's view includes the target pitches so their browser can synthesize
  them, so the replay limit is enforced by the server's counter, not by secrecy.
