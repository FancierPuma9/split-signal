// Server-only: reads the sentence pack and its WAVs from disk. Client code must never import this.
import { existsSync, readFileSync } from 'node:fs';
import { decodeWav, type DecodedWav } from '@split-signal/shared';

/**
 * A sentence and its pre-rendered speech. Contributors add sentences to content/sentences.json
 * and run `pnpm gen:patchwork` to render the WAVs; no code changes.
 */
export interface Sentence {
  id: string;
  text: string;
}

const CONTENT_DIR = new URL('./content/', import.meta.url);
const SENTENCE_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function readPack(): Sentence[] {
  const raw = JSON.parse(readFileSync(new URL('sentences.json', CONTENT_DIR), 'utf8')) as {
    sentences: Sentence[];
  };
  return raw.sentences;
}

export function hasAudio(id: string): boolean {
  return SENTENCE_ID.test(id) && existsSync(new URL(`${id}.wav`, CONTENT_DIR));
}

/** Sentences that have been rendered, the only ones a round can use. */
export const sentences: readonly Sentence[] = readPack().filter((s) => hasAudio(s.id));

const audioCache = new Map<string, DecodedWav>();

/** A sentence's speech as PCM. */
export function readAudio(id: string): DecodedWav {
  if (!SENTENCE_ID.test(id)) throw new Error(`Bad sentence id: ${id}`);
  let audio = audioCache.get(id);
  if (!audio) {
    audio = decodeWav(new Uint8Array(readFileSync(new URL(`${id}.wav`, CONTENT_DIR))));
    audioCache.set(id, audio);
  }
  return audio;
}
