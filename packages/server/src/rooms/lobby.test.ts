import { LOBBY_LIMITS, type PuzzleOption } from '@split-signal/shared';
import { describe, expect, it } from 'vitest';
import {
  addPlayer,
  applySettings,
  createRoom,
  findSeat,
  moveToSeat,
  removePlayer,
  setLocked,
  startBlockers,
  teamRosters,
  toRoomView,
  uniqueName,
} from './lobby';
import type { Room, RoomPlayer } from './room';

const player = (id: string, name = id): RoomPlayer => ({
  id,
  name,
  seatToken: `token-${id}`,
  connected: true,
  disconnectedAt: null,
});

const option = (id: string, reason?: string): PuzzleOption =>
  reason
    ? { id, name: id.toUpperCase(), description: '', fits: false, reason }
    : { id, name: id.toUpperCase(), description: '', fits: true };

function room(...ids: string[]): Room {
  const [first = 'host', ...rest] = ids;
  const r = createRoom('BCDF', player(first), 0);
  for (const id of rest) addPlayer(r, player(id));
  return r;
}

describe('lobby', () => {
  it('creates a room with default settings and empty teams', () => {
    const r = room('host');
    expect(r.hostId).toBe('host');
    expect(r.teams.map((t) => t.id)).toEqual(['red', 'blue']);
    expect(r.teams.every((t) => t.seats.length === 2 && t.seats.every((s) => s === null))).toBe(
      true,
    );
  });

  it('dedupes names', () => {
    const r = room('a');
    r.players[0]!.name = 'Sam';
    addPlayer(r, player('b', 'sam'));
    addPlayer(r, player('c', 'Sam'));
    expect(r.players.map((p) => p.name)).toEqual(['Sam', 'sam (2)', 'Sam (3)']);
    expect(uniqueName(r, 'Alex')).toBe('Alex');
  });

  it('caps the room size', () => {
    const r = room('p0');
    for (let i = 1; i < LOBBY_LIMITS.maxPlayers; i++)
      expect(addPlayer(r, player(`p${i}`))).toBeNull();
    expect(addPlayer(r, player('extra'))).toMatch(/full/);
  });

  it('moves players between seats', () => {
    const r = room('a', 'b');
    expect(moveToSeat(r, 'a', 'red')).toBeNull();
    expect(findSeat(r, 'a')).toMatchObject({ team: { id: 'red' }, seat: 0 });
    expect(moveToSeat(r, 'b', 'red', 0)).toMatch(/taken/);
    expect(moveToSeat(r, 'b', 'red', 1)).toBeNull();
    expect(moveToSeat(r, 'a', 'blue', 1)).toBeNull();
    expect(r.teams[0]!.seats).toEqual([null, 'b']);
    expect(r.teams[1]!.seats).toEqual([null, 'a']);
    expect(moveToSeat(r, 'a', null)).toBeNull();
    expect(findSeat(r, 'a')).toBeNull();
  });

  it('rejects full teams and bad seats', () => {
    const r = room('a', 'b', 'c');
    moveToSeat(r, 'a', 'red');
    moveToSeat(r, 'b', 'red');
    expect(moveToSeat(r, 'c', 'red')).toMatch(/full/);
    expect(moveToSeat(r, 'c', 'red', 5)).toMatch(/No such seat/);
    expect(moveToSeat(r, 'c', 'purple')).toMatch(/No such team/);
  });

  it('keeps players seated when teams resize, unseating overflow', () => {
    const r = room('a', 'b', 'c');
    applySettings(r, { maxPlayersPerTeam: 4 });
    moveToSeat(r, 'a', 'red', 1);
    moveToSeat(r, 'b', 'red', 3);
    moveToSeat(r, 'c', 'blue', 0);
    applySettings(r, { maxPlayersPerTeam: 2 });
    expect(r.teams[0]!.seats).toEqual(['a', 'b']);
    applySettings(r, { maxPlayersPerTeam: 1, teamCount: 3 });
    expect(r.teams.map((t) => t.seats)).toEqual([['a'], ['c'], [null]]);
    expect(findSeat(r, 'b')).toBeNull();
  });

  it('validates settings against the engine limits', () => {
    const r = room('a');
    expect(applySettings(r, { teamCount: 5 })).toMatch(/Teams must be/);
    expect(applySettings(r, { maxPlayersPerTeam: 0 })).toMatch(/Players per team/);
    expect(applySettings(r, { rounds: 11 })).toMatch(/Rounds must be/);
    expect(applySettings(r, { playlist: ['nope'] }, new Set(['tap']))).toMatch(/No such puzzle/);
    expect(applySettings(r, { playlist: Array(11).fill('tap') }, new Set(['tap']))).toMatch(
      /up to 10/,
    );
    expect(r.settings).toEqual({ teamCount: 2, maxPlayersPerTeam: 2, rounds: 5, playlist: null });
  });

  it('keeps a playlist, clearing it when emptied', () => {
    const r = room('a');
    const known = new Set(['tap', 'draw']);
    expect(applySettings(r, { playlist: ['tap', 'draw', 'tap'] }, known)).toBeNull();
    expect(r.settings.playlist).toEqual(['tap', 'draw', 'tap']);
    expect(applySettings(r, { playlist: [] }, known)).toBeNull();
    expect(r.settings.playlist).toBeNull();
  });

  it('only locks when everyone is seated and no team is empty', () => {
    const r = room('a', 'b');
    moveToSeat(r, 'a', 'red');
    expect(setLocked(r, true)).toMatch(/b still needs a seat/);
    moveToSeat(r, 'b', 'red');
    expect(setLocked(r, true)).toMatch(/Blue needs at least one player/);
    moveToSeat(r, 'b', 'blue');
    expect(setLocked(r, true)).toBeNull();
    expect(moveToSeat(r, 'b', 'red')).toMatch(/locked/);
    expect(applySettings(r, { teamCount: 3 })).toMatch(/Unlock/);
    // Nobody moves, so these can change while locked.
    expect(applySettings(r, { rounds: 3, teamCount: 2 })).toBeNull();
    expect(applySettings(r, { playlist: ['tap'] }, new Set(['tap']))).toBeNull();
  });

  it('explains why a match cannot start', () => {
    const r = room('a', 'b');
    const some = [option('tap'), option('trio', 'needs 3 players per team')];
    const none = [option('trio', 'needs 3 players per team')];
    expect(startBlockers(r, some)).toEqual([
      'a, b still need a seat',
      'Red and Blue need at least one player',
    ]);
    moveToSeat(r, 'a', 'red');
    moveToSeat(r, 'b', 'blue');
    expect(startBlockers(r, some)).toEqual(['Lock the teams to start']);
    setLocked(r, true);
    expect(startBlockers(r, none)).toEqual(['No puzzles support this team setup']);
    r.players[1]!.connected = false;
    expect(startBlockers(r, some)).toEqual(['Waiting for b to reconnect']);
    r.players[1]!.connected = true;
    expect(startBlockers(r, some)).toEqual([]);
  });

  it('checks every puzzle in the lineup fits', () => {
    const r = room('a', 'b');
    moveToSeat(r, 'a', 'red');
    moveToSeat(r, 'b', 'blue');
    setLocked(r, true);
    const puzzles = [option('tap'), option('trio', 'needs 3 players per team')];
    r.settings.playlist = ['tap', 'trio', 'trio', 'gone'];
    expect(startBlockers(r, puzzles)).toEqual([
      'TRIO needs 3 players per team',
      `"gone" isn't available`,
    ]);
    expect(startBlockers(r, puzzles, ['tap', 'tap'])).toEqual([]);
    expect(startBlockers(r, puzzles, null)).toEqual([]);
  });

  it('hands off host when the host leaves', () => {
    const r = room('a', 'b', 'c');
    moveToSeat(r, 'a', 'red');
    r.players[1]!.connected = false;
    removePlayer(r, 'a');
    expect(r.hostId).toBe('c');
    expect(r.teams[0]!.seats).toEqual([null, null]);
  });

  it('builds rosters in seat order and views without seat tokens', () => {
    const r = room('a', 'b');
    moveToSeat(r, 'b', 'red', 1);
    moveToSeat(r, 'a', 'blue', 1);
    expect(teamRosters(r).map((x) => x.playerIds)).toEqual([['b'], ['a']]);
    const view = toRoomView(r, [option('tap')]);
    expect(JSON.stringify(view)).not.toContain('token-');
    expect(view.puzzles).toEqual([option('tap')]);
  });
});
