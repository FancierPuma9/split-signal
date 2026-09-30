# Dictionary

The Sender sees the task and its answer; the Receiver works the controls. The Sender has no mic:
their whole channel is a pad of labelled sound buttons (BOOM, CLAP, DING…) that play on the
Receiver's side. The Receiver talks freely, one way. So the Receiver asks and the Sender answers
with whatever the vocabulary can say. Each stage cleared unlocks more sounds, and meanings the
team invented early are still in force later.

- **Stages:** pick one of two shapes (3 sounds); one of four (4); order three tiles (5); order
  five (7); set two 0-9 dials (9); order and turn five tiles (12).
- **Comms:** `[{ type: 'signals', signals: SOUNDS, cooldownMs: 250, buttons: 'puzzle' },
{ type: 'voice-oneway', scope: 'team' }]`. `commsState` gives the Sender `send: false`;
  `onSignal` refuses sounds that aren't unlocked yet and anything from the Receiver, so a modified
  client can't use the whole vocabulary early.
- **Sounds:** all twelve are synthesized with Web Audio (`sounds.ts`). The Receiver's log shows
  labels too, and any entry can be replayed.
- **Resolution:** a correct submit clears the stage; a wrong one locks the Receiver for 5 s.
- **Win:** `compare` on stages cleared, ties to whoever cleared their last stage first.
- **Roles:** the Sender alternates with the round. The Sender sees the Receiver's controls live.
- **What each side knows:** answers are only in the Sender's view.
