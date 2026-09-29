export type KeyError = { id: number; key: string; reason: 'not-yours' | 'wrong' };

export interface State {
  phrases: string[];
  phraseIndex: number;
  /** Characters of the current phrase typed so far. */
  typed: number;
  /** Which player owns each key. */
  owners: Record<string, string>;
  /** Each player's latest mistake, so their screen can flash. */
  errors: Record<string, KeyError>;
  errorCount: number;
  solved: boolean;
}

export interface View {
  phrase: string;
  typed: number;
  phraseIndex: number;
  phraseCount: number;
  /** The keys this player owns. Nobody sees anyone else's. */
  myKeys: string[];
  lastError: KeyError | null;
  solved: boolean;
}

export type Action = { type: 'key'; key: string };
