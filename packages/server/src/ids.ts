import { randomBytes } from 'node:crypto';

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString('base64url')}`;
}

/** Secret a player keeps in localStorage to reclaim their seat after a disconnect. */
export function newSeatToken(): string {
  return randomBytes(18).toString('base64url');
}

export function newSeed(): string {
  return randomBytes(16).toString('hex');
}
