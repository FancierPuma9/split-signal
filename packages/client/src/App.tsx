import { useGame } from './game/useGame';
import { Home } from './screens/Home';
import { Lobby } from './screens/Lobby';
import { Match } from './screens/Match';
import { VoiceStatus } from './screens/VoiceStatus';

export function App() {
  const { state, voice, recording, actions } = useGame();
  const { session, room, match } = state;
  const inRoom = session && room;
  const nameOf = (id: string) => room?.players.find((p) => p.id === id)?.name ?? 'someone';

  return (
    <div className="app">
      <header className="topbar">
        <h1>Split Signal</h1>
        {room && <span className="badge">Room {room.code}</span>}
        {inRoom && (
          <VoiceStatus
            voice={voice}
            nameOf={nameOf}
            onMute={actions.setMuted}
            onEnableMic={actions.enableMic}
          />
        )}
        <span className={`conn conn-${state.connection}`}>{state.connection}</span>
      </header>

      <main className="main">
        {!inRoom && <Home actions={actions} connected={state.connection === 'open'} />}
        {inRoom && room.status === 'lobby' && (
          <Lobby room={room} meId={session.playerId} actions={actions} />
        )}
        {inRoom && room.status !== 'lobby' && match && (
          <Match
            match={match}
            puzzleView={state.puzzleView}
            signals={state.signals}
            clips={state.clips}
            comms={state.comms}
            recording={recording}
            meId={session.playerId}
            isHost={room.hostId === session.playerId}
            actions={actions}
          />
        )}
      </main>

      {state.notice && (
        <div className="notice" role="status">
          {state.notice.text}
        </div>
      )}
    </div>
  );
}
