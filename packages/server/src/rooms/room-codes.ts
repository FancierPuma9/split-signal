import { randomInt } from 'node:crypto';
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from '@split-signal/shared';

/** A random room code not already in use. */
export function generateRoomCode(
  isTaken: (code: string) => boolean,
  pickIndex: (max: number) => number = randomInt,
): string {
  for (let attempt = 0; attempt < 1000; attempt++) {
    let code = '';
    for (let i = 0; i < ROOM_CODE_LENGTH; i++) {
      code += ROOM_CODE_ALPHABET[pickIndex(ROOM_CODE_ALPHABET.length)];
    }
    if (!isTaken(code)) return code;
  }
  throw new Error('Could not find a free room code');
}
