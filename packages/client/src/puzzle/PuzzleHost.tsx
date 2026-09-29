import { loadPuzzleClient, type PuzzleComponent } from '@split-signal/puzzles/client';
import type { PuzzleClientProps } from '@split-signal/shared';
import { Component, Suspense, use, type ReactNode } from 'react';

const loads = new Map<string, Promise<PuzzleComponent>>();

/** Each puzzle's code is fetched once, the first time a round needs it. */
function load(id: string): Promise<PuzzleComponent> {
  let promise = loads.get(id);
  if (!promise) {
    promise = loadPuzzleClient(id);
    loads.set(id, promise);
  }
  return promise;
}

type HostProps = { puzzleId: string } & PuzzleClientProps<unknown, unknown>;

/** Lazy-loads the current round's puzzle client and mounts it with the standard props. */
export function PuzzleHost(props: HostProps) {
  return (
    <PuzzleErrorBoundary key={props.puzzleId}>
      <Suspense fallback={<p className="muted">Loading puzzle…</p>}>
        <LoadedPuzzle {...props} />
      </Suspense>
    </PuzzleErrorBoundary>
  );
}

function LoadedPuzzle({ puzzleId, ...props }: HostProps) {
  const Puzzle = use(load(puzzleId));
  // Not created during render: load() caches one promise per id, so Puzzle is the same component
  // on every render for a given puzzle.
  // eslint-disable-next-line react-hooks/static-components
  return <Puzzle {...props} />;
}

class PuzzleErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="error-box">
          <strong>This puzzle crashed.</strong>
          <pre>{this.state.error.message}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}
