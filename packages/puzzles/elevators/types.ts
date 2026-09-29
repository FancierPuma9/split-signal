export interface Group {
  id: string;
  /** Destination floor (the lobby is floor 1). */
  floor: number;
  /** People in the group; an elevator holds CAPACITY people. */
  size: number;
}

export type Pick = { elevator: number; floor: number } | 'idle';

export interface Trip {
  elevator: number;
  /** null when nobody sent this elevator anywhere. */
  floor: number | null;
  /** Everyone who picked this elevator this turn. */
  pickedBy: string[];
  /** Groups delivered by this trip. */
  served: string[];
  /**
   * served: delivered at least one group. empty: went where nobody was waiting (or everyone waiting
   * was too big to fit). blocked: another elevator went to the same floor, so this trip was wasted.
   * idle: nobody picked it.
   */
  outcome: 'served' | 'empty' | 'blocked' | 'idle';
}

export interface State {
  topFloor: number;
  elevators: number;
  capacity: number;
  /** Waiting groups, in queue order. */
  queue: Group[];
  delivered: Group[];
  turns: number;
  turnStartedAt: number;
  /** This turn's secret choices. */
  picks: Record<string, Pick>;
  /** The last turn, revealed to everyone: who picked what, and what each elevator did. */
  last: {
    turn: number;
    picks: Array<{ player: string; pick: Pick }>;
    trips: Trip[];
  } | null;
  solved: boolean;
}

export interface View {
  topFloor: number;
  elevators: number;
  capacity: number;
  queue: Group[];
  delivered: number;
  turns: number;
  turnStartedAt: number;
  turnMs: number;
  myPick: Pick | null;
  teammatesReady: number;
  teammates: number;
  last: State['last'];
  solved: boolean;
}

export type Action = { type: 'pick'; elevator: number; floor: number } | { type: 'idle' };
