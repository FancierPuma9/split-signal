import { MAX_NAME_LENGTH, ROOM_CODE_LENGTH, normalizeRoomCode } from '@split-signal/shared';
import { useState, type FormEvent } from 'react';
import type { GameActions } from '../game/useGame';
import { codeFromUrl } from '../game/useGame';
import { storage } from '../game/storage';

export function Home({ actions, connected }: { actions: GameActions; connected: boolean }) {
  const [name, setName] = useState(storage.name);
  const [code, setCode] = useState(() => codeFromUrl() ?? '');
  const trimmed = name.trim();
  const validCode = normalizeRoomCode(code);
  const savedSeats = validCode ? storage.savedSeats(validCode) : [];

  const join = (e: FormEvent) => {
    e.preventDefault();
    if (trimmed && validCode) actions.join(validCode, trimmed);
  };

  return (
    <div className="home">
      <div className="hero">
        <h2>Solve it together. Talk about it weirdly.</h2>
        <p className="muted">
          Team up, race the other teams in the room, and get through puzzles where the catch is
          always how you're allowed to communicate.
        </p>
      </div>

      <div className="card home-card">
        {validCode &&
          savedSeats.map((seat) => (
            <div className="rejoin" key={seat.token}>
              <span>
                You have a seat in <strong>{validCode}</strong> as {seat.name}.
              </span>
              <button disabled={!connected} onClick={() => actions.rejoin(validCode, seat.token)}>
                Rejoin
              </button>
            </div>
          ))}
        <label htmlFor="name">Your name</label>
        <input
          id="name"
          autoFocus
          maxLength={MAX_NAME_LENGTH}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Display name"
        />

        <button disabled={!trimmed || !connected} onClick={() => actions.create(trimmed)}>
          Create a room
        </button>

        <div className="divider">
          <span>or join one</span>
        </div>

        <form className="join-row" onSubmit={join}>
          <input
            aria-label="Room code"
            className="code-input"
            maxLength={ROOM_CODE_LENGTH}
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="CODE"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="submit"
            className="secondary"
            disabled={!trimmed || !validCode || !connected}
          >
            Join
          </button>
        </form>
        {code.length === ROOM_CODE_LENGTH && !validCode && (
          <p className="small muted">Room codes use consonants only.</p>
        )}
      </div>
      <footer className="home-footer small muted">
        <a href="https://github.com/FancierPuma9/split-signal">Open source on GitHub</a>
        <span aria-hidden="true">·</span>
        <a href="/privacy.html">Privacy</a>
      </footer>
    </div>
  );
}
