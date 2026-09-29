import type { PuzzleManifest } from '@split-signal/shared';

/** With no new bid for this long the hammer lights: going once. */
export const GOING_ONCE_MS = 10_000;
/** ...and at this long it's sold to the high bidder. */
export const SOLD_MS = 15_000;
/** No bids at all this long after opening: no sale. */
export const NO_BID_MS = 20_000;
/** If the Seller never opens the bidding, it opens itself after this long. */
export const OPEN_BY_MS = 20_000;
export const RAISES = [50, 100, 250] as const;
export const VALUE_RANGE = { min: 200, max: 2000, step: 50 };

export const manifest: PuzzleManifest = {
  id: 'going-once',
  name: 'Going Once',
  description:
    'A painting is up for auction and everyone can hear everyone. One team has an Appraiser ' +
    'who knows what it is worth; the Seller’s team is guessing. Win it for less than it’s worth, ' +
    'without saying so loud enough for the other Bidder to work it out.',
  teams: { min: 2, max: 3 },
  playersPerTeam: { min: 2, max: 2 },
  winCondition: 'compare',
  goal: 'Whoever buys gains the value minus the price. Best gain wins; overpaying hands it over.',
  timeLimitSeconds: 180,
  comms: { type: 'voice', scope: 'all' },
  instance: 'shared',
};
