import crypto from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const port = Number(process.env.PORT || 7860);
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

const server = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' });
    res.end('Method not allowed');
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname);
  } catch {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }

  let file = path.resolve(root, '.' + pathname);
  if (!file.startsWith(root + path.sep) && file !== root) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const info = await stat(file);
    if (info.isDirectory()) file = path.join(file, 'index.html');
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'x-content-type-options': 'nosniff',
    });
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    // SPA fallback only for extensionless routes; missing assets must remain 404s.
    if (path.extname(pathname)) {
      res.writeHead(404, { 'x-content-type-options': 'nosniff' });
      res.end('Not found');
      return;
    }
    try {
      const body = await readFile(path.join(root, 'index.html'));
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'x-content-type-options': 'nosniff',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch {
      res.writeHead(503);
      res.end('Frontend build unavailable');
    }
  }
});

const wss = new WebSocketServer({ server, path: '/signal' });
const ROOM_PATTERN = /^[A-Za-z0-9_-]{3,64}$/;

wss.on('connection', (ws, req) => {
  const requestUrl = new URL(req.url || '/signal', 'http://localhost');
  const requestedRoom = requestUrl.searchParams.get('room') || '';
  // No room parameter means private-to-this-socket, never a global public room.
  ws.roomId = ROOM_PATTERN.test(requestedRoom) ? requestedRoom : `private-${crypto.randomUUID()}`;

  ws.on('message', raw => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    if (!message || typeof message.type !== 'string' || typeof message.from !== 'string') return;
    if (message.type === 'announce') ws.peerId = message.from;

    for (const client of wss.clients) {
      if (client === ws || client.readyState !== WebSocket.OPEN) continue;
      if (client.roomId !== ws.roomId) continue;
      if (message.to && client.peerId !== message.to) continue;
      client.send(JSON.stringify(message));
    }
  });
  ws.on('error', error => console.warn('Signalling client error:', error.message));
});
server.on('error', error => { console.error('HTTP/WS server failed:', error); process.exitCode = 1; });
server.listen(port, '0.0.0.0', () => console.log('Reality Engine HTTP + signalling listening on ' + port + ' at /signal'));
