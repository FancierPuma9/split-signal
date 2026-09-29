# Going Once

Arena: one instance for the whole room, everyone on voice together. A painting goes up for
auction. One player from each team bids, in the open. Each team that isn't selling has an
Appraiser who knows the true value; the selling team's other player is the Seller, who knows
nothing. The Appraiser has to steer their Bidder to win below value without saying enough for the
other Bidder to work out the number. Silence is a weapon, and so is a bluff.

- **Comms:** `{ type: 'voice', scope: 'all' }`.
- **Roles:** the Seller's team rotates with the round number (`roundIndex`); each time a team comes
  round again, its two players swap jobs. Every other team is Appraiser + Bidder, so with three
  teams two informed teams compete, plus the Seller team's blind Bidder.
- **Auction:** the Seller opens it (or it opens itself after 20s). Ascending bids of +$50, +$100
  or +$250; you can't raise your own bid. Every bid resets the clock: at 10s quiet the Seller's
  hammer lights ("going once") and they can sell; at 15s it sells itself. No bids within 20s of
  opening: no sale. A Bidder can pass, which is final; when nobody's left to outbid the high
  bidder, it sells at once.
- **Value:** seeded, $200-$2,000 in $50 steps. Only Appraisers see it until the hammer falls.
- **Win:** `compare` on money. The buyer's team gains value − price (possibly negative); everyone
  else gains 0; no sale is 0 all round. Every team counts as finished, so a team that stayed out
  beats one that overpaid. An auction still open at the buzzer counts as sold at the current bid.
- **The painting:** generated on the client from a seed, with a pompous title and artist from the
  server. It says nothing about the value.
- **Reveal:** under the scoreboard, the value, the price and who came out ahead.
