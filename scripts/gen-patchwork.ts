// Renders Patchwork's sentence pack to speech: one 16-bit mono 22.05 kHz WAV per sentence in
// packages/puzzles/patchwork/content/, named after the sentence id. Uses whatever text-to-speech
// is installed:
//   windows  the built-in voices, through PowerShell (System.Speech)
//   say      macOS
//   piper    set PIPER_MODEL to a voice model (.onnx); best quality
//   espeak   espeak-ng (Linux)
//
//   pnpm gen:patchwork                 render sentences that don't have a WAV yet
//   pnpm gen:patchwork --force         re-render everything
//   pnpm gen:patchwork --engine piper  pick the engine (default: the first one available)
//   pnpm gen:patchwork --voice "Microsoft Zira Desktop"   engine-specific voice name
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeWav, encodeWav } from '../packages/shared/src/audio/wav';

const RATE = 22050;
const CONTENT = fileURLToPath(new URL('../packages/puzzles/patchwork/content/', import.meta.url));
const WORDS = { min: 10, max: 15 };

type Engine = 'windows' | 'say' | 'piper' | 'espeak';

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const force = args.includes('--force');
const voice = flag('voice');

const has = (cmd: string, probe: string[]) =>
  spawnSync(cmd, probe, { stdio: 'ignore', shell: process.platform === 'win32' }).status === 0;

function pickEngine(): Engine {
  const asked = flag('engine') as Engine | undefined;
  if (asked) return asked;
  if (process.env.PIPER_MODEL && has('piper', ['--help'])) return 'piper';
  if (process.platform === 'win32') return 'windows';
  if (process.platform === 'darwin') return 'say';
  if (has('espeak-ng', ['--version'])) return 'espeak';
  throw new Error('No text-to-speech found: install piper (with PIPER_MODEL) or espeak-ng');
}

function run(cmd: string, argv: string[], input?: string): void {
  const result = spawnSync(cmd, argv, { input, encoding: 'utf8' });
  if (result.status !== 0) {
    throw new Error(`${cmd} failed: ${result.stderr || result.error?.message || result.status}`);
  }
}

/** Speaks one sentence into a WAV file, in whatever format the engine likes. */
function speak(engine: Engine, text: string, out: string): void {
  switch (engine) {
    case 'windows': {
      // Text and paths go in through environment variables, so nothing needs escaping.
      const script = [
        'Add-Type -AssemblyName System.Speech',
        '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
        'if ($env:PW_VOICE) { $s.SelectVoice($env:PW_VOICE) }',
        '$f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(22050, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)',
        '$s.SetOutputToWaveFile($env:PW_OUT, $f)',
        '$s.Speak($env:PW_TEXT)',
        '$s.Dispose()',
      ].join('; ');
      const result = spawnSync('powershell', ['-NoProfile', '-Command', script], {
        env: { ...process.env, PW_TEXT: text, PW_OUT: out, PW_VOICE: voice ?? '' },
        encoding: 'utf8',
      });
      if (result.status !== 0) throw new Error(`PowerShell speech failed: ${result.stderr}`);
      return;
    }
    case 'say':
      return run('say', [
        ...(voice ? ['-v', voice] : []),
        '-o',
        out,
        '--file-format=WAVE',
        `--data-format=LEI16@${RATE}`,
        text,
      ]);
    case 'piper':
      return run('piper', ['--model', process.env.PIPER_MODEL ?? '', '--output_file', out], text);
    case 'espeak':
      return run('espeak-ng', [...(voice ? ['-v', voice] : []), '-w', out, text]);
  }
}

/** Resamples (linear), trims silence at both ends, and normalizes to -1 dBFS peak. */
function tidy(pcm: Float32Array, rate: number): Float32Array {
  let samples = pcm;
  if (rate !== RATE) {
    const out = new Float32Array(Math.round((pcm.length * RATE) / rate));
    for (let i = 0; i < out.length; i++) {
      const at = (i * rate) / RATE;
      const j = Math.floor(at);
      const t = at - j;
      out[i] = (pcm[j] ?? 0) * (1 - t) + (pcm[j + 1] ?? pcm[j] ?? 0) * t;
    }
    samples = out;
  }
  const peak = samples.reduce((m, s) => Math.max(m, Math.abs(s)), 0);
  if (peak === 0) throw new Error('The engine produced silence');
  const floor = peak * 0.02;
  let start = samples.findIndex((s) => Math.abs(s) > floor);
  let end = samples.length - [...samples].reverse().findIndex((s) => Math.abs(s) > floor);
  // Keep a little air around the speech.
  start = Math.max(0, start - Math.round(RATE * 0.08));
  end = Math.min(samples.length, end + Math.round(RATE * 0.12));
  const gain = 0.89 / peak;
  return samples.slice(start, end).map((s) => s * gain);
}

const pack = JSON.parse(readFileSync(join(CONTENT, 'sentences.json'), 'utf8')) as {
  sentences: Array<{ id: string; text: string }>;
};
const engine = pickEngine();
const work = mkdtempSync(join(tmpdir(), 'patchwork-'));
let rendered = 0;
try {
  for (const { id, text } of pack.sentences) {
    const words = text.split(/\s+/).filter(Boolean).length;
    if (words < WORDS.min || words > WORDS.max) {
      console.warn(`! ${id}: ${words} words (aim for ${WORDS.min}-${WORDS.max})`);
    }
    const target = join(CONTENT, `${id}.wav`);
    if (!force && existsSync(target)) continue;
    const raw = join(work, `${id}.wav`);
    speak(engine, text, raw);
    const { pcm, sampleRate } = decodeWav(new Uint8Array(readFileSync(raw)));
    const clean = tidy(pcm, sampleRate);
    writeFileSync(target, encodeWav(clean, RATE));
    rendered += 1;
    console.log(`  ${id}: ${(clean.length / RATE).toFixed(1)}s`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

const ids = new Set(pack.sentences.map((s) => s.id));
for (const file of readdirSync(CONTENT).filter((f) => f.endsWith('.wav'))) {
  if (!ids.has(file.replace(/\.wav$/, ''))) console.warn(`! ${file} has no sentence; delete it?`);
}
console.log(`Rendered ${rendered} with ${engine}; ${pack.sentences.length} sentences in the pack.`);
