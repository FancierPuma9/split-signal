import { generateKeyPairSync, sign, type JsonWebKey } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { GoogleVerifier, type JwkSet } from './google';

const CLIENT_ID = 'test-client.apps.googleusercontent.com';
const NOW = 1_800_000_000_000;

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...(publicKey.export({ format: 'jwk' }) as JsonWebKey), kid: 'key-1' };
const other = generateKeyPairSync('rsa', { modulusLength: 2048 });

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

function token(
  claims: Record<string, unknown>,
  opts: { kid?: string; key?: typeof privateKey } = {},
) {
  const head = b64({ alg: 'RS256', kid: opts.kid ?? 'key-1', typ: 'JWT' });
  const body = b64({
    iss: 'https://accounts.google.com',
    aud: CLIENT_ID,
    sub: '1234567890',
    name: 'Ada Lovelace',
    iat: NOW / 1000 - 10,
    exp: NOW / 1000 + 3600,
    ...claims,
  });
  const sig = sign('RSA-SHA256', Buffer.from(`${head}.${body}`), opts.key ?? privateKey);
  return `${head}.${body}.${sig.toString('base64url')}`;
}

function verifier(keys: JwkSet['keys'] = [jwk]) {
  let fetches = 0;
  const v = new GoogleVerifier(
    CLIENT_ID,
    async () => {
      fetches++;
      return { keys, maxAgeMs: 60_000 };
    },
    () => NOW,
  );
  return { v, fetches: () => fetches };
}

describe('GoogleVerifier', () => {
  it('accepts a good token and returns who it is', async () => {
    const { v } = verifier();
    await expect(v.verify(token({}))).resolves.toEqual({ sub: '1234567890', name: 'Ada Lovelace' });
  });

  it('rejects tokens for another app, from another issuer, or expired', async () => {
    const { v } = verifier();
    await expect(v.verify(token({ aud: 'someone-else' }))).rejects.toThrow('Wrong audience');
    await expect(v.verify(token({ iss: 'https://evil.example' }))).rejects.toThrow('Wrong issuer');
    await expect(v.verify(token({ exp: NOW / 1000 - 3600 }))).rejects.toThrow('Expired');
    await expect(v.verify(token({ sub: '' }))).rejects.toThrow('No subject');
  });

  it('rejects a forged signature and an unknown key', async () => {
    const { v } = verifier();
    await expect(v.verify(token({}, { key: other.privateKey }))).rejects.toThrow('Bad signature');
    await expect(v.verify(token({}, { kid: 'nope' }))).rejects.toThrow('Unknown signing key');
    const tampered = token({}).split('.');
    tampered[1] = b64({
      iss: 'https://accounts.google.com',
      aud: CLIENT_ID,
      sub: 'admin',
      exp: NOW / 1000 + 60,
    });
    await expect(v.verify(tampered.join('.'))).rejects.toThrow('Bad signature');
    await expect(v.verify('not.a.token')).rejects.toThrow();
  });

  it('caches Google keys, refetching for a key it has not seen', async () => {
    const { v, fetches } = verifier();
    await v.verify(token({}));
    await v.verify(token({}));
    expect(fetches()).toBe(1);
    await expect(v.verify(token({}, { kid: 'rotated' }))).rejects.toThrow();
    expect(fetches()).toBe(2);
  });

  it('falls back to the given name, then a placeholder', async () => {
    const { v } = verifier();
    await expect(v.verify(token({ name: undefined, given_name: 'Ada' }))).resolves.toMatchObject({
      name: 'Ada',
    });
    await expect(v.verify(token({ name: undefined }))).resolves.toMatchObject({ name: 'Player' });
  });
});
