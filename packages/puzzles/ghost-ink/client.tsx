import type { PuzzleClientProps } from '@split-signal/shared';
import { useRef, useState, type PointerEvent, type ReactNode, type Ref } from 'react';
import { FadingCanvas } from '../lib/FadingCanvas';
import styles from './client.module.css';
import { ASPECT, PALETTE, objectById } from './scene';
import type { Action, DrawerView, PlacerView, Point, Result, View } from './types';

type Draw = NonNullable<PuzzleClientProps<View, Action>['draw']>;

export default function GhostInk({ view, send, draw }: PuzzleClientProps<View, Action>) {
  if (view.result) return <ResultPanel result={view.result} placed={view.placed} />;
  if (!draw) return null;
  return view.role === 'drawer' ? (
    <Drawer view={view} draw={draw} />
  ) : (
    <Placer view={view} send={send} draw={draw} />
  );
}

function Drawer({ view, draw }: { view: DrawerView; draw: Draw }) {
  const placed = Object.keys(view.placed).length;
  return (
    <div className={styles.root}>
      <p className={styles.hint}>
        Get your team to rebuild this scene. Draw on it: your ink fades after a second.
      </p>
      <FadingCanvas
        canDraw
        draw={draw}
        aspect={ASPECT}
        className={styles.stage}
        overlay={
          <Board>
            {Object.entries(view.target).map(([id, at]) => (
              <Token key={id} id={id} at={at} />
            ))}
            {Object.entries(view.placed).map(([id, at]) => (
              <Token key={`placed-${id}`} id={id} at={at} ghost />
            ))}
          </Board>
        }
      />
      <p className={styles.hint}>
        Faint objects are where your team has put them ({placed} placed)
        {view.placers > 1 && ` · ${view.ready} of ${view.placers} submitted`}
      </p>
    </div>
  );
}

function Placer({ view, send, draw }: { view: PlacerView; send: (a: Action) => void; draw: Draw }) {
  const board = useRef<HTMLDivElement>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; at: Point } | null>(null);
  // Where we dropped things, shown until the server's copy moves (no snap back while it travels).
  const [dropped, setDropped] = useState<Record<string, { at: Point; was: Point | undefined }>>({});

  const pointAt = (e: PointerEvent): Point => {
    const rect = board.current!.getBoundingClientRect();
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    return {
      x: clamp((e.clientX - rect.left) / rect.width),
      y: clamp((e.clientY - rect.top) / rect.height),
    };
  };

  const positionOf = (id: string, server: Point): Point => {
    if (drag?.id === id) return drag.at;
    const d = dropped[id];
    return d && d.was?.x === server.x && d.was?.y === server.y ? d.at : server;
  };

  const locked = view.submitted;

  return (
    <div className={styles.root}>
      <p className={styles.hint}>
        {armed
          ? `Tap the canvas to put down the ${objectById.get(armed)?.label.toLowerCase()}.`
          : 'Pick objects from the palette and place them where your Drawer shows you.'}
      </p>
      <div className={styles.placerLayout}>
        <FadingCanvas
          canDraw={false}
          draw={draw}
          aspect={ASPECT}
          className={styles.stage}
          overlay={
            <Board
              ref={board}
              className={armed ? styles.armedBoard : undefined}
              onPointerDown={(e) => {
                if (!armed || locked) return;
                send({ type: 'place', objectId: armed, ...pointAt(e) });
                setArmed(null);
              }}
            >
              {Object.entries(view.placed).map(([id, server]) => {
                const mine = view.mine.includes(id) && !locked;
                return (
                  <Token
                    key={id}
                    id={id}
                    at={positionOf(id, server)}
                    className={mine ? styles.draggable : undefined}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      if (!mine) return;
                      e.currentTarget.setPointerCapture(e.pointerId);
                      setDrag({ id, at: pointAt(e) });
                    }}
                    onPointerMove={(e) => {
                      if (drag?.id === id) setDrag({ id, at: pointAt(e) });
                    }}
                    onPointerUp={(e) => {
                      if (drag?.id !== id) return;
                      const at = pointAt(e);
                      send({ type: 'move', objectId: id, ...at });
                      setDropped((d) => ({ ...d, [id]: { at, was: server } }));
                      setDrag(null);
                    }}
                  />
                );
              })}
            </Board>
          }
        />
        <div className={styles.palette}>
          {PALETTE.map((o) => {
            const mine = view.mine.includes(o.id);
            const isPlaced = Object.hasOwn(view.placed, o.id);
            return (
              <button
                key={o.id}
                className={[
                  styles.paletteItem,
                  armed === o.id && styles.armed,
                  isPlaced && styles.used,
                ]
                  .filter(Boolean)
                  .join(' ')}
                disabled={!mine || locked}
                aria-label={isPlaced && mine ? `Take back the ${o.label.toLowerCase()}` : o.label}
                title={mine ? undefined : "Your teammate's"}
                onClick={() => {
                  if (isPlaced) send({ type: 'remove', objectId: o.id });
                  else setArmed(armed === o.id ? null : o.id);
                }}
              >
                <span className={styles.icon}>{o.icon}</span>
                <span>{o.label}</span>
                {isPlaced && mine && <small>take back</small>}
              </button>
            );
          })}
        </div>
      </div>
      <button className={styles.submit} disabled={locked} onClick={() => send({ type: 'submit' })}>
        {locked ? `Waiting for your teammate (${view.ready} of ${view.placers})` : 'Submit'}
      </button>
    </div>
  );
}

