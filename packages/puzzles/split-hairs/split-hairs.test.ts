import { describe, expect, it } from 'vitest';
import { startPuzzle, type HiddenInfo } from '../harness';
import {
  MIN_WORDS,
  clusters,
  readPicture,
  sanitizeSvg,
  validatePack,
  type Cluster,
} from './content';
import puzzle, { LIST_SIZE, createSplitHairs, lockoutMs } from './server';
import type { DrawerView, GuesserView, RevealView, State } from './types';

const otherWord = (state: State) =>
  state.words.find((w) => w !== state.target && !state.wrong.includes(w))!;

const hidden: HiddenInfo<State>[] = [
  {
    name: 'the target word',
    hiddenFrom: (player) => player.seat !== 0,
    change: (state) => ({ ...state, target: otherWord(state) }),
    until: (state) => state.solvedAt !== null,
  },
  {
    name: 'the picture',
    hiddenFrom: (player) => player.seat !== 0,
    change: (state) => ({
      ...state,
      picture: state.picture === 'sad-01.svg' ? 'fog-01.svg' : 'sad-01.svg',
    }),
  },
  {
    name: 'the word list and which words were tried',
    hiddenFrom: (player) => player.seat === 0,
    change: (state) => ({
      ...state,
      words: [...state.words].reverse(),
      wrong: state.wrong.map((w) => state.words.find((x) => x !== w && x !== state.target) ?? w),
    }),
  },
];

describe('split hairs', () => {
  it('gives the Drawer a picture and the pen, and the Guesser the words', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    const drawer = game.view(0) as DrawerView;
    const guesser = game.view(1) as GuesserView;
    expect(drawer).toMatchObject({ role: 'drawer', canDraw: true, wrongCount: 0, solved: false });
    expect(drawer.picture).toMatch(/^<svg /);
    expect(drawer).not.toHaveProperty('words');
    expect(guesser).toMatchObject({
      role: 'guesser',
      canDraw: false,
      wrong: [],
      lockedUntil: null,
    });
    expect(guesser.words).toContain(game.state.target);
    expect(guesser).not.toHaveProperty('picture');
  });

  it('shows six to eight words from one cluster, always including the target', () => {
    for (let i = 0; i < 60; i++) {
      const { state } = startPuzzle(puzzle, { players: 2, seed: `list-${i}` });
      const cluster = clusters.find((c) => c.id === state.clusterId)!;
      expect(state.words.length).toBeGreaterThanOrEqual(
        Math.min(LIST_SIZE.min, cluster.words.length),
      );
      expect(state.words.length).toBeLessThanOrEqual(LIST_SIZE.max);
      expect(new Set(state.words).size).toBe(state.words.length);
      expect(state.words.every((w) => cluster.words.includes(w))).toBe(true);
      expect(state.words).toContain(state.target);
      expect(cluster.pictures[state.target]).toContain(state.picture);
    }
  });

  it('solves on the right word', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    game.advance(7000);
    game.act(1, { type: 'guess', word: game.state.target });
    expect(game.solved).toBe(true);
    expect(game.state.solvedAt).toBe(7000);
    expect(game.view(0)).toMatchObject({ solved: true });
  });

  it('locks the Guessers out for longer after every wrong guess', () => {
    expect([1, 2, 3, 4].map(lockoutMs)).toEqual([5000, 10000, 20000, 40000]);
    const game = startPuzzle(puzzle, { players: 2, hidden });
    const decoys = game.state.words.filter((w) => w !== game.state.target);

    game.act(1, { type: 'guess', word: decoys[0]! });
    expect(game.view(1)).toMatchObject({ wrong: [decoys[0]], lockedUntil: 5000 });
    expect(game.view(0)).toMatchObject({ wrongCount: 1, lockedUntil: 5000 });
    expect(game.act(1, { type: 'guess', word: game.state.target })).toMatchObject({
      ok: false,
      reason: 'Locked out for 5s',
    });

    game.advance(5000);
    expect(game.act(1, { type: 'guess', word: decoys[0]! })).toMatchObject({ ok: false });
    game.act(1, { type: 'guess', word: decoys[1]! });
    expect(game.state.lockedUntil).toBe(5000 + 10000);
    game.advance(10000);
    game.act(1, { type: 'guess', word: game.state.target });
    expect(game.solved).toBe(true);
  });

  it('shares lockouts between two Guessers', () => {
    const game = startPuzzle(puzzle, { players: 3, hidden });
    game.act(1, { type: 'guess', word: otherWord(game.state) });
    expect(game.act(2, { type: 'guess', word: game.state.target })).toMatchObject({ ok: false });
    expect(game.view(2)).toMatchObject({ wrong: game.state.wrong });
  });

  it('rejects guesses from the Drawer, off the list, or malformed', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    expect(game.act(0, { type: 'guess', word: game.state.target })).toMatchObject({ ok: false });
    expect(game.act(1, { type: 'guess', word: 'banana' })).toMatchObject({ ok: false });
    expect(game.act(1, { type: 'guess', word: 42 } as never)).toMatchObject({ ok: false });
    expect(game.solved).toBe(false);
  });

  it('rotates the Drawer with the round', () => {
    const game = startPuzzle(puzzle, { players: 2, roundIndex: 1 });
    expect(game.view(0).role).toBe('guesser');
    expect(game.view(1).role).toBe('drawer');
  });

  it('reveals the word and the picture to everyone at the end', () => {
    const game = startPuzzle(puzzle, { players: 2, hidden });
    game.act(1, { type: 'guess', word: otherWord(game.state) });
    for (const seat of [0, 1]) {
      const reveal = game.reveal(seat) as RevealView;
      expect(reveal).toMatchObject({ role: 'reveal', word: game.state.target, solved: false });
      expect(reveal.picture).toBe(readPicture(game.state.picture));
      expect(reveal.wrong).toEqual(game.state.wrong);
    }
  });

  it('builds from any valid pack, and refuses a pack with nothing to draw', () => {
    const pack: Cluster[] = [
      {
        id: 'tiny',
        words: ['a', 'b', 'c', 'd', 'e', 'f'],
        pictures: { c: ['fog-01.svg'] },
      },
    ];
    const game = startPuzzle(createSplitHairs(pack), { players: 2 });
    expect(game.state).toMatchObject({ target: 'c', picture: 'fog-01.svg' });
    expect(() => createSplitHairs([{ ...pack[0]!, pictures: {} }])).toThrow();
  });
});

