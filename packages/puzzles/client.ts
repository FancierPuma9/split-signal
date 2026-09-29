import type { ComponentType } from 'react';
import type { PuzzleClientProps } from '@split-signal/shared';

// Each puzzle has its own View and Action types; the host only knows it is passing them through.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type PuzzleComponent = ComponentType<PuzzleClientProps<any, any>>;

// Every <puzzle-id>/client.tsx becomes its own lazily loaded chunk.
const loaders = import.meta.glob<{ default: PuzzleComponent }>([
  './*/client.tsx',
  '!./_template/*',
]);

const loadersById = new Map(
  Object.entries(loaders).map(([path, load]) => [path.split('/')[1] ?? path, load]),
);

export const clientPuzzleIds: readonly string[] = [...loadersById.keys()];

export async function loadPuzzleClient(id: string): Promise<PuzzleComponent> {
  const load = loadersById.get(id);
  if (!load) throw new Error(`No client module for puzzle "${id}"`);
  return (await load()).default;
}
