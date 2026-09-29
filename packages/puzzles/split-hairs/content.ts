// Server-only: reads the content pack from disk. Client code must never import this file.
import { existsSync, readFileSync } from 'node:fs';

/**
 * A cluster of words that all mean nearly the same thing. Contributors add clusters to
 * content/clusters.json and pictures to content/pictures/ without touching code.
 */
export interface Cluster {
  id: string;
  words: string[];
  /** Word -> picture files. Words without pictures can still appear, as decoys. */
  pictures: Record<string, string[]>;
}

const CONTENT_DIR = new URL('./content/', import.meta.url);
const PICTURE_FILE = /^[a-z0-9]+(-[a-z0-9]+)*\.svg$/;
const CLUSTER_ID = /^[a-z0-9]+(-[a-z0-9]+)*$/;
export const MIN_WORDS = 6;

export function readPack(): Cluster[] {
  const raw = JSON.parse(readFileSync(new URL('clusters.json', CONTENT_DIR), 'utf8')) as {
    clusters: Cluster[];
  };
  return raw.clusters;
}

export const clusters: readonly Cluster[] = readPack();

/**
 * Strips anything readable that isn't drawing: comments, titles, descriptions, metadata, ids,
 * classes and editor attributes (an Inkscape label could spell the word). Collapses whitespace.
 */
export function sanitizeSvg(svg: string): string {
  return svg
    .replace(/<\?xml[\s\S]*?\?>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(title|desc|metadata)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/\s(?:id|class|data-[\w-]+|(?!xmlns)[\w-]+:[\w-]+)="[^"]*"/g, '')
    .replace(/\s+/g, ' ')
    .replace(/>\s+</g, '><')
    .trim();
}

const markupCache = new Map<string, string>();

export function readPicture(file: string): string {
  if (!PICTURE_FILE.test(file)) throw new Error(`Bad picture file name: ${file}`);
  let markup = markupCache.get(file);
  if (markup === undefined) {
    markup = sanitizeSvg(readFileSync(new URL(`pictures/${file}`, CONTENT_DIR), 'utf8'));
    markupCache.set(file, markup);
  }
  return markup;
}

export function pictureExists(file: string): boolean {
  return PICTURE_FILE.test(file) && existsSync(new URL(`pictures/${file}`, CONTENT_DIR));
}

/** Everything a picture must not contain: things that can be read, run, or fetched. */
const FORBIDDEN = [
  /<text\b/i,
  /<script\b/i,
  /<foreignObject\b/i,
  /<image\b/i,
  /<a\b/i,
  /\shref=/i,
  /\son\w+=/i,
  /url\(\s*['"]?(?!#)/i,
];

/** Problems with the pack; empty means valid. The tests run this over the shipped pack. */
export function validatePack(pack: readonly Cluster[]): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const c of pack) {
    const where = `cluster "${c.id}"`;
    if (!CLUSTER_ID.test(c.id)) errors.push(`${where}: id must be kebab-case`);
    if (ids.has(c.id)) errors.push(`${where}: duplicate id`);
    ids.add(c.id);
    const words = c.words ?? [];
    if (words.length < MIN_WORDS) errors.push(`${where}: needs at least ${MIN_WORDS} words`);
    if (new Set(words).size !== words.length) errors.push(`${where}: repeats a word`);
    if (words.some((w) => typeof w !== 'string' || w.trim() !== w || w === '')) {
      errors.push(`${where}: words must be non-empty and trimmed`);
    }
    const pictured = Object.entries(c.pictures ?? {});
    if (!pictured.some(([, files]) => files.length > 0)) {
      errors.push(`${where}: no word has a picture`);
    }
    for (const [word, files] of pictured) {
      if (!words.includes(word)) errors.push(`${where}: picture for "${word}", not in words`);
      for (const file of files) {
        if (!pictureExists(file)) {
          errors.push(`${where}: missing picture ${file}`);
          continue;
        }
        const svg = readPicture(file);
        if (!/^<svg\b[^>]*\sviewBox="/.test(svg)) {
          errors.push(`${file}: must start with <svg viewBox="...">`);
        }
        for (const pattern of FORBIDDEN) {
          if (pattern.test(svg)) errors.push(`${file}: contains ${pattern.source}`);
        }
        // Nothing in the markup may spell out a word from the cluster.
        for (const w of words) {
          if (new RegExp(`\\b${w.replace(/[^a-z]/gi, '.?')}\\b`, 'i').test(svg)) {
            errors.push(`${file}: contains the word "${w}"`);
          }
        }
      }
    }
  }
  return errors;
}
