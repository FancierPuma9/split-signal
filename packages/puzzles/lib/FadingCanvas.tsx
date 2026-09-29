import type { DrawBatch, PuzzleClientProps } from '@split-signal/shared';
import {
  useEffect,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react';

/** How often pen samples are sent while drawing. */
const BATCH_MS = 50;

interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** performance.now() when this bit of ink was drawn (or arrived). */
  at: number;
  color: string;
}

interface FadingCanvasProps {
  canDraw: boolean;
  /** The draw prop from PuzzleClientProps: fade time, sending, and incoming strokes. */
  draw: NonNullable<PuzzleClientProps<unknown, unknown>['draw']>;
  /** Rendered underneath the ink (a scene, placed objects). Gets clicks when canDraw is false. */
  overlay?: ReactNode;
  /** Width / height. Coordinates are normalized, so any size lines up. Defaults to 4/3. */
  aspect?: number;
  ownColor?: string;
  incomingColor?: string;
  style?: CSSProperties;
}

/**
 * A drawing surface where ink fades: every segment fades out over fadeMs (0 means it never
 * fades). Your own strokes go out as batched samples; teammates' strokes come in through the
 * draw stream and are drawn the same way. Nothing here ever enters puzzle state.
 */
export function FadingCanvas({
  canDraw,
  draw,
  overlay,
  aspect = 4 / 3,
  ownColor = '#4cc9f0',
  incomingColor = '#ffc53d',
  style,
}: FadingCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const segments = useRef<Segment[]>([]);
  const fadeMs = draw.fadeMs;

  // Incoming strokes: join each batch's points, and to the previous batch of the same stroke.
  useEffect(() => {
    const lastPoint = new Map<string, { x: number; y: number }>();
    return draw.subscribe((from, batch: DrawBatch, receivedAt) => {
      const key = `${from}:${batch.strokeId}`;
      const lastDt = batch.points.at(-1)?.dt ?? 0;
      let prev = lastPoint.get(key);
      for (const p of batch.points) {
        const at = receivedAt - (lastDt - p.dt);
        if (prev)
          segments.current.push({
            x1: prev.x,
            y1: prev.y,
            x2: p.x,
            y2: p.y,
            at,
            color: incomingColor,
          });
        prev = { x: p.x, y: p.y };
      }
      if (batch.done) lastPoint.delete(key);
      else if (prev) lastPoint.set(key, prev);
    });
  }, [draw, incomingColor]);

  // Render loop: redraw every frame, dropping ink that has fully faded.
  useEffect(() => {
    let frame = 0;
    const render = () => {
      frame = requestAnimationFrame(render);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d');
      if (!canvas || !ctx) return;
      const { clientWidth: w, clientHeight: h } = canvas;
      const dpr = window.devicePixelRatio || 1;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.lineCap = 'round';
      ctx.lineWidth = 4;
      const now = performance.now();
      if (fadeMs > 0) segments.current = segments.current.filter((s) => now - s.at < fadeMs);
      for (const s of segments.current) {
        ctx.globalAlpha = fadeMs > 0 ? Math.max(0, 1 - (now - s.at) / fadeMs) : 1;
        ctx.strokeStyle = s.color;
        ctx.beginPath();
        ctx.moveTo(s.x1 * w, s.y1 * h);
        ctx.lineTo(s.x2 * w, s.y2 * h);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };
    render();
    return () => cancelAnimationFrame(frame);
  }, [fadeMs]);

  // Local drawing: collect samples, send one batch every BATCH_MS and a final one on release.
  const stroke = useRef<{
    id: string;
    started: number;
    pending: DrawBatch['points'];
    last: { x: number; y: number } | null;
    timer: ReturnType<typeof setInterval> | undefined;
  } | null>(null);

  const point = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  };

  const flush = (done: boolean) => {
    const s = stroke.current;
    if (!s) return;
    if (s.pending.length > 0 || done) {
      const base = s.pending[0]?.dt ?? 0;
      draw.send({
        strokeId: s.id,
        points: s.pending.map((p) => ({ ...p, dt: p.dt - base })),
        done,
      });
      s.pending = [];
    }
  };

  const end = () => {
    const s = stroke.current;
    if (!s) return;
    clearInterval(s.timer);
    flush(true);
    stroke.current = null;
  };

  useEffect(
    () => () => {
      if (stroke.current) clearInterval(stroke.current.timer);
    },
    [],
  );

  return (
    <div style={{ position: 'relative', width: '100%', aspectRatio: aspect, ...style }}>
      {overlay && <div style={{ position: 'absolute', inset: 0 }}>{overlay}</div>}
      <canvas
        ref={canvasRef}
        aria-label={canDraw ? 'Drawing surface' : 'Incoming ink'}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          touchAction: 'none',
          pointerEvents: canDraw ? 'auto' : 'none',
          cursor: canDraw ? 'crosshair' : 'default',
        }}
        onPointerDown={(e) => {
          if (!canDraw) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          const p = point(e);
          const now = performance.now();
          stroke.current = {
            id: crypto.randomUUID().slice(0, 8),
            started: now,
            pending: [{ ...p, dt: 0 }],
            last: p,
            timer: setInterval(() => flush(false), BATCH_MS),
          };
        }}
        onPointerMove={(e) => {
          const s = stroke.current;
          if (!s) return;
          const p = point(e);
          const now = performance.now();
          if (s.last) {
            segments.current.push({
              x1: s.last.x,
              y1: s.last.y,
              x2: p.x,
              y2: p.y,
              at: now,
              color: ownColor,
            });
          }
          s.last = p;
          s.pending.push({ ...p, dt: Math.min(1000, now - s.started) });
        }}
        onPointerUp={end}
        onPointerCancel={end}
      />
    </div>
  );
}
