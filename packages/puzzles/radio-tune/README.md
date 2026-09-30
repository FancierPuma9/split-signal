# Radio Tune

The Sender sees the correct settings for a radio panel. The Receiver has the panel. Who gets which
job is dealt at random each round. The Sender can only talk through short recorded clips, and the Receiver hears every clip
distorted: the closer their panel gets, the clearer it sounds.

- **Controls and layers:** each control drives its own distortion layer, so a careful ear can
  tell them apart:
  - Band knob (0-9): bandpass narrowing, from wide open to a thin sliver.
  - Tuning knob (0-9): pitch drift, up if too high, down if too low.
  - Filter switch: static noise when wrong.
  - Squelch switch: choppy stutter when wrong.
- **Clips:** one-way, Sender to Receiver, up to 5 s, one every 3 s. The Receiver's `repeat` signal
  replays the latest clip with distortion recomputed from their current panel.
- **Pipeline:** MediaRecorder → upload over the game socket → the server's `onClip` computes the
  distortion from the Receiver's state (so the target never reaches them) → the Receiver's browser
  applies it with Web Audio (`distort.ts`). Not cheat-proof, which is fine for a friends game;
  server-side processing would be a drop-in upgrade.
- **Win:** race. The panel has to match and stay matched for 2 s (so sweeping can't win by chance).
- **Teams:** exactly 2 players.
