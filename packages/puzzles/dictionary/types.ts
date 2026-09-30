/** A shape to pick: a form in a color. */
export interface Shape {
  form: string;
  color: string;
}

/** Each stage's task. The answer lives in the task; Receiver views strip it. */
export type Task =
  | { kind: 'pick'; shapes: Shape[]; answer: number }
  | { kind: 'order'; answer: string[]; start: string[] }
  | { kind: 'dials'; answer: [number, number] }
  | {
      kind: 'rotate';
      answer: string[];
      /** Quarter turns each tile needs, by tile. */
      turns: Record<string, number>;
      start: string[];
      startTurns: Record<string, number>;
    };

/** The Receiver's controls for the current stage. */
export type Controls =
  | { kind: 'pick'; selected: number | null }
  | { kind: 'order'; tiles: string[] }
  | { kind: 'dials'; values: [number, number] }
  | { kind: 'rotate'; tiles: string[]; turns: Record<string, number> };

export interface State {
  sender: string;
  receiver: string;
  tasks: Task[];
  /** The stage being played (0-based); equals tasks.length once all are cleared. */
  stage: number;
  controls: Controls | null;
  lockedUntil: number | null;
  /** When the last stage was cleared, for breaking ties. */
  clearedAt: number | null;
  wrongSubmits: number;
}

export type Action =
  | { type: 'pick'; index: number }
  | { type: 'swap'; a: number; b: number }
  | { type: 'rotate'; position: number }
  | { type: 'setDial'; dial: number; value: number }
  | { type: 'submit' };

/** A task as the Receiver sees it: the controls' contents, no answer. */
export type ReceiverTask =
  | { kind: 'pick'; shapes: Shape[] }
  | { kind: 'order'; count: number }
  | { kind: 'dials' }
  | { kind: 'rotate'; count: number };

interface Common {
  stage: number;
  stages: number;
  controls: Controls | null;
  lockedUntil: number | null;
  done: boolean;
}

export interface SenderView extends Common {
  role: 'sender';
  task: Task | null;
  /** Sound buttons unlocked so far, in unlock order. */
  sounds: string[];
  /** Sounds the next stage adds. */
  nextSounds: string[];
}

export interface ReceiverView extends Common {
  role: 'receiver';
  task: ReceiverTask | null;
  sounds: string[];
}

export interface RevealView {
  role: 'reveal';
  cleared: number;
  stages: number;
  wrongSubmits: number;
}

export type View = SenderView | ReceiverView | RevealView;
