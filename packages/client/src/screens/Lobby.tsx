import { LOBBY_LIMITS, type RoomView } from '@split-signal/shared';
import { useState } from 'react';
import type { GameActions } from '../game/useGame';

interface LobbyProps {
  room: RoomView;
  meId: string;
  actions: GameActions;
}

export function Lobby({ room, meId, actions }: LobbyProps) {
  const isHost = room.hostId === meId;
  const nameOf = new Map(room.players.map((p) => [p.id, p]));
  const seated = new Set(room.teams.flatMap((t) => t.seats));
  const unseated = room.players.filter((p) => !seated.has(p.id));

  return (
    <div className="lobby">
      <RoomCode code={room.code} />

      <div className="teams">
        {room.teams.map((team) => (
          <section key={team.id} className={`card team team-${team.id}`}>
            <h3>{team.name}</h3>
            <ol className="seats">
              {team.seats.map((playerId, seat) => {
                const player = playerId ? nameOf.get(playerId) : undefined;
                if (!player) {
                  return (
                    <li key={seat}>
                      <button
                        className="seat-empty"
                        disabled={room.locked}
                        onClick={() => actions.sit(team.id, seat)}
                      >
                        Sit here
                      </button>
                    </li>
                  );
                }
                const mine = player.id === meId;
                return (
                  <li key={seat} className={`seat-taken${player.connected ? '' : ' away'}`}>
                    <span>
                      {player.name}
                      {player.id === room.hostId && <span className="muted small"> ★ host</span>}
                      {mine && <span className="muted"> (you)</span>}
                      {!player.connected && <span className="muted"> · reconnecting</span>}
                    </span>
                    {mine && !room.locked && (
                      <button className="link" onClick={() => actions.sit(null)}>
                        Stand up
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>

      {unseated.length > 0 && (
        <p className="muted">
          Not seated yet:{' '}
          {unseated.map((p) => (p.id === meId ? `${p.name} (you)` : p.name)).join(', ')}
        </p>
      )}

      <section className="card settings">
        <h3>Match settings</h3>
        <Stepper
          label="Teams"
          value={room.settings.teamCount}
          min={1}
          max={LOBBY_LIMITS.maxTeams}
          disabled={!isHost || room.locked}
          onChange={(teamCount) => actions.settings({ teamCount })}
        />
        <Stepper
          label="Players per team"
          value={room.settings.maxPlayersPerTeam}
          min={1}
          max={LOBBY_LIMITS.maxPlayersPerTeam}
          disabled={!isHost || room.locked}
          onChange={(maxPlayersPerTeam) => actions.settings({ maxPlayersPerTeam })}
        />
        {!room.settings.playlist && (
          <Stepper
            label="Rounds"
            value={room.settings.rounds}
            min={LOBBY_LIMITS.minRounds}
            max={LOBBY_LIMITS.maxRounds}
            disabled={!isHost}
            onChange={(rounds) => actions.settings({ rounds })}
          />
        )}
      </section>

      <PuzzlePicker
        room={room}
        isHost={isHost}
        onChange={(playlist) => actions.settings({ playlist })}
      />

      <div className="lobby-actions">
        {isHost ? (
          <>
            <button className="secondary" onClick={() => actions.lock(!room.locked)}>
              {room.locked ? 'Unlock teams' : 'Lock teams'}
            </button>
            <button disabled={room.startBlockers.length > 0} onClick={actions.start}>
              Start match
            </button>
          </>
        ) : (
          <p className="muted">
            {room.locked ? 'Teams are locked. ' : ''}Waiting for the host to start…
          </p>
        )}
        <button className="link leave" onClick={actions.leave}>
          Leave room
        </button>
      </div>
      {isHost && room.startBlockers.length > 0 && (
        <ul className="blockers small muted">
          {room.startBlockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface PuzzlePickerProps {
  room: RoomView;
  isHost: boolean;
  onChange: (playlist: string[] | null) => void;
}

/** The host's lineup of puzzles, or a random draw ("Surprise us"). Everyone sees it. */
function PuzzlePicker({ room, isHost, onChange }: PuzzlePickerProps) {
  const { playlist, rounds } = room.settings;
  const byId = new Map(room.puzzles.map((p) => [p.id, p]));
  // Whether a puzzle fits only means something once every team has someone in it.
  const seated = room.teams.every((t) => t.seats.some((s) => s !== null));
  const fitting = room.puzzles.filter((p) => p.fits).length;
  const full = (playlist?.length ?? 0) >= LOBBY_LIMITS.maxRounds;
  const roundCount = playlist?.length ?? rounds;

  return (
    <section className="card picker">
      <div className="picker-head">
        <h3>Puzzles</h3>
        <span className="muted small">{roundCount === 1 ? '1 round' : `${roundCount} rounds`}</span>
        {isHost && playlist && (
          <button className="link" onClick={() => onChange(null)}>
            Surprise us instead
          </button>
        )}
      </div>

      {playlist ? (
        <ol className="lineup">
          {playlist.map((id, i) => {
            const puzzle = byId.get(id);
            const name = puzzle?.name ?? id;
            const reason = seated && puzzle && !puzzle.fits ? puzzle.reason : undefined;
            return (
              <li key={i} className={reason ? 'misfit' : undefined}>
                <span className="lineup-number">{i + 1}</span>
                <span className="lineup-name">
                  {name}
                  {reason && <small>{reason}</small>}
                </span>
                {isHost && (
                  <button
                    className="link"
                    aria-label={`Remove ${name} from round ${i + 1}`}
                    onClick={() => onChange(playlist.filter((_, j) => j !== i))}
                  >
                    ✕
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="small muted">
          Surprise us: each round is drawn at random from{' '}
          {seated
            ? `the ${fitting === 1 ? 'one puzzle' : `${fitting} puzzles`} that fit these teams.`
            : 'the puzzles that fit your teams.'}
        </p>
      )}

      <details className="catalog">
        <summary>
          {!isHost
            ? `All ${room.puzzles.length} puzzles`
            : playlist
              ? 'Add another'
              : 'Pick the puzzles yourself'}
        </summary>
        {isHost && (
          <p className="small muted">
            Tap to add a round. Repeats are fine; rounds play in this order.
          </p>
        )}
        <ul className="catalog-list">
          {room.puzzles.map((puzzle) => {
            const reason = seated && !puzzle.fits ? puzzle.reason : undefined;
            const label = (
              <>
                <span>{puzzle.name}</span>
                {reason && <small>{reason}</small>}
              </>
            );
            return (
              <li key={puzzle.id} className={reason ? 'misfit' : undefined}>
                {isHost ? (
                  <button
                    className="secondary"
                    title={puzzle.description}
                    disabled={full}
                    onClick={() => onChange([...(playlist ?? []), puzzle.id])}
                  >
                    {label}
                  </button>
                ) : (
                  <div title={puzzle.description}>{label}</div>
                )}
              </li>
            );
          })}
        </ul>
        {isHost && full && (
          <p className="small muted">
            That&apos;s the most a match can hold ({LOBBY_LIMITS.maxRounds} rounds).
          </p>
        )}
      </details>
    </section>
  );
}

function RoomCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}/${code}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked; the code is on screen anyway.
    }
  };
  return (
    <div className="room-code">
      <span className="muted">Room code</span>
      <strong>{code}</strong>
      <button className="link" onClick={copy}>
        {copied ? 'Link copied' : 'Copy invite link'}
      </button>
    </div>
  );
}

interface StepperProps {
  label: string;
  value: number;
  min: number;
  max: number;
  disabled: boolean;
  onChange: (value: number) => void;
}

function Stepper({ label, value, min, max, disabled, onChange }: StepperProps) {
  return (
    <div className="stepper">
      <span>{label}</span>
      <div className="stepper-controls">
        <button
          className="secondary"
          aria-label={`Fewer ${label.toLowerCase()}`}
          disabled={disabled || value <= min}
          onClick={() => onChange(value - 1)}
        >
          −
        </button>
        <strong>{value}</strong>
        <button
          className="secondary"
          aria-label={`More ${label.toLowerCase()}`}
          disabled={disabled || value >= max}
          onClick={() => onChange(value + 1)}
        >
          +
        </button>
      </div>
    </div>
  );
}
