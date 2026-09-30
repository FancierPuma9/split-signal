import {
  DEFAULT_LOBBY_SETTINGS,
  LOBBY_LIMITS,
  TEAM_PRESETS,
  type LobbySettings,
  type PuzzleOption,
  type RoomView,
} from '@split-signal/shared';
import type { Room, RoomPlayer, RoomTeam } from './room';

// Lobby rules as plain functions over Room data. Each mutates the room in place and returns an
// error message for the player, or null on success. Host checks happen in the caller.

export function createRoom(code: string, host: RoomPlayer, now: number): Room {
  const settings = { ...DEFAULT_LOBBY_SETTINGS };
  return {
    code,
    hostId: host.id,
    players: [host],
    teams: resizeTeams([], settings),
    settings,
    locked: false,
    status: 'lobby',
    createdAt: now,
    emptySince: null,
  };
}

/** Appends " (2)", " (3)"... if someone in the room already has this name. */
export function uniqueName(room: Room, name: string): string {
  const taken = new Set(room.players.map((p) => p.name.toLowerCase()));
  if (!taken.has(name.toLowerCase())) return name;
  for (let n = 2; ; n++) {
    const candidate = `${name} (${n})`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

export function addPlayer(room: Room, player: RoomPlayer): string | null {
  if (room.status !== 'lobby') return 'That match has already started';
  if (room.players.length >= LOBBY_LIMITS.maxPlayers) return 'That room is full';
  room.players.push({ ...player, name: uniqueName(room, player.name) });
  return null;
}

/** Removes a player entirely, freeing their seat and handing off host if needed. */
export function removePlayer(room: Room, playerId: string): void {
  room.players = room.players.filter((p) => p.id !== playerId);
  for (const team of room.teams) {
    team.seats = team.seats.map((id) => (id === playerId ? null : id));
  }
  if (room.hostId === playerId && room.players.length > 0) {
    const next = room.players.find((p) => p.connected) ?? room.players[0];
    if (next) room.hostId = next.id;
  }
}

export function findSeat(room: Room, playerId: string): { team: RoomTeam; seat: number } | null {
  for (const team of room.teams) {
    const seat = team.seats.indexOf(playerId);
    if (seat !== -1) return { team, seat };
  }
  return null;
}

export function moveToSeat(
  room: Room,
  playerId: string,
  teamId: string | null,
  seat?: number,
): string | null {
  if (room.status !== 'lobby') return 'The match has already started';
  if (room.locked) return 'Teams are locked';

  const current = findSeat(room, playerId);
  if (teamId === null) {
    if (current) current.team.seats[current.seat] = null;
    return null;
  }

  const team = room.teams.find((t) => t.id === teamId);
  if (!team) return 'No such team';
  let target = seat;
  if (target === undefined) {
    if (current?.team === team) return null;
    target = team.seats.indexOf(null);
    if (target === -1) return `${team.name} is full`;
  }
  if (target < 0 || target >= team.seats.length) return 'No such seat';
  const occupant = team.seats[target];
  if (occupant === playerId) return null;
  if (occupant) return 'That seat is taken';

  if (current) current.team.seats[current.seat] = null;
  team.seats[target] = playerId;
  return null;
}

/** `knownPuzzles` are the catalog ids a playlist may use. */
export function applySettings(
  room: Room,
  patch: Partial<LobbySettings>,
  knownPuzzles: ReadonlySet<string> = new Set(),
): string | null {
  if (room.status !== 'lobby') return 'The match has already started';
  const next = { ...room.settings, ...patch };
  // Rounds and the playlist don't move anyone, so they can change with the teams locked.
  const reseats =
    next.teamCount !== room.settings.teamCount ||
    next.maxPlayersPerTeam !== room.settings.maxPlayersPerTeam;
  if (room.locked && reseats) return 'Unlock the teams to change them';
  if (next.teamCount < 1 || next.teamCount > LOBBY_LIMITS.maxTeams) {
    return `Teams must be 1 to ${LOBBY_LIMITS.maxTeams}`;
  }
  if (next.maxPlayersPerTeam < 1 || next.maxPlayersPerTeam > LOBBY_LIMITS.maxPlayersPerTeam) {
    return `Players per team must be 1 to ${LOBBY_LIMITS.maxPlayersPerTeam}`;
  }
  if (next.rounds < LOBBY_LIMITS.minRounds || next.rounds > LOBBY_LIMITS.maxRounds) {
    return `Rounds must be ${LOBBY_LIMITS.minRounds} to ${LOBBY_LIMITS.maxRounds}`;
  }
  if (next.playlist) {
    if (next.playlist.length === 0) next.playlist = null;
    else if (next.playlist.length > LOBBY_LIMITS.maxRounds) {
      return `Pick up to ${LOBBY_LIMITS.maxRounds} puzzles`;
    } else if (!next.playlist.every((id) => knownPuzzles.has(id))) return 'No such puzzle';
    else next.playlist = [...next.playlist];
  }
  room.settings = next;
  if (reseats) room.teams = resizeTeams(room.teams, next);
  return null;
}

/**
 * Builds the team list for new settings, keeping existing players seated where possible. When a
 * team shrinks, its players slide into the remaining seats; anyone who doesn't fit is unseated.
 */
function resizeTeams(teams: RoomTeam[], settings: LobbySettings): RoomTeam[] {
  return TEAM_PRESETS.slice(0, settings.teamCount).map((preset) => {
    const existing = teams.find((t) => t.id === preset.id);
    const seated = existing?.seats ?? [];
    const size = settings.maxPlayersPerTeam;
    const seats: Array<string | null> =
      seated.length <= size || seated.slice(0, size).every((id) => id !== null)
        ? seated.slice(0, size)
        : seated.filter((id) => id !== null).slice(0, size);
    while (seats.length < size) seats.push(null);
    return { id: preset.id, name: preset.name, seats };
  });
}

/** Each team's players in seat order, with empty seats skipped. */
export function teamRosters(room: Room): Array<{ team: RoomTeam; playerIds: string[] }> {
  return room.teams.map((team) => ({
    team,
    playerIds: team.seats.filter((id): id is string => id !== null),
  }));
}

function seatingProblems(room: Room): string[] {
  const problems: string[] = [];
  const unseated = room.players.filter((p) => !findSeat(room, p.id));
  if (unseated.length > 0) {
    const verb = unseated.length === 1 ? 'needs' : 'need';
    problems.push(`${unseated.map((p) => p.name).join(', ')} still ${verb} a seat`);
  }
  const empty = teamRosters(room).filter((r) => r.playerIds.length === 0);
  if (empty.length > 0) {
    const verb = empty.length === 1 ? 'needs' : 'need';
    problems.push(`${empty.map((r) => r.team.name).join(' and ')} ${verb} at least one player`);
  }
  return problems;
}

export function setLocked(room: Room, locked: boolean): string | null {
  if (room.status !== 'lobby') return 'The match has already started';
  if (locked) {
    const problems = seatingProblems(room);
    if (problems.length > 0) return problems.join('. ');
  }
  room.locked = locked;
  return null;
}

/**
 * Reasons the host can't start yet; empty when the match can start. `lineup` is what will be
 * played: the room's playlist by default, or null for a random draw.
 */
export function startBlockers(
  room: Room,
  puzzles: readonly PuzzleOption[],
  lineup: readonly string[] | null = room.settings.playlist,
): string[] {
  if (room.status !== 'lobby') return ['The match has already started'];
  const blockers = seatingProblems(room);
  if (blockers.length === 0 && !room.locked) blockers.push('Lock the teams to start');
  const away = room.players.filter((p) => !p.connected);
  if (away.length > 0) {
    blockers.push(`Waiting for ${away.map((p) => p.name).join(', ')} to reconnect`);
  }
  if (blockers.length > 0) return blockers;
  if (!lineup) {
    if (!puzzles.some((p) => p.fits)) blockers.push('No puzzles support this team setup');
    return blockers;
  }
  for (const id of new Set(lineup)) {
    const puzzle = puzzles.find((p) => p.id === id);
    if (!puzzle) blockers.push(`"${id}" isn't available`);
    else if (!puzzle.fits) blockers.push(`${puzzle.name} ${puzzle.reason ?? "doesn't fit"}`);
  }
  return blockers;
}

export function toRoomView(room: Room, puzzles: readonly PuzzleOption[]): RoomView {
  return {
    code: room.code,
    hostId: room.hostId,
    status: room.status,
    locked: room.locked,
    players: room.players.map((p) => ({ id: p.id, name: p.name, connected: p.connected })),
    teams: room.teams.map((t) => ({ id: t.id, name: t.name, seats: [...t.seats] })),
    settings: { ...room.settings, playlist: room.settings.playlist && [...room.settings.playlist] },
    puzzles: [...puzzles],
    startBlockers: startBlockers(room, puzzles),
  };
}
