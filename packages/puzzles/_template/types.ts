// Types shared by server.ts and client.tsx. The client imports these as types only, so none of the
// server logic ends up in the browser bundle.

export const MAX_NUMBER = 20;

export interface State {
  secret: number;
  knowerId: string;
  guesses: Array<{ by: string; value: number }>;
  solved: boolean;
}

export type View =
  | { role: 'knower'; secret: number; guesses: number[]; solved: boolean }
  | { role: 'guesser'; guesses: number[]; solved: boolean };

export type Action = { type: 'guess'; value: number };
