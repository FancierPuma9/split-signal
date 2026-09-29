import type { PuzzleClientProps } from '@split-signal/shared';
import styles from './client.module.css';
import type { Action, Pick, Trip, View } from './types';

const OUTCOME_TEXT: Record<Trip['outcome'], string> = {
  served: 'delivered',
  empty: 'nobody to take',
  blocked: 'wasted (another car got there)',
  idle: 'stayed put',
};

export default function Elevators({ view, send, timer, team }: PuzzleClientProps<View, Action>) {
  const nameOf = (id: string) => team.players.find((p) => p.id === id)?.name ?? 'someone';
  const floors = Array.from({ length: view.topFloor - 1 }, (_, i) => view.topFloor - i);
  const cars = Array.from({ length: view.elevators }, (_, i) => i);
  const peopleFor = (floor: number) =>
    view.queue.filter((g) => g.floor === floor).reduce((sum, g) => sum + g.size, 0);

  const roundElapsed = timer.totalMs - timer.remainingMs;
  const turnLeft = Math.max(0, view.turnStartedAt + view.turnMs - roundElapsed);
  const waiting = view.teammates - view.teammatesReady;
  const mine = view.myPick;
  const describe = (pick: Pick) =>
    pick === 'idle' ? 'idled' : `sent car ${pick.elevator + 1} to floor ${pick.floor}`;

  const tripAt = (car: number, floor: number) => {
    const trip = view.last?.trips[car];
    return trip && trip.floor === floor ? trip : undefined;
  };

  return (
    <div className={styles.root}>
      <p className={styles.status}>
        {view.solved ? (
          <strong>Lobby cleared in {view.turns} turns!</strong>
        ) : (
          <>
            Turn {view.turns + 1} ·{' '}
            {mine === null ? 'Pick a car and a floor.' : `You ${describe(mine)}.`}
            {waiting > 0 && ` Waiting on ${waiting} teammate${waiting === 1 ? '' : 's'}.`}
          </>
        )}
      </p>
      {!view.solved && (
        <div className={styles.turnBar} aria-label="Time left this turn">
          <div
            className={styles.turnFill}
            style={{ width: `${(turnLeft / view.turnMs) * 100}%` }}
          />
        </div>
      )}

      <div className={styles.layout}>
        <div className={styles.building} role="grid" aria-label="Elevator shafts">
          <div className={styles.floorRow}>
            <span className={styles.floorLabel} />
            {cars.map((car) => (
              <span key={car} className={styles.head}>
                Car {car + 1}
              </span>
            ))}
          </div>
          {floors.map((floor) => (
            <div key={floor} className={styles.floorRow} role="row">
              <span className={styles.floorLabel}>
                Floor {floor}
                <span className={styles.waiting}>{peopleFor(floor) || 'nobody'} waiting</span>
              </span>
              {cars.map((car) => {
                const picked =
                  mine !== null && mine !== 'idle' && mine.elevator === car && mine.floor === floor;
                const trip = tripAt(car, floor);
                const classes = [styles.cell, picked && styles.mine, trip && styles[trip.outcome]];
                return (
                  <button
                    key={car}
                    className={classes.filter(Boolean).join(' ')}
                    disabled={view.solved}
                    onClick={() => send({ type: 'pick', elevator: car, floor })}
                    aria-label={`Send car ${car + 1} to floor ${floor}`}
                    aria-pressed={picked}
                  >
                    {trip ? (trip.outcome === 'served' ? `✓ ${trip.served.length}` : '✗') : ''}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className={styles.lobby}>
          <h4>
            Lobby · {view.queue.length} groups, {view.delivered} delivered
          </h4>
          <ul className={styles.groups}>
            {view.queue.map((group) => (
              <li key={group.id} className={styles.group}>
                → {group.floor} · {group.size} {group.size === 1 ? 'person' : 'people'}
              </li>
            ))}
          </ul>
          <span className="small muted">Each car holds {view.capacity} people.</span>
        </div>
      </div>

      <button className="secondary" onClick={() => send({ type: 'idle' })} disabled={view.solved}>
        Stay idle this turn
      </button>

      {view.last && (
        <p className={styles.summary} role="status">
          Turn {view.last.turn}:{' '}
          {view.last.picks.map((p) => `${nameOf(p.player)} ${describe(p.pick)}`).join(', ')}.{' '}
          {view.last.trips
            .filter((t) => t.outcome !== 'idle')
            .map(
              (t) =>
                `Car ${t.elevator + 1} went to floor ${t.floor}: ${OUTCOME_TEXT[t.outcome]}` +
                (t.outcome === 'served'
                  ? ` ${t.served.length} group${t.served.length === 1 ? '' : 's'}`
                  : ''),
            )
            .join('. ')}
        </p>
      )}
    </div>
  );
}
