import {
  DEFAULT_SIGNAL_COOLDOWN_MS,
  allowedSignals,
  describeComms,
  isClipRule,
  type MatchView,
  type RoundSummary,
  type TeamRoundResult,
} from '@split-signal/shared';
import { useCallback, useMemo, useState } from 'react';
import type { GameState } from '../game/reducer';
import type { GameActions } from '../game/useGame';
import { PuzzleHost } from '../puzzle/PuzzleHost';
import { formatTime, useCountdown } from '../puzzle/useCountdown';
import { ClipAutoPlayer, ClipBar } from './ClipBar';
import { CommsBanner } from './CommsBanner';
import { SignalBar } from './SignalBar';

interface MatchProps {
  match: NonNullable<GameState['match']>;
  puzzleView: GameState['puzzleView'];
  reveal: GameState['reveal'];
  signals: GameState['signals'];
  clips: GameState['clips'];
  comms: GameState['comms'];
  recording: boolean;
  meId: string;
  isHost: boolean;
  actions: GameActions;
}

export function Match({
  match,
  puzzleView,
  reveal,
  signals,
  clips,
  comms: commsState,
  recording,
  meId,
  isHost,
  actions,
}: MatchProps) {
  const { view } = match;
  const [hearing, setHearing] = useState<string | null>(null);
  const running = !view.paused && view.phaseRemainingMs !== null;
  const remainingMs = useCountdown(view.phaseRemainingMs ?? 0, match.receivedAt, running);
  const myTeam = view.teams.find((t) => t.players.some((p) => p.id === meId));
  const me = myTeam?.players.find((p) => p.id === meId);
  const { comms } = view.puzzle.manifest;
  const allowed = useMemo(() => allowedSignals(comms), [comms]);
  const signalProps = useMemo(
    () => ({ allowed, send: actions.signal, incoming: signals }),
    [allowed, actions.signal, signals],
  );
  const maxClipSeconds = isClipRule(comms) ? comms.maxSeconds : null;
  const recordClip = useCallback(() => {
    if (maxClipSeconds !== null) void actions.recordClip(maxClipSeconds);
  }, [actions, maxClipSeconds]);
  const clipProps = useMemo(
    () =>
      maxClipSeconds === null
        ? undefined
        : {
            record: () => actions.recordClip(maxClipSeconds),
            stop: actions.stopClip,
            recording,
            incoming: clips,
          },
    [maxClipSeconds, actions, recording, clips],
  );
  const fadeMs = comms.type === 'draw' ? comms.fadeMs : null;
  const drawProps = useMemo(
    () =>
      fadeMs === null
        ? undefined
        : { fadeMs, send: actions.draw, subscribe: actions.subscribeDraw },
    [fadeMs, actions],
  );
  // The shell's signal bar is for free-form signals. Clip rules put 'repeat' in the puzzle's own
  // UI, and signals the puzzle consumes itself (relay: false) need the puzzle's targeting UI.
  const showSignalBar =
    comms.type !== 'clips' && !(comms.type === 'signals' && comms.relay === false);

  return (
    <div className="match">
      <Hud view={view} remainingMs={remainingMs} myTeamId={myTeam?.id} />

      <div className="match-body">
        {view.phase === 'intro' && <Intro view={view} />}
        {view.phase === 'countdown' && (
          <div className="countdown">{Math.max(1, Math.ceil(remainingMs / 1000))}</div>
        )}
        {view.phase === 'playing' && myTeam && me && (
          <div className="puzzle">
            {puzzleView ? (
              <PuzzleHost
                key={view.round}
                puzzleId={view.puzzle.id}
                view={puzzleView.value}
                send={actions.act}
                signals={signalProps}
                {...(clipProps ? { clips: clipProps } : {})}
                {...(drawProps ? { draw: drawProps } : {})}
                comms={commsState}
                timer={{ remainingMs, totalMs: view.phaseTotalMs ?? 0 }}
                me={me}
                team={{ id: myTeam.id, name: myTeam.name, players: myTeam.players }}
              />
            ) : (
              <p className="muted">Loading…</p>
            )}
            {myTeam.round.solved && (
              <div className="solved-banner">
                {view.puzzle.manifest.winCondition === 'compare' ? 'Done!' : 'Solved!'}{' '}
                {formatResult(myTeam.round, view.puzzle.manifest.winCondition)}
                {view.teams.some((t) => !t.round.solved) && ' · waiting for the other teams'}
              </div>
            )}
          </div>
        )}
        {view.phase === 'playing' && myTeam && !myTeam.round.solved && (
          <CommsBanner rule={comms} comms={commsState} meId={meId} paused={Boolean(view.paused)} />
        )}
        {view.phase === 'playing' &&
          myTeam &&
          !myTeam.round.solved &&
          (comms.type === 'delayed-clips' || comms.type === 'budget-clips') && (
            <>
              <ClipBar
                rule={comms}
                comms={commsState}
                meId={meId}
                nameOf={(id) => playerName(view, id)}
                recording={recording}
                hearing={hearing}
                onRecord={recordClip}
                onStop={actions.stopClip}
              />
              <ClipAutoPlayer clips={clips} onHearing={setHearing} />
            </>
          )}
        {view.phase === 'playing' && myTeam && !myTeam.round.solved && showSignalBar && (
          <SignalBar
            allowed={allowed}
            cooldownMs={
              (comms.type === 'signals' ? comms.cooldownMs : undefined) ??
              DEFAULT_SIGNAL_COOLDOWN_MS
            }
            incoming={signals}
            meId={meId}
            nameOf={(id) => playerName(view, id)}
            onSend={actions.signal}
          />
        )}
        {view.phase === 'scoreboard' && (
          <Scoreboard view={view} round={view.history.at(-1)} remainingMs={remainingMs} />
        )}
        {view.phase === 'scoreboard' && reveal?.round === view.round && myTeam && me && (
          <div className="puzzle reveal">
            <PuzzleHost
              key={`reveal-${view.round}`}
              puzzleId={view.puzzle.id}
              view={reveal.value}
              send={noop}
              signals={NO_SIGNALS}
              comms={commsState}
              timer={{ remainingMs: 0, totalMs: view.puzzle.manifest.timeLimitSeconds * 1000 }}
              me={me}
              team={{ id: myTeam.id, name: myTeam.name, players: myTeam.players }}
            />
          </div>
        )}
        {view.phase === 'finished' && <Results view={view} isHost={isHost} actions={actions} />}
      </div>

      {view.paused && view.phase !== 'finished' && (
        <div className="overlay">
          <div className="card overlay-card">
            <h3>Paused</h3>
            <p>
              Waiting for {view.paused.waitingFor.map((id) => playerName(view, id)).join(', ')} to
              reconnect…
            </p>
            <button className="danger" onClick={actions.surrender}>
              Surrender match
            </button>
            <p className="small muted">
              Surrendering ends the whole match with the current scores.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function playerName(view: MatchView, id: string): string {
  for (const team of view.teams) {
    const player = team.players.find((p) => p.id === id);
    if (player) return player.name;
  }
  return 'someone';
}

/** Race rounds are decided on time alone, so moves are only shown for compare rounds. */
const noop = () => {};
const NO_SIGNALS = { allowed: [], send: noop, incoming: [] };

function formatResult(result: TeamRoundResult, winCondition: 'race' | 'compare'): string {
  const parts: string[] = [];
  if (result.points !== undefined) parts.push(`${result.points} pts`);
  if (winCondition === 'compare' && result.moves !== undefined) {
    parts.push(`${result.moves} ${result.moves === 1 ? 'move' : 'moves'}`);
  }
  if (result.elapsedMs !== undefined) parts.push(formatTime(result.elapsedMs));
  return parts.join(' · ');
}

function Hud({
  view,
  remainingMs,
  myTeamId,
}: {
  view: MatchView;
  remainingMs: number;
  myTeamId: string | undefined;
}) {
  return (
    <header className="hud">
      <div>
        <span className="muted small">
          Round {Math.min(view.round + 1, view.totalRounds)} of {view.totalRounds}
        </span>
        <h2>{view.phase === 'finished' ? 'Final results' : view.puzzle.manifest.name}</h2>
        {view.phase !== 'finished' && (
          <span className="comms">{describeComms(view.puzzle.manifest.comms)}</span>
        )}
      </div>
      <div className="hud-right">
        {view.phase === 'playing' && <div className="timer">{formatTime(remainingMs)}</div>}
        <ul className="score-chips">
          {view.teams.map((team) => (
            <li
              key={team.id}
              className={`chip team-${team.id}${team.id === myTeamId ? ' mine' : ''}`}
              title={team.players.map((p) => p.name).join(', ')}
            >
              {team.name} <strong>{team.score}</strong>
              {view.phase === 'playing' && team.round.solved && ' ✓'}
            </li>
          ))}
        </ul>
      </div>
    </header>
  );
}

function Intro({ view }: { view: MatchView }) {
  const { manifest } = view.puzzle;
  return (
    <div className="card intro">
      <span className="muted">
        Round {view.round + 1} of {view.totalRounds}
      </span>
      <h2>{manifest.name}</h2>
      <p>{manifest.description}</p>
      <ul className="intro-facts">
        <li>{describeComms(manifest.comms)}</li>
        <li>
          {manifest.goal ??
            (manifest.winCondition === 'race'
              ? 'Race: the first team to finish wins'
              : 'Fewest moves wins (ties go to the faster team)')}
        </li>
        <li>Time limit: {formatTime(manifest.timeLimitSeconds * 1000)}</li>
      </ul>
    </div>
  );
}

function Scoreboard({
  view,
  round,
  remainingMs,
}: {
  view: MatchView;
  round: RoundSummary | undefined;
  remainingMs: number;
}) {
  if (!round) return null;
  const teamName = (id: string | null) => view.teams.find((t) => t.id === id)?.name ?? '';
  const headline =
    round.outcome === 'won'
      ? `${teamName(round.winnerTeamId)} wins the round!`
      : round.outcome === 'tie'
        ? 'A tie: no point awarded'
        : 'Nobody solved it';
  const last = round.round + 1 >= view.totalRounds;

  return (
    <div className="card scoreboard">
      <span className="muted">
        {round.puzzleName} · round {round.round + 1}
      </span>
      <h2>{headline}</h2>
      <table>
        <thead>
          <tr>
            <th>Team</th>
            <th>This round</th>
            <th>Points</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {view.teams.map((team) => {
            const result = round.results.find((r) => r.teamId === team.id);
            return (
              <tr key={team.id} className={team.id === round.winnerTeamId ? 'winner' : ''}>
                <td>
                  <span className={`dot team-${team.id}`} /> {team.name}
                </td>
                <td>
                  {result?.solved || result?.points !== undefined
                    ? formatResult(result, round.winCondition)
                    : 'Not solved'}
                </td>
                <td>+{round.points[team.id] ?? 0}</td>
                <td>{team.score}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="small muted">
        {last ? 'Final results' : 'Next round'} in {Math.ceil(remainingMs / 1000)}s
      </p>
    </div>
  );
}

function Results({
  view,
  isHost,
  actions,
}: {
  view: MatchView;
  isHost: boolean;
  actions: GameActions;
}) {
  const standings = view.standings ?? [];
  const top = standings.filter((s) => s.rank === 1);
  const teamName = (id: string) => view.teams.find((t) => t.id === id)?.name ?? id;
  const headline =
    top.length === 1 && top[0]
      ? `${teamName(top[0].teamId)} wins!`
      : `It's a draw between ${top.map((s) => teamName(s.teamId)).join(' and ')}`;
  const surrendered = view.endedBy === 'surrender';

  return (
    <div className="card results">
      {surrendered && <span className="muted">The match was surrendered</span>}
      <h2>{headline}</h2>
      <ol className="standings">
        {standings.map((s) => (
          <li key={s.teamId}>
            <span className="rank">{s.rank}</span>
            <span className={`dot team-${s.teamId}`} /> {teamName(s.teamId)}
            <strong>{s.score}</strong>
          </li>
        ))}
      </ol>
      <div className="results-actions">
        {!surrendered && isHost && (
          <>
            <button onClick={actions.playAgain}>Play again</button>
            <button className="secondary" onClick={actions.backToLobby}>
              Back to lobby
            </button>
          </>
        )}
        {!surrendered && !isHost && <p className="muted">Waiting for the host…</p>}
        <button className="link" onClick={actions.leave}>
          Leave room
        </button>
      </div>
    </div>
  );
}