describe('split hairs content', () => {
  it('ships a valid starter pack of about fifteen clusters', () => {
    expect(validatePack(clusters)).toEqual([]);
    expect(clusters.length).toBeGreaterThanOrEqual(15);
    for (const c of clusters) {
      expect(c.words.length, c.id).toBeGreaterThanOrEqual(MIN_WORDS);
      expect(c.words.length, c.id).toBeLessThanOrEqual(LIST_SIZE.max);
      for (const w of c.words) expect(c.pictures[w]?.length, `${c.id}: ${w}`).toBeGreaterThan(0);
    }
  });

  it('strips everything readable from pictures', () => {
    const svg = sanitizeSvg(
      '<?xml version="1.0"?>\n<!-- the word is sad -->\n<svg viewBox="0 0 10 10" id="sad" ' +
        'inkscape:label="sad"><title>sad</title><desc>very sad</desc><g class="sad">' +
        '<circle r="1"/></g></svg>',
    );
    expect(svg).toBe('<svg viewBox="0 0 10 10"><g><circle r="1"/></g></svg>');
  });

  it('catches pictures that could give the word away', () => {
    const errors = validatePack([
      { id: 'Bad Id', words: ['sad', 'sad'], pictures: { happy: ['nope.svg'] } },
    ]);
    expect(errors.join('\n')).toMatch(/kebab-case/);
    expect(errors.join('\n')).toMatch(/at least 6 words/);
    expect(errors.join('\n')).toMatch(/repeats a word/);
    expect(errors.join('\n')).toMatch(/not in words/);
    expect(errors.join('\n')).toMatch(/missing picture/);
  });
});
