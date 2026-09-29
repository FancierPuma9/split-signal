import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, get, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createStaticHandler } from './static';

let dir: string;
let server: Server;
let base: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'split-signal-static-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>app</title>');
  writeFileSync(join(dir, 'assets', 'app.js'), 'console.log(1)');
  server = createServer(createStaticHandler(dir));
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((done) => server.close(done));
  rmSync(dir, { recursive: true, force: true });
});

describe('static handler', () => {
  it('serves files with types and cache headers', async () => {
    const res = await fetch(`${base}/assets/app.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/javascript');
    expect(res.headers.get('cache-control')).toContain('immutable');
  });

  it('falls back to index.html for client routes', async () => {
    const res = await fetch(`${base}/room/ABCD`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<title>app</title>');
  });

  it('404s unknown assets', async () => {
    expect((await fetch(`${base}/assets/missing.js`)).status).toBe(404);
  });

  it('refuses to escape the root', async () => {
    // fetch() would normalize the path, so send it raw.
    const status = await new Promise<number | undefined>((done, fail) => {
      get(`${base}/..%2f..%2fetc%2fpasswd`, (res) => {
        res.resume();
        done(res.statusCode);
      }).on('error', fail);
    });
    expect(status).toBe(403);
  });

  it('answers health checks', async () => {
    expect(await (await fetch(`${base}/healthz`)).text()).toBe('ok');
  });
});
