# Telegraph

Both players see the same irregular board: a blob of 20-45 cells on a 10x10 grid, with arms,
bays and one to three stray islands, different every round. The Sender's copy has 30-40% of the
cells filled in; the Receiver's is empty. The only channel is one button: hold it and the
Receiver hears a tone for as long as it's held. Because the shape is new every time, no code
agreed in advance fits; the pair invents a way to walk this board.

- **Comms:** `{ type: 'signals', signals: ['down', 'up'], cooldownMs: 0, buttons: 'puzzle' }`.
  The Receiver's client plays a tone from `down` to `up` (and flashes the board border, for
  players with sound off). `onSignal` refuses anyone but the Sender.
- **Loop:** the Receiver fills cells and submits. A wrong submit shows the Sender the Receiver's
  board with the wrong cells marked (the only feedback either way), locks the Receiver for 8 s and
  adds 8 s to the team's time.
- **Win:** `race` on time plus penalties. Other teams get 30 s after the first solve.
- **Three players:** one Sender, two Receivers who each fill their half of the board (split at
  the middle column).
- **Roles:** the Sender rotates with the round.
- **What each side knows:** only the Sender's view has the pattern.
