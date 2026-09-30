# Pass It On

Three or four players in a ring. Every clip goes to the next seat only, and arrives chopped into
600 ms slices and shuffled. To answer the person who feeds you, you send the answer forward, all
the way round the ring, through people who each have to unscramble it before passing it on.

- **Roles (3):** the **Keyholder** has what each glyph means (parts and tools), the **Reader** has
  the six steps written in glyphs (part, slot, tool), the **Builder** has the parts, slots and
  tools. Ring: Keyholder → Reader → Builder → Keyholder, so the Builder's questions go to the
  Keyholder, who can only relay them to the Reader.
- **Roles (4):** adds the **Toolsmith**, who has which tool each step needs (the glyphs then cover
  parts only). Ring: Keyholder → Toolsmith → Reader → Builder → Keyholder.
- Roles keep their ring order and move one seat on each round.
- **Comms:** `{ type: 'clips', maxSeconds: 5, direction: 'ring', transform: { kind: 'shuffle',
sliceMs: 600 } }`. The server routes each clip to the next seat and ships a seed; the receiver's
  client scrambles it (same trust model as Radio Tune's distortion). Recent clips can be replayed.
- **Build:** six steps, each attaching one of ten parts to one of four slots, two to four finished
  with one of three tools. Attach appends a step, a tool finishes the last step, undo removes it.
  There's no live feedback: when all six are on the Builder presses Finish.
- **Win:** `race` on time plus 15 s for every wrong step. Other teams get 90 s after the first
  finish (the most a sloppy finish can cost), so a careful team can still win.
- **What each side knows:** the Builder never sees the steps or the key; the Reader sees glyphs,
  never what they mean; the Keyholder never sees the steps; the Toolsmith sees only tools.
- **Reveal:** every step, right or wrong, with what was built.

## Reverse Charges

`pass-it-on-reversed` is the same puzzle with `transform: { kind: 'reverse' }`: every clip plays
backwards. It's a separate catalog entry so a match can pick either.
