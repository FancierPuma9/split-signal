import {
  voiceRule,
  type CommsSpec,
  type MatchPhase,
  type PlayerCommsGate,
} from '@split-signal/shared';

export interface VoiceInputs {
  /** Everyone in the room. */
  playerIds: readonly string[];
  /** Present once a match exists. */
  match?: {
    phase: MatchPhase;
    comms: CommsSpec;
    teams: ReadonlyArray<{ id: string; playerIds: readonly string[] }>;
    /** voice-timed: false once the talking window has closed. Defaults to true. */
    voiceOpen?: boolean;
    /** voice-alternating: who is live on each team. */
    activeByTeam?: Record<string, string>;
    /** The puzzle's commsState() overrides, by player (already debounced). */
    gates?: Record<string, PlayerCommsGate>;
  };
}

export interface PeerLink {
  id: string;
  /** false: don't send your mic to this peer. */
  send?: boolean;
  /** false: don't play this peer's audio. */
  hear?: boolean;
  /** Volume (0-1) to play this peer at. */
  gain?: number;
}

/**
 * Who each player may hear, as decided by the server:
 *   lobby and final results: everyone in the room
 *   between rounds (intro, countdown, scoreboard): your own team, to plan privately
 *   while a puzzle is running: whatever its voice rule says:
 *     voice, voice-oneway, voice-gated, voice-replay: team or everyone;
 *     voice-timed: the same until the window closes, then nobody;
 *     voice-alternating: your team, but only the live player sends; no voice rule: nobody.
 *   and then the puzzle's commsState() narrows it per player: a link from X to Y carries sound
 *   only if X may send, Y may receive, and Y can hear X.
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
  const rule = voiceRule(match.comms);

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
    switch (rule?.type) {
      case 'voice':
      case 'voice-oneway':
      case 'voice-gated':
      case 'voice-replay':
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

  const gates = match.phase === 'playing' ? match.gates : undefined;
  if (gates) {
    const gate = (id: string): PlayerCommsGate => gates[id] ?? {};
    for (const [id, peers] of result) {
      result.set(
        id,
        peers.map((link) => applyGates(link, gate(id), gate(link.id), id)),
      );
    }
  }
  return result;
}

/** Narrows the link from `me` to one peer by both players' commsState(). */
function applyGates(link: PeerLink, mine: PlayerCommsGate, theirs: PlayerCommsGate, me: string) {
  const send =
    link.send !== false &&
    mine.send !== false &&
    theirs.receive !== false &&
    theirs.peers?.[me]?.audible !== false;
  const hear =
    link.hear !== false &&
    mine.receive !== false &&
    theirs.send !== false &&
    mine.peers?.[link.id]?.audible !== false;
  const gain = mine.peers?.[link.id]?.gain;
  return {
    id: link.id,
    ...(send ? {} : { send: false }),
    ...(hear ? {} : { hear: false }),
    ...(hear && gain !== undefined ? { gain: Math.max(0, Math.min(1, gain)) } : {}),
  };
}
