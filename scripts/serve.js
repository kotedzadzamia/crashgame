#!/usr/bin/env node
// Zero-dependency static server for local play: `npm start` -> http://localhost:8080
// ES modules require http(s), so opening index.html via file:// will not work.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT) || 8080;
const HOST = process.env.HOST || '127.0.0.1';
const ALLOWED = new Set(['index.html', 'styles.css', 'src']);

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const SECURITY_HEADERS = {
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

createServer(async (req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end();
      return;
    }
    const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const rel = normalize(pathname === '/' ? 'index.html' : pathname.slice(1));
    const file = join(ROOT, rel);
    // Block traversal and anything outside the public allow-list.
    if (!file.startsWith(ROOT + sep) || !ALLOWED.has(rel.split(sep)[0]) || !TYPES[extname(file)]) {
      res.writeHead(404).end('Not found');
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)], 'Cache-Control': 'no-cache', ...SECURITY_HEADERS });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(PORT, HOST, () => {
  console.log(`Lucky Reels running at http://${HOST}:${PORT}`);
});
