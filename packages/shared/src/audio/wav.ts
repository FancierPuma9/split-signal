// 16-bit PCM WAV, the format content clips are stored in so the server can slice them without a
// decoder, plus base64 so they can travel over the socket. No Buffer, atob or DOM: runs anywhere.

export interface DecodedWav {
  pcm: Float32Array;
  sampleRate: number;
}

/** Decodes a 16-bit PCM WAV (stereo is mixed down to mono). Throws on anything else. */
export function decodeWav(bytes: Uint8Array): DecodedWav {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (at: number) => String.fromCharCode(...bytes.subarray(at, at + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file');
  let channels = 0;
  let sampleRate = 0;
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const id = tag(offset);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === 'fmt ') {
      const format = view.getUint16(body, true);
      channels = view.getUint16(body + 2, true);
      sampleRate = view.getUint32(body + 4, true);
      const bits = view.getUint16(body + 14, true);
      if (format !== 1 || bits !== 16) throw new Error('Only 16-bit PCM WAV is supported');
    } else if (id === 'data') {
      if (!channels) throw new Error('WAV data before its format');
      const frames = Math.floor(Math.min(size, bytes.length - body) / (2 * channels));
      const pcm = new Float32Array(frames);
      for (let i = 0; i < frames; i++) {
        let sum = 0;
        for (let c = 0; c < channels; c++)
          sum += view.getInt16(body + (i * channels + c) * 2, true);
        pcm[i] = sum / channels / 32768;
      }
      return { pcm, sampleRate };
    }
    offset = body + size + (size % 2);
  }
  throw new Error('WAV has no data');
}

/** Encodes mono PCM as a 16-bit WAV. */
export function encodeWav(pcm: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + pcm.length * 2);
  const view = new DataView(bytes.buffer);
  const write = (at: number, text: string) => {
    for (let i = 0; i < text.length; i++) bytes[at + i] = text.charCodeAt(i);
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + pcm.length * 2, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i] ?? 0));
    view.setInt16(44 + i * 2, Math.round(s < 0 ? s * 32768 : s * 32767), true);
  }
  return bytes;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += ALPHABET[(n >> 18) & 63];
    out += ALPHABET[(n >> 12) & 63];
    out += b === undefined ? '=' : ALPHABET[(n >> 6) & 63];
    out += c === undefined ? '=' : ALPHABET[n & 63];
  }
  return out;
}

export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let at = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const n =
      (ALPHABET.indexOf(clean[i] ?? 'A') << 18) |
      (ALPHABET.indexOf(clean[i + 1] ?? 'A') << 12) |
      ((i + 2 < clean.length ? ALPHABET.indexOf(clean[i + 2] ?? 'A') : 0) << 6) |
      (i + 3 < clean.length ? ALPHABET.indexOf(clean[i + 3] ?? 'A') : 0);
    if (at < bytes.length) bytes[at++] = (n >> 16) & 255;
    if (i + 2 < clean.length && at < bytes.length) bytes[at++] = (n >> 8) & 255;
    if (i + 3 < clean.length && at < bytes.length) bytes[at++] = n & 255;
  }
  return bytes;
}
