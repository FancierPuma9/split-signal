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
        <Stepper
          label="Rounds"
          value={room.settings.rounds}
          min={LOBBY_LIMITS.minRounds}
          max={LOBBY_LIMITS.maxRounds}
          disabled={!isHost || room.locked}
          onChange={(rounds) => actions.settings({ rounds })}
        />
        <p className="small muted">
          {room.teams.some((t) => t.seats.every((s) => s === null))
            ? 'Once every team has players, you’ll see how many puzzles fit.'
            : `${room.eligiblePuzzles === 1 ? '1 puzzle fits' : `${room.eligiblePuzzles} puzzles fit`} these teams.`}{' '}
          Puzzles are picked at random; nobody chooses.
        </p>
        {(room.excludedPuzzles?.length ?? 0) > 0 &&
          !room.teams.some((t) => t.seats.every((s) => s === null)) && (
            <details className="excluded small muted">
              <summary>
                {room.excludedPuzzles?.length === 1
                  ? "1 puzzle doesn't fit"
                  : `${room.excludedPuzzles?.length} puzzles don't fit`}
              </summary>
              <ul>
                {room.excludedPuzzles?.map((p) => (
                  <li key={p.name}>
                    {p.name}: {p.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
      </section>

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
