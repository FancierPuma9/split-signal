import type { CommsRule, MatchPhase } from '@split-signal/shared';

export interface VoiceInputs {
  /** Everyone in the room. */
  playerIds: readonly string[];
  /** Present once a match exists. */
  match?: {
    phase: MatchPhase;
    comms: CommsRule;
    teams: ReadonlyArray<{ id: string; playerIds: readonly string[] }>;
    /** voice-timed: false once the talking window has closed. Defaults to true. */
    voiceOpen?: boolean;
    /** voice-alternating: who is live on each team. */
    activeByTeam?: Record<string, string>;
  };
}

export interface PeerLink {
  id: string;
  /** false: don't send your mic to this peer. */
  send?: boolean;
  /** false: don't play this peer's audio. */
  hear?: boolean;
}

/**
 * Who each player may hear, as decided by the server:
 *   lobby and final results: everyone in the room
 *   between rounds (intro, countdown, scoreboard): your own team, to plan privately
 *   while a puzzle is running: whatever its comms rule says:
 *     voice: team or everyone; voice-timed: the same until the window closes, then nobody;
 *     voice-alternating: your team, but only the live player sends; anything else: nobody.
 */
export function voicePeers(inputs: VoiceInputs): Map<string, PeerLink[]> {
  const everyone = [...inputs.playerIds];
  const links = (id: string, pool: readonly string[]): PeerLink[] =>
    pool.filter((p) => p !== id).map((p) => ({ id: p }));
  const result = new Map<string, PeerLink[]>();
  const { match } = inputs;

  if (!match || match.phase === 'finished') {
    for (const id of everyone) result.set(id, links(id, everyone));
    return result;
  }

  const teamOf = new Map<string, { id: string; playerIds: readonly string[] }>();
  for (const team of match.teams) for (const id of team.playerIds) teamOf.set(id, team);
  const matchPlayers = match.teams.flatMap((t) => t.playerIds);

  for (const id of everyone) {
    const team = teamOf.get(id);
    if (!team) {
      result.set(id, []);
      continue;
    }
    if (match.phase !== 'playing') {
      result.set(id, links(id, team.playerIds));
      continue;
    }
    const rule = match.comms;
    switch (rule.type) {
      case 'voice':
        result.set(id, links(id, rule.scope === 'all' ? matchPlayers : team.playerIds));
        break;
      case 'voice-timed': {
        const pool = rule.scope === 'all' ? matchPlayers : team.playerIds;
        result.set(id, match.voiceOpen === false ? [] : links(id, pool));
        break;
      }
      case 'voice-alternating': {
        const active = match.activeByTeam?.[team.id];
        result.set(
          id,
          links(id, team.playerIds).map((peer) => ({
            ...peer,
            ...(active !== id ? { send: false } : {}),
            ...(active !== peer.id ? { hear: false } : {}),
          })),
        );
        break;
      }
      default:
        result.set(id, []);
    }
  }
  return result;
}
