import { createRng } from '@split-signal/shared';
import { describe, expect, it } from 'vitest';
import { runPuzzleScript, startPuzzle, type ScriptStep } from '../harness';
import dictionary, { LOCKOUT_MS } from './server';
import { SOUNDS, STAGES, VOCABULARY, generateTasks, soundsFor } from './stages';
import type { Action, State, Task } from './types';

/** The Receiver actions that solve a task from its starting controls. */
function solve(task: Task): Action[] {
  switch (task.kind) {
    case 'pick':
      return [{ type: 'pick', index: task.answer }, { type: 'submit' }];
    case 'dials':
      return [
        { type: 'setDial', dial: 0, value: task.answer[0] },
        { type: 'setDial', dial: 1, value: task.answer[1] },
        { type: 'submit' },
      ];
    case 'order':
    case 'rotate': {
      const tiles = [...task.start];
      const actions: Action[] = [];
      task.answer.forEach((tile, i) => {
        const j = tiles.indexOf(tile);
        if (j !== i) {
          [tiles[i], tiles[j]] = [tiles[j]!, tiles[i]!];
          actions.push({ type: 'swap', a: i, b: j });
        }
      });
      if (task.kind === 'rotate') {
        task.answer.forEach((tile, position) => {
          const turns = (task.turns[tile]! - task.startTurns[tile]! + 4) % 4;
          for (let k = 0; k < turns; k++) actions.push({ type: 'rotate', position });
        });
      }
      return [...actions, { type: 'submit' }];
    }
  }
}

describe('dictionary stages', () => {
  it('builds the six stages with scrambled starts', () => {
    const tasks = generateTasks(createRng('stages'));
    expect(tasks.map((t) => t.kind)).toEqual(['pick', 'pick', 'order', 'order', 'dials', 'rotate']);
    const [two, four, three, five, , rotate] = tasks;
    expect(two?.kind === 'pick' && two.shapes).toHaveLength(2);
    expect(four?.kind === 'pick' && four.shapes).toHaveLength(4);
    expect(three?.kind === 'order' && three.start).not.toEqual(
      three?.kind === 'order' && three.answer,
    );
    expect(five?.kind === 'order' && five.answer).toHaveLength(5);
    if (rotate?.kind !== 'rotate') throw new Error('expected rotate');
    for (const tile of rotate.answer) expect(rotate.startTurns[tile]).not.toBe(rotate.turns[tile]);
  });

  it('unlocks 3, 4, 5, 7, 9 and 12 sounds', () => {
    expect(Array.from({ length: STAGES + 1 }, (_, i) => soundsFor(i).length)).toEqual([
      ...VOCABULARY,
      12,
    ]);
    expect(soundsFor(0)).toEqual(['DING', 'BUZZ', 'BOOM']);
    expect(SOUNDS).toHaveLength(12);
  });
});

describe('dictionary', () => {
  const start = () =>
    startPuzzle(dictionary, {
      players: 2,
      hidden: [
        {
          name: 'the answer',
          hiddenFrom: (p) => p.seat !== 0, // round 0: seat 0 is the Sender
          // Different answers, same things on the Receiver's screen.
          change: (s: State) => ({
            ...s,
            tasks: s.tasks.map((t): Task => {
              switch (t.kind) {
                case 'pick':
                  return { ...t, answer: (t.answer + 1) % t.shapes.length };
                case 'order':
                  return { ...t, answer: [...t.answer].reverse() };
                case 'dials':
                  return { ...t, answer: [(t.answer[0] + 1) % 10, t.answer[1]] };
                case 'rotate':
                  return {
                    ...t,
                    turns: Object.fromEntries(
                      Object.entries(t.turns).map(([k, v]) => [k, (v + 1) % 4]),
                    ),
                  };
              }
            }),
          }),
        },
      ],
    });

  it('turns off the Sender’s mic and refuses sounds that are locked or not theirs', () => {
    runPuzzleScript(dictionary, {
      players: 2,
      expectSolved: false,
      steps: [
        { seat: 0, expectComms: { send: false } },
        { seat: 1, expectComms: { send: true, receive: true } },
        { seat: 0, signal: 'DING', expect: 'accept' },
        { seat: 0, signal: 'POW', expect: 'reject' },
        { seat: 1, signal: 'DING', expect: 'reject' },
      ],
    });
  });

  it('locks the Receiver for 5s after a wrong answer', () => {
    const game = start();
    const task = game.state.tasks[0]!;
    const wrong = task.kind === 'pick' ? (task.answer + 1) % task.shapes.length : 0;
    game.act(1, { type: 'pick', index: wrong });
    game.act(1, { type: 'submit' });
    expect(game.state.stage).toBe(0);
    expect(game.act(1, { type: 'pick', index: 0 }).ok).toBe(false);
    game.advance(LOCKOUT_MS);
    expect(game.act(1, { type: 'pick', index: 0 }).ok).toBe(true);
  });

  it('clears stages in order, unlocking sounds, and scores stages cleared', () => {
    const game = start();
    for (const action of solve(game.state.tasks[0]!)) game.act(1, action);
    game.advance(3000);
    for (const action of solve(game.state.tasks[1]!)) game.act(1, action);
    expect(game.state.stage).toBe(2);
    expect(game.signal(0, 'TICK').ok).toBe(true);
    expect(game.score()).toEqual({ points: 2, elapsedMs: 3000 });
    const sender = game.view(0);
    expect(sender.role === 'sender' && sender.sounds).toHaveLength(5);
    expect(game.act(0, { type: 'submit' }).ok).toBe(false);
  });

  it('can be played all the way through', () => {
    runPuzzleScript(dictionary, {
      players: 2,
      steps: (state) =>
        state.tasks.flatMap((task): ScriptStep<Action>[] =>
          solve(task).map((action) => ({ seat: 1, action })),
        ),
      expectScore: { points: STAGES },
    });
  });

  it('swaps who sends each round', () => {
    const game = startPuzzle(dictionary, { players: 2, roundIndex: 1 });
    expect(game.view(1).role).toBe('sender');
  });
});
