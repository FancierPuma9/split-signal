export type Turn = { dial: number; dir: 1 | -1 } | 'hold';

export type Sound = 'chime' | 'buzz';

export interface TurnRecord {
  turn: number;
  /** Each dial that moved this turn, with its new value. */
  moved: Array<{ dial: number; to: number }>;
  /** null when every player held, so nothing moved and nothing sounded. */
  sound: Sound | null;
}

export interface State {
  /** Current value of each dial, 0-9. */
  dials: number[];
  /** The combination. Nobody ever sees this. */
  combination: number[];
  /** Player id controlling each dial. */
  owners: string[];
  turns: number;
  turnStartedAt: number;
  /** Each player's choice for the current turn, hidden from teammates until it resolves. */
  choices: Record<string, Turn>;
  /** Every resolved turn, oldest first. Public: it's what the team reasons from. */
  history: TurnRecord[];
  open: boolean;
}

export interface View {
  dials: number[];
  /** Seat of the player who controls each dial. */
  dialSeats: number[];
  /** Indexes of the dials this player controls. */
  mine: number[];
  turns: number;
  turnStartedAt: number;
  turnMs: number;
  myChoice: Turn | null;
  teammatesReady: number;
  teammates: number;
  history: TurnRecord[];
  open: boolean;
}

export type Action = { type: 'turn'; dial: number; dir: 1 | -1 } | { type: 'hold' };
