export interface State {
  drawer: string;
  clusterId: string;
  /** The words the Guessers choose from, in display order. Always includes the target. */
  words: string[];
  target: string;
  /** File name of the Drawer's picture, in content/pictures/. Never sent to anyone. */
  picture: string;
  /** Wrong guesses, oldest first. */
  wrong: string[];
  /** Round time until which guesses are refused. */
  lockedUntil: number | null;
  solvedAt: number | null;
}

export interface DrawerView {
  role: 'drawer';
  canDraw: true;
  /** SVG markup of the picture. */
  picture: string;
  /** How many wrong guesses so far, but never which words. */
  wrongCount: number;
  lockedUntil: number | null;
  solved: boolean;
}

export interface GuesserView {
  role: 'guesser';
  canDraw: false;
  words: string[];
  wrong: string[];
  lockedUntil: number | null;
  solved: boolean;
}

/** Everyone, once the round is over. */
export interface RevealView {
  role: 'reveal';
  canDraw: false;
  word: string;
  picture: string;
  words: string[];
  wrong: string[];
  solved: boolean;
}

export type View = DrawerView | GuesserView | RevealView;

export type Action = { type: 'guess'; word: string };
