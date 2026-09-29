import { createReadStream, existsSync, statSync } from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
};

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** Serves the built client bundle, falling back to index.html for client-side routes. */
export function createStaticHandler(root: string) {
  const rootDir = resolve(root);
  const indexFile = join(rootDir, 'index.html');

  return (req: IncomingMessage, res: ServerResponse): void => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('ok');
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405).end();
      return;
    }
    if (!existsSync(indexFile)) {
      res
        .writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
        .end(
          'Split Signal server is running, but the client is not built.\n' +
            'In development, open the Vite dev server instead (http://localhost:5173).',
        );
      return;
    }

    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      res.writeHead(400).end();
      return;
    }

    let file = resolve(rootDir, `.${pathname}`);
    if (file !== rootDir && !file.startsWith(rootDir + sep)) {
      res.writeHead(403).end();
      return;
    }
    if (!isFile(file)) {
      // Unknown asset paths are real 404s; anything else is a client route.
      if (extname(pathname)) {
        res.writeHead(404).end();
        return;
      }
      file = indexFile;
    }

    const immutable = file.startsWith(join(rootDir, 'assets') + sep);
    res.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(file)] ?? 'application/octet-stream',
      'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    createReadStream(file).pipe(res);
  };
}
