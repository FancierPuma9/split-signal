// Starts the server and the client dev server together.
//   pnpm dev                 sandbox with the default puzzle
//   pnpm dev --puzzle <id>   sandbox with a specific puzzle
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';

// The Vite dev server proxies /ws to this port (see packages/client/vite.config.ts).
const SERVER_PORT = '3001';

const args = process.argv.slice(2);
let puzzle;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--puzzle') puzzle = args[++i];
  else if (args[i]?.startsWith('--puzzle=')) puzzle = args[i].slice('--puzzle='.length);
}
if (args.some((a) => a.startsWith('--puzzle')) && !puzzle) {
  console.error('Usage: pnpm dev [--puzzle <id>]');
  process.exit(1);
}
const isPuzzleFolder = (name) =>
  /^[a-z0-9]+(-[a-z0-9]+)*$/.test(name) &&
  existsSync(new URL(`../packages/puzzles/${name}/server.ts`, import.meta.url));

if (puzzle && !isPuzzleFolder(puzzle)) {
  // Checked here because the server runs under `tsx watch`, which waits for edits rather than
  // exiting when the server does.
  const available = readdirSync(new URL('../packages/puzzles/', import.meta.url), {
    withFileTypes: true,
  })
    .filter((d) => d.isDirectory() && isPuzzleFolder(d.name))
    .map((d) => d.name);
  console.error(`Unknown puzzle "${puzzle}". Available: ${available.join(', ')}`);
  process.exit(1);
}

const tasks = [
  // PORT is pinned so an inherited PORT (e.g. from a preview tool) can't make the game server
  // take the Vite port.
  { pkg: '@split-signal/server', env: { PORT: SERVER_PORT, SPLIT_SIGNAL_PUZZLE: puzzle } },
  { pkg: '@split-signal/client', env: {} },
];

let stopping = false;
const children = tasks.map(({ pkg, env }) => {
  const childEnv = { ...process.env };
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) delete childEnv[key];
    else childEnv[key] = value;
  }
  // stdin is not shared: on Windows, tsx watch's pending read on a shared stdin pipe blocks Vite
  // from starting at all.
  const child = spawn(`pnpm --filter ${pkg} dev`, {
    env: childEnv,
    stdio: ['ignore', 'inherit', 'inherit'],
    shell: true,
  });
  child.on('exit', (code) => {
    if (stopping) return;
    console.error(`[dev] ${pkg} exited with code ${code}; stopping.`);
    stop(code ?? 1);
  });
  return child;
});

function stop(code) {
  stopping = true;
  for (const child of children) {
    if (child.exitCode !== null || child.pid === undefined) continue;
    // Killing the shell alone would orphan pnpm, tsx and vite on Windows.
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      child.kill();
    }
  }
  process.exit(code);
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
