import type { Rng } from '@split-signal/shared';
import type { Controls, Shape, Task } from './types';

/** Every sound, in the order they unlock. */
export const SOUNDS = [
  'DING',
  'BUZZ',
  'BOOM',
  'CLAP',
  'TICK',
  'WHOOSH',
  'ZAP',
  'POW',
  'HONK',
  'SPLAT',
  'RIBBIT',
  'CRUNCH',
] as const;

/** How many sounds each stage has. Stage N is tight with its own and easy with N+1's. */
export const VOCABULARY = [3, 4, 5, 7, 9, 12];
export const STAGES = VOCABULARY.length;

export const FORMS = ['circle', 'square', 'triangle', 'star', 'diamond', 'heart'];
export const COLORS = ['red', 'blue', 'yellow', 'green'];
/** Tiles are pictures that look different when turned, so rotation shows. */
export const TILES = ['🚩', '🔑', '👢', '⚡', '🎺', '🐟', '🍌', '🔨', '✂️', '🎸'];

/** The sounds unlocked while playing a stage (all of them once finished). */
export function soundsFor(stage: number): string[] {
  return SOUNDS.slice(0, VOCABULARY[Math.min(stage, STAGES - 1)]);
}

/** Shapes that share a form or a color with each other, so "the red one" rarely settles it. */
function shapes(count: number, rng: Rng): Shape[] {
  const forms = rng.shuffle(FORMS).slice(0, Math.ceil(count / 2) + 1);
  const colors = rng.shuffle(COLORS).slice(0, Math.ceil(count / 2) + 1);
  const all = forms.flatMap((form) => colors.map((color) => ({ form, color })));
  return rng.shuffle(all).slice(0, count);
}

/** A different order from the answer. */
function scrambled<T>(answer: readonly T[], rng: Rng): T[] {
  for (;;) {
    const order = rng.shuffle(answer);
    if (order.some((item, i) => item !== answer[i])) return order;
  }
}

/** The six stages, seeded. */
export function generateTasks(rng: Rng): Task[] {
  const pick = (count: number): Task => ({
    kind: 'pick',
    shapes: shapes(count, rng),
    answer: rng.int(0, count - 1),
  });
  const order = (count: number): Task => {
    const answer = rng.shuffle(TILES).slice(0, count);
    return { kind: 'order', answer, start: scrambled(answer, rng) };
  };
  const rotateAnswer = rng.shuffle(TILES).slice(0, 5);
  const turns = Object.fromEntries(rotateAnswer.map((t) => [t, rng.int(0, 3)]));
  return [
    pick(2),
    pick(4),
    order(3),
    order(5),
    { kind: 'dials', answer: [rng.int(0, 9), rng.int(0, 9)] },
    {
      kind: 'rotate',
      answer: rotateAnswer,
      turns,
      start: scrambled(rotateAnswer, rng),
      startTurns: Object.fromEntries(rotateAnswer.map((t) => [t, (turns[t]! + rng.int(1, 3)) % 4])),
    },
  ];
}

/** The Receiver's controls at the start of a task. */
export function startControls(task: Task): Controls {
  switch (task.kind) {
    case 'pick':
      return { kind: 'pick', selected: null };
    case 'order':
      return { kind: 'order', tiles: [...task.start] };
    case 'dials':
      return { kind: 'dials', values: [0, 0] };
    case 'rotate':
      return { kind: 'rotate', tiles: [...task.start], turns: { ...task.startTurns } };
  }
}

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** Whether the controls answer the task. */
export function isCorrect(task: Task, controls: Controls): boolean {
  if (task.kind === 'pick' && controls.kind === 'pick') return controls.selected === task.answer;
  if (task.kind === 'order' && controls.kind === 'order') {
    return sameList(controls.tiles, task.answer);
  }
  if (task.kind === 'dials' && controls.kind === 'dials') {
    return controls.values[0] === task.answer[0] && controls.values[1] === task.answer[1];
  }
  if (task.kind === 'rotate' && controls.kind === 'rotate') {
    return (
      sameList(controls.tiles, task.answer) &&
      task.answer.every((t) => (controls.turns[t] ?? 0) % 4 === task.turns[t])
    );
  }
  return false;
}
