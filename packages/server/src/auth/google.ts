import { createPublicKey, verify, type JsonWebKey } from 'node:crypto';

/** Who a verified Google ID token says the player is. */
export interface GoogleIdentity {
  /** Google's stable account id. Accounts are keyed on this. */
  sub: string;
  name: string;
}

export interface JwkSet {
  keys: Array<JsonWebKey & { kid?: string }>;
  /** How long this set can be cached, from the response's Cache-Control. */
  maxAgeMs: number;
}

export type FetchKeys = () => Promise<JwkSet>;

const GOOGLE_CERTS = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);
/** Allowed clock difference between us and Google. */
const SKEW_MS = 60_000;

export const fetchGoogleKeys: FetchKeys = async () => {
  const res = await fetch(GOOGLE_CERTS);
  if (!res.ok) throw new Error(`Google keys: HTTP ${res.status}`);
  const maxAge = /max-age=(\d+)/.exec(res.headers.get('cache-control') ?? '')?.[1];
  const body = (await res.json()) as { keys: JwkSet['keys'] };
  return { keys: body.keys, maxAgeMs: maxAge ? Number(maxAge) * 1000 : 3_600_000 };
};

function decodePart(part: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
  if (typeof parsed !== 'object' || parsed === null) throw new Error('Malformed token');
  return parsed as Record<string, unknown>;
}

/**
 * Verifies "Sign in with Google" ID tokens: RS256 signature against Google's published keys,
 * issuer, audience (our client id), and expiry. Throws on anything wrong.
 */
export class GoogleVerifier {
  private keys: JwkSet | null = null;
  private keysFetchedAt = 0;

  constructor(
    readonly clientId: string,
    private readonly fetchKeys: FetchKeys = fetchGoogleKeys,
    private readonly now: () => number = Date.now,
  ) {}

  async verify(token: string): Promise<GoogleIdentity> {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Malformed token');
    const [head, body, signature] = parts as [string, string, string];
    const header = decodePart(head);
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') {
      throw new Error('Unsupported token');
    }

    const jwk = await this.key(header.kid);
    const signed = verify(
      'RSA-SHA256',
      Buffer.from(`${head}.${body}`),
      createPublicKey({ key: jwk, format: 'jwk' }),
      Buffer.from(signature, 'base64url'),
    );
    if (!signed) throw new Error('Bad signature');

    const claims = decodePart(body);
    const now = this.now();
    if (typeof claims.iss !== 'string' || !ISSUERS.has(claims.iss)) throw new Error('Wrong issuer');
    if (claims.aud !== this.clientId) throw new Error('Wrong audience');
    if (typeof claims.exp !== 'number' || claims.exp * 1000 < now - SKEW_MS) {
      throw new Error('Expired');
    }
    if (typeof claims.iat === 'number' && claims.iat * 1000 > now + SKEW_MS) {
      throw new Error('Issued in the future');
    }
    if (typeof claims.sub !== 'string' || claims.sub.length === 0) throw new Error('No subject');

    const name =
      (typeof claims.name === 'string' && claims.name.trim()) ||
      (typeof claims.given_name === 'string' && claims.given_name.trim()) ||
      'Player';
    return { sub: claims.sub, name: name.slice(0, 60) };
  }

  /** The signing key with this id, fetching Google's keys when stale or when the id is new. */
  private async key(kid: string): Promise<JsonWebKey> {
    const fresh = this.keys && this.now() - this.keysFetchedAt < this.keys.maxAgeMs;
    let jwk = fresh ? this.keys!.keys.find((k) => k.kid === kid) : undefined;
    if (!jwk) {
      this.keys = await this.fetchKeys();
      this.keysFetchedAt = this.now();
      jwk = this.keys.keys.find((k) => k.kid === kid);
    }
    if (!jwk) throw new Error('Unknown signing key');
    return jwk;
  }
}
