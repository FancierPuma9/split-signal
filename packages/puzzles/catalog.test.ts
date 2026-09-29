import { validateManifest } from '@split-signal/shared';
import { describe, expect, it } from 'vitest';
import { clientPuzzleIds } from './client';
import { devPuzzles, findPuzzle, puzzles } from './index';

const all = [...puzzles, ...devPuzzles];

describe('puzzle catalog', () => {
  it('has valid, unique manifests', () => {
    const ids = all.map((p) => p.manifest.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of all) {
      expect(validateManifest(p.manifest), p.manifest.id).toEqual([]);
    }
  });

  it('has a client.tsx for every registered puzzle, in a folder named after its id', () => {
    const registered = all.map((p) => p.manifest.id).sort();
    expect([...clientPuzzleIds].sort()).toEqual(registered);
  });

  it('gives every clips puzzle an onClip hook', () => {
    for (const p of all) {
      if (p.manifest.comms.type === 'clips') expect(p.onClip, p.manifest.id).toBeTypeOf('function');
    }
  });

  it('keeps dev puzzles out of the match catalog but findable', () => {
    expect(puzzles.map((p) => p.manifest.id)).not.toContain('press-the-button');
    expect(findPuzzle('press-the-button')?.manifest.name).toBe('Press the Button');
    expect(findPuzzle('sliding-grid')?.manifest.name).toBe('Sliding Grid');
    expect(findPuzzle('nope')).toBeUndefined();
  });
});