function ResultPanel({ result, placed }: { result: Result; placed: Record<string, Point> }) {
  const missing = Object.keys(result.target).filter((id) => !placed[id]);
  return (
    <div className={styles.root}>
      <h3 className={styles.score}>{result.score}% accurate</h3>
      <div className={styles.compare}>
        <figure>
          <figcaption>The scene</figcaption>
          <div className={styles.frame}>
            <Board>
              {Object.entries(result.target).map(([id, at]) => (
                <Token key={id} id={id} at={at} />
              ))}
            </Board>
          </div>
        </figure>
        <figure>
          <figcaption>Your rebuild</figcaption>
          <div className={styles.frame}>
            <Board>
              {Object.keys(result.target).map((id) => {
                const at = placed[id];
                const pct = Math.round((result.accuracy[id] ?? 0) * 100);
                return at && <Token key={id} id={id} at={at} label={`${pct}%`} />;
              })}
            </Board>
          </div>
        </figure>
      </div>
      {missing.length > 0 && (
        <p className={styles.hint}>
          Never placed: {missing.map((id) => objectById.get(id)?.label).join(', ')}
        </p>
      )}
    </div>
  );
}

function Board({
  children,
  className,
  ref,
  onPointerDown,
}: {
  children: ReactNode;
  className?: string | undefined;
  ref?: Ref<HTMLDivElement>;
  onPointerDown?: (e: PointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      ref={ref}
      className={[styles.board, className].filter(Boolean).join(' ')}
      onPointerDown={onPointerDown}
    >
      {children}
    </div>
  );
}

function Token({
  id,
  at,
  ghost,
  label,
  className,
  ...handlers
}: {
  id: string;
  at: Point;
  ghost?: boolean;
  label?: string;
  className?: string | undefined;
  onPointerDown?: (e: PointerEvent<HTMLDivElement>) => void;
  onPointerMove?: (e: PointerEvent<HTMLDivElement>) => void;
  onPointerUp?: (e: PointerEvent<HTMLDivElement>) => void;
}) {
  const object = objectById.get(id);
  return (
    <div
      className={[styles.token, ghost && styles.ghost, className].filter(Boolean).join(' ')}
      style={{ left: `${at.x * 100}%`, top: `${at.y * 100}%` }}
      {...handlers}
    >
      <span className={styles.icon}>{object?.icon}</span>
      <span className={styles.label}>{label ?? object?.label}</span>
    </div>
  );
}
