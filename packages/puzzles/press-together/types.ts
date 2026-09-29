export interface State {
  /** Which players have pressed. */
  pressed: string[];
  /** Round time each team finished, once all its members pressed. */
  finishedAt: Record<string, number>;
  teams: Array<{ id: string; playerIds: string[] }>;
}

export interface View {
  /** Every team's progress: it's a shared room, so everyone sees everything. */
  teams: Array<{ id: string; pressed: number; size: number; done: boolean }>;
  myTeam: string;
  iPressed: boolean;
}

export type Action = { type: 'press' };
