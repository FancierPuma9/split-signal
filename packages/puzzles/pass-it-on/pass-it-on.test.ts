import { describe, expect, it } from 'vitest';
import { createTestPlayers, runPuzzleScript, startPuzzle } from '../harness';
import reversed from '../pass-it-on-reversed/server';
import { PARTS, STEPS, assignRoles } from './assembly';
import passItOn, { PENALTY_MS } from './server';
import type { State } from './types';

/** Seats by role for a started game. */
const seats = (state: State) => {
  const bySeat = Object.keys(state.roles).sort();
  const seatOf = (role: string) => bySeat.findIndex((id) => state.roles[id] === role);
  return {
    builder: seatOf('builder'),
    reader: seatOf('reader'),
    keyholder: seatOf('keyholder'),
    toolsmith: seatOf('toolsmith'),
  };
};

describe('pass it on roles', () => {
  it('puts the roles in ring order, turning each round', () => {
    const three = createTestPlayers(3);
    expect(Object.values(assignRoles(three, 0))).toEqual(['keyholder', 'reader', 'builder']);
    expect(Object.values(assignRoles(three, 1))).toEqual(['builder', 'keyholder', 'reader']);
    const four = createTestPlayers(4);
    expect(Object.values(assignRoles(four, 0))).toEqual([
      'keyholder',
      'toolsmith',
      'reader',
      'builder',
    ]);
  });
});

describe('pass it on', () => {
  it('splits what everyone knows', () => {
    const game = startPuzzle(passItOn, {
      players: 3,
      hidden: [
        {
          name: 'the instructions',
          hiddenFrom: (p) => p.seat !== 1, // round 0: seat 1 is the Reader
          change: (s) => ({ ...s, target: [...s.target].reverse() }),
        },
        {
          // Relabel two parts everywhere: the glyphs in the steps stay put, so only the
          // Keyholder (who has the key) can tell.
          name: 'which parts the steps use',
          hiddenFrom: (p) => p.seat !== 0,
          change: (s) => {
            const [p, q] = [
              s.target[0]!.part,
              PARTS.find((x) => !s.target.some((t) => t.part === x.id))!.id,
            ];
            const swap = (id: string) => (id === p ? q : id === q ? p : id);
            return {
              ...s,
              target: s.target.map((t) => ({ ...t, part: swap(t.part) })),
              partGlyph: Object.fromEntries(
                Object.entries(s.partGlyph).map(([part, glyph]) => [swap(part), glyph]),
              ),
            };
          },
        },
      ],
    });
    const { builder, reader, keyholder } = seats(game.state);
    expect(game.view(builder).role).toBe('builder');
    const readerView = game.view(reader);
    expect(readerView.role === 'reader' && readerView.steps).toHaveLength(STEPS);
    // With three players the Reader's steps carry tool glyphs and the key covers tools.
    expect(readerView.role === 'reader' && 'toolGlyph' in readerView.steps[0]!).toBe(true);
    const keyView = game.view(keyholder);
    expect(keyView.role === 'keyholder' && keyView.tools).toHaveLength(3);
  });

  it('gives a fourth player the tools, and takes them off the glyphs', () => {
    const game = startPuzzle(passItOn, { players: 4 });
    const { reader, keyholder, toolsmith } = seats(game.state);
    const smith = game.view(toolsmith);
    expect(smith.role === 'toolsmith' && smith.tools).toHaveLength(STEPS);
    const readerView = game.view(reader);
    expect(readerView.role === 'reader' && 'toolGlyph' in readerView.steps[0]!).toBe(false);
    const keyView = game.view(keyholder);
    expect(keyView.role === 'keyholder' && keyView.tools).toBeUndefined();
  });

  it('lets only the Builder build, and checks nothing until the end', () => {
    const game = startPuzzle(passItOn, { players: 3 });
    const { builder, reader } = seats(game.state);
    expect(game.act(reader, { type: 'attach', partId: 'gear', slot: 1 }).ok).toBe(false);
    expect(game.act(builder, { type: 'useTool', toolId: 'wrench' }).ok).toBe(false);
    expect(game.act(builder, { type: 'attach', partId: 'gear', slot: 9 }).ok).toBe(false);
    expect(game.act(builder, { type: 'attach', partId: 'gear', slot: 1 }).ok).toBe(true);
    expect(game.act(builder, { type: 'attach', partId: 'gear', slot: 2 }).ok).toBe(false);
    game.act(builder, { type: 'useTool', toolId: 'hammer' });
    expect(game.state.assembly).toEqual([{ part: 'gear', slot: 1, tool: 'hammer' }]);
    expect(game.act(builder, { type: 'finish' }).ok).toBe(false);
    game.act(builder, { type: 'undo' });
    expect(game.state.assembly).toEqual([]);
  });

  it('adds 15s for every wrong step when the Builder finishes', () => {
    const game = startPuzzle(passItOn, { players: 3 });
    const { builder } = seats(game.state);
    const target = game.state.target;
    // Build it right except for the last two slots.
    target.forEach((step, i) => {
      const slot = i >= 4 ? (step.slot % 4) + 1 : step.slot;
      game.act(builder, { type: 'attach', partId: step.part, slot });
      if (step.tool) game.act(builder, { type: 'useTool', toolId: step.tool });
    });
    game.advance(30_000);
    game.act(builder, { type: 'finish' });
    expect(game.solved).toBe(true);
    expect(game.state.wrong).toBe(2);
    expect(game.score().elapsedMs).toBe(30_000 + 2 * PENALTY_MS);
    const reveal = game.reveal(builder);
    expect(reveal?.role === 'reveal' && reveal.steps.filter((s) => !s.right)).toHaveLength(2);
  });

  it('solves cleanly when every step matches', () => {
    runPuzzleScript(passItOn, {
      players: 3,
      steps: (state) => {
        const builder = seats(state).builder;
        return [
          ...state.target.flatMap((step) => [
            {
              seat: builder,
              action: { type: 'attach' as const, partId: step.part, slot: step.slot },
            },
            ...(step.tool
              ? [{ seat: builder, action: { type: 'useTool' as const, toolId: step.tool } }]
              : []),
          ]),
          { advance: 1000 },
          { seat: builder, action: { type: 'finish' as const } },
        ];
      },
      expectScore: { elapsedMs: 1000 },
    });
  });

  it('uses six distinct parts and a few tools', () => {
    for (const seed of ['a', 'b', 'c']) {
      const { target } = startPuzzle(passItOn, { players: 3, seed }).state;
      expect(new Set(target.map((s) => s.part)).size).toBe(STEPS);
      const tooled = target.filter((s) => s.tool !== null).length;
      expect(tooled).toBeGreaterThanOrEqual(2);
      expect(tooled).toBeLessThanOrEqual(4);
      for (const s of target) expect(PARTS.some((p) => p.id === s.part)).toBe(true);
    }
  });
});

describe('reverse charges', () => {
  it('is the same puzzle with clips played backwards', () => {
    expect(reversed.manifest.id).toBe('pass-it-on-reversed');
    expect(reversed.manifest.comms).toMatchObject({
      direction: 'ring',
      transform: { kind: 'reverse' },
    });
    expect(passItOn.manifest.comms).toMatchObject({
      transform: { kind: 'shuffle', sliceMs: 600 },
    });
    startPuzzle(reversed, { players: 4 });
  });
});
