import type { PuzzleClientProps } from '@split-signal/shared';
import { useMemo, type CSSProperties, type ReactNode } from 'react';
import styles from './client.module.css';
import { GOING_ONCE_MS, NO_BID_MS, RAISES, SOLD_MS } from './manifest';
import type { Action, Art, View } from './types';

const money = (n: number) => `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US')}`;
const teamColor = (id: string): CSSProperties =>
  ({ '--team': `var(--team-${id}, #9aa1ad)` }) as CSSProperties;

export default function GoingOnce({ view, send, timer }: PuzzleClientProps<View, Action>) {
  const elapsed = timer.totalMs - timer.remainingMs;
  const name = (id: string) => view.players.find((p) => p.id === id)?.name ?? id;
  const teamOf = (id: string) => view.players.find((p) => p.id === id)?.teamId ?? '';
  const high = view.bids.at(-1) ?? null;
  const open = view.phase === 'open';
  const iPassed = view.passed.includes(view.me);
  const secs = (ms: number) => Math.max(0, Math.ceil(ms / 1000));

  let clock: ReactNode = null;
  if (view.phase === 'waiting') {
    clock = `Waiting for the Seller to open the bidding (opens itself in ${secs(view.openBy - elapsed)}s)`;
  } else if (open && !high) {
    clock = `No bids yet: no sale in ${secs((view.openedAt ?? 0) + NO_BID_MS - elapsed)}s`;
  } else if (open && high) {
    const quiet = elapsed - high.at;
    clock = view.goingOnce ? (
      <strong className={styles.going}>Going once… sold in {secs(SOLD_MS - quiet)}s</strong>
    ) : (
      `Going once in ${secs(GOING_ONCE_MS - quiet)}s`
    );
  }

  const roleLine =
    view.role === 'appraiser'
      ? `You’re an Appraiser. It’s worth ${money(view.value ?? 0)}. Everyone can hear you.`
      : view.role === 'seller'
        ? 'You’re the Seller. You don’t know what it’s worth; your partner is bidding blind.'
        : 'You’re a Bidder. Listen to everyone, and work out who’s helping.';

  return (
    <div className={styles.root}>
      <p className={styles.role}>{roleLine}</p>
      <div className={styles.lot}>
        <Painting art={view.art} />
        <div className={styles.side}>
          <p className={styles.caption}>
            <em>{view.art.title}</em>
            <br />
            {view.art.artist}, {view.art.year}
          </p>
          <p className={styles.high}>
            {high ? money(high.amount) : '—'}
            {high && (
              <span style={teamColor(teamOf(high.by))} className={styles.highBy}>
                {name(high.by)}
              </span>
            )}
          </p>
          {clock && <p className={styles.clock}>{clock}</p>}
          <ol className={styles.ladder} reversed>
            {[...view.bids].reverse().map((b, i) => (
              <li key={view.bids.length - i} style={teamColor(teamOf(b.by))}>
                {money(b.amount)} <span>{name(b.by)}</span>
              </li>
            ))}
          </ol>
        </div>
      </div>

      {view.result ? (
        <p className={styles.result}>
          {view.result.winner
            ? `Sold to ${name(view.result.winner)} for ${money(view.result.price!)}. It was worth ${money(view.result.value)}: ${money(view.result.value - view.result.price!)} for ${view.teams.find((t) => t.id === teamOf(view.result!.winner!))?.name}.`
            : `No sale. It was worth ${money(view.result.value)}.`}
        </p>
      ) : view.role === 'bidder' ? (
        <div className={styles.buttons}>
          {RAISES.map((r) => (
            <button
              key={r}
              disabled={!open || iPassed || high?.by === view.me}
              onClick={() => send({ type: 'bid', raise: r })}
            >
              +{r} ({money((high?.amount ?? 0) + r)})
            </button>
          ))}
          <button
            className={styles.pass}
            disabled={!open || iPassed}
            onClick={() => send({ type: 'pass' })}
          >
            {iPassed ? 'Passed' : 'Pass'}
          </button>
        </div>
      ) : view.role === 'seller' ? (
        <div className={styles.buttons}>
          {view.phase === 'waiting' ? (
            <button onClick={() => send({ type: 'open' })}>Open the bidding</button>
          ) : (
            <button
              className={styles.hammer}
              disabled={!view.goingOnce || !high}
              onClick={() => send({ type: 'hammer' })}
            >
              🔨 Sold!
            </button>
          )}
        </div>
      ) : null}

      <ul className={styles.cast}>
        {view.players.map((p) => (
          <li
            key={p.id}
            style={teamColor(p.teamId)}
            className={view.passed.includes(p.id) ? styles.out : ''}
          >
            {p.name} · {p.role}
            {view.passed.includes(p.id) && ' (passed)'}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A small seeded PRNG, so a painting's seed always paints the same picture. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function Painting({ art }: { art: Art }) {
  const shapes = useMemo(() => {
    const r = mulberry32(art.seed);
    const hue = r() * 360;
    const colour = (dh: number, s: number, l: number) => `hsl(${(hue + dh) % 360} ${s}% ${l}%)`;
    const palette = [
      colour(0, 60, 45),
      colour(40, 70, 60),
      colour(180, 45, 35),
      colour(210, 25, 85),
      colour(20, 30, 20),
    ];
    const pick = () => palette[Math.floor(r() * palette.length)]!;
    const out: ReactNode[] = [<rect key="bg" width="200" height="150" fill={colour(30, 25, 80)} />];
    const count = 6 + Math.floor(r() * 6);
    for (let i = 0; i < count; i++) {
      const x = r() * 200;
      const y = r() * 150;
      const size = 15 + r() * 55;
      const kind = r();
      if (kind < 0.35) {
        out.push(<circle key={i} cx={x} cy={y} r={size / 2} fill={pick()} opacity={0.85} />);
      } else if (kind < 0.7) {
        out.push(
          <rect
            key={i}
            x={x - size / 2}
            y={y - size / 3}
            width={size}
            height={size * 0.66}
            fill={pick()}
            opacity={0.85}
            transform={`rotate(${(r() - 0.5) * 60} ${x} ${y})`}
          />,
        );
      } else if (kind < 0.9) {
        out.push(
          <polygon
            key={i}
            points={`${x},${y - size / 2} ${x + size / 2},${y + size / 2} ${x - size / 2},${y + size / 2}`}
            fill={pick()}
            opacity={0.85}
          />,
        );
      } else {
        out.push(
          <line
            key={i}
            x1={x}
            y1={y}
            x2={x + (r() - 0.5) * 160}
            y2={y + (r() - 0.5) * 120}
            stroke={pick()}
            strokeWidth={2 + r() * 5}
          />,
        );
      }
    }
    return out;
  }, [art.seed]);
  return (
    <svg className={styles.painting} viewBox="0 0 200 150" role="img" aria-label={art.title}>
      {shapes}
    </svg>
  );
}
