import { describe, expect, it } from 'vitest';
import { normalizeRoomCode } from './lobby';
import { MAX_NAME_LENGTH, parseClientMessage } from './protocol';

const parse = (value: unknown) => parseClientMessage(JSON.stringify(value));

describe('parseClientMessage', () => {
  it('parses room messages, normalizing names and codes', () => {
    expect(parse({ type: 'room.create', name: '  Ada   Lovelace ' })).toEqual({
      type: 'room.create',
      name: 'Ada Lovelace',
    });
    expect(parse({ type: 'room.join', code: ' bcdf ', name: 'Bo' })).toEqual({
      type: 'room.join',
      code: 'BCDF',
      name: 'Bo',
    });
    expect(parse({ type: 'room.rejoin', code: 'BCDF', seatToken: 'abc' })).toEqual({
      type: 'room.rejoin',
      code: 'BCDF',
      seatToken: 'abc',
    });
    expect(parse({ type: 'room.leave' })).toEqual({ type: 'room.leave' });
  });

  it('truncates long names', () => {
    expect(parse({ type: 'room.create', name: 'x'.repeat(100) })).toEqual({
      type: 'room.create',
      name: 'x'.repeat(MAX_NAME_LENGTH),
    });
  });

  it('parses lobby messages', () => {
    expect(parse({ type: 'lobby.settings', settings: { teamCount: 3, junk: 1 } })).toEqual({
      type: 'lobby.settings',
      settings: { teamCount: 3 },
    });
    expect(parse({ type: 'lobby.seat', teamId: 'red', seat: 1 })).toEqual({
      type: 'lobby.seat',
      teamId: 'red',
      seat: 1,
    });
    expect(parse({ type: 'lobby.seat', teamId: null })).toEqual({
      type: 'lobby.seat',
      teamId: null,
    });
    expect(parse({ type: 'lobby.lock', locked: true })).toEqual({
      type: 'lobby.lock',
      locked: true,
    });
    expect(parse({ type: 'lobby.start' })).toEqual({ type: 'lobby.start' });
  });

  it('parses match messages', () => {
    expect(parse({ type: 'match.action', payload: { x: 1 } })).toEqual({
      type: 'match.action',
      payload: { x: 1 },
    });
    expect(parse({ type: 'match.surrender' })).toEqual({ type: 'match.surrender' });
  });

  it('parses clips and rejects anything that is not base64 audio', () => {
    expect(
      parse({ type: 'comms.clip', mime: 'audio/webm;codecs=opus', data: 'AAAA', durationMs: 1200 }),
    ).toEqual({
      type: 'comms.clip',
      mime: 'audio/webm;codecs=opus',
      data: 'AAAA',
      durationMs: 1200,
    });
    expect(
      parse({ type: 'comms.clip', mime: 'text/html', data: 'AAAA', durationMs: 1 }),
    ).toBeNull();
    expect(
      parse({ type: 'comms.clip', mime: 'audio/webm', data: '<script>', durationMs: 1 }),
    ).toBeNull();
    expect(
      parse({ type: 'comms.clip', mime: 'audio/webm', data: 'AAAA', durationMs: -1 }),
    ).toBeNull();
    expect(
      parse({ type: 'comms.clip', mime: 'audio/webm', data: 'A'.repeat(300_000), durationMs: 1 }),
    ).toBeNull();
  });

  it('parses targeted signals and draw batches', () => {
    expect(parse({ type: 'comms.signal', signal: 'up', to: 'p2' })).toEqual({
      type: 'comms.signal',
      signal: 'up',
      to: 'p2',
    });
    expect(parse({ type: 'comms.signal', signal: 'up', to: 5 })).toBeNull();
    const batch = { strokeId: 's1', points: [{ x: 0.5, y: 0.25, dt: 10 }], done: false };
    expect(parse({ type: 'comms.draw', ...batch })).toEqual({ type: 'comms.draw', ...batch });
    expect(parse({ type: 'comms.draw', ...batch, points: [{ x: 2, y: 0, dt: 0 }] })).toBeNull();
    expect(
      parse({ type: 'comms.draw', ...batch, points: Array(100).fill({ x: 0, y: 0, dt: 0 }) }),
    ).toBeNull();
    expect(
      parse({ type: 'comms.draw', ...batch, points: [{ x: 0, y: 0, dt: 0, junk: 1 }] }),
    ).toEqual({ type: 'comms.draw', ...batch, points: [{ x: 0, y: 0, dt: 0 }] });
  });

  it('parses sign-in, claims and stats, rejecting junk tokens', () => {
    const jwt = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.c2ln';
    const token = 'a'.repeat(43);
    const parse = (m: object) => parseClientMessage(JSON.stringify(m));
    expect(parse({ type: 'auth.google', credential: jwt })).toEqual({
      type: 'auth.google',
      credential: jwt,
    });
    expect(parse({ type: 'auth.resume', token })).toEqual({ type: 'auth.resume', token });
    expect(parse({ type: 'results.claim', claimToken: token })).toEqual({
      type: 'results.claim',
      claimToken: token,
    });
    expect(parse({ type: 'auth.signOut' })).toEqual({ type: 'auth.signOut' });
    expect(parse({ type: 'stats.get' })).toEqual({ type: 'stats.get' });
    expect(parse({ type: 'account.delete' })).toEqual({ type: 'account.delete' });
    for (const bad of [
      { type: 'auth.google', credential: 'not a jwt' },
      { type: 'auth.google', credential: `${jwt}.${'x'.repeat(9000)}` },
      { type: 'auth.resume', token: 'short' },
      { type: 'auth.resume', token: `${token}!` },
      { type: 'results.claim', claimToken: 42 },
    ]) {
      expect(parse(bad), JSON.stringify(bad).slice(0, 60)).toBeNull();
    }
  });

  it('rejects malformed input', () => {
    for (const raw of [
      'not json',
      '[]',
      'null',
      '{"type":"nope"}',
      '{"type":"room.create","name":"   "}',
      '{"type":"room.create","name":42}',
      '{"type":"room.join","code":"AEIO","name":"x"}',
      '{"type":"room.join","code":"BCDFG","name":"x"}',
      '{"type":"room.rejoin","code":"BCDF","seatToken":""}',
      '{"type":"lobby.settings","settings":{"teamCount":1.5}}',
      '{"type":"lobby.seat","teamId":5}',
      '{"type":"lobby.seat","teamId":"red","seat":"1"}',
      '{"type":"lobby.lock","locked":"yes"}',
      '{"type":"match.action"}',
    ]) {
      expect(parseClientMessage(raw), raw).toBeNull();
    }
  });
});

describe('normalizeRoomCode', () => {
  it('accepts codes from the alphabet in any case', () => {
    expect(normalizeRoomCode('bc df')).toBe('BCDF');
  });

  it('rejects vowels, wrong lengths, and other characters', () => {
    expect(normalizeRoomCode('BCDA')).toBeNull();
    expect(normalizeRoomCode('BCD')).toBeNull();
    expect(normalizeRoomCode('BCD1')).toBeNull();
    expect(normalizeRoomCode('BCDY')).toBeNull();
  });
});
