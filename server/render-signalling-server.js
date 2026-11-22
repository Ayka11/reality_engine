import crypto from 'node:crypto';
import { createServer } from 'node:http';
import { WebSocket, WebSocketServer } from 'ws';

const port = Number(process.env.PORT || 10000);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be a valid TCP port');
}

const ROOM_PATTERN = /^[A-Za-z0-9_-]{12,64}$/;
const server = createServer((req, res) => {
  const method = req.method || 'GET';
  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' });
    res.end('Method not allowed');
    return;
  }

  let pathname;
  try {
    pathname = new URL(req.url || '/', 'http://localhost').pathname;
  } catch {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }

  if (pathname === '/health') {
    const body = JSON.stringify({ status: 'ok', service: 'reality-engine-signalling' });
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    res.end(method === 'HEAD' ? undefined : body);
    return;
  }

  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff' });
  res.end('Not found');
});

const wss = new WebSocketServer({ server, path: '/signal' });

wss.on('connection', (ws, req) => {
  const requestUrl = new URL(req.url || '/signal', 'http://localhost');
  const requestedRoom = requestUrl.searchParams.get('room') || '';
  // Missing or invalid room tokens are isolated to this socket.
  ws.roomId = ROOM_PATTERN.test(requestedRoom) ? requestedRoom : `private-${crypto.randomUUID()}`;

  ws.on('message', raw => {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    if (!message || typeof message.type !== 'string' ||
        typeof message.from !== 'string' || message.from.length < 1 || message.from.length > 64) return;

    if (message.type === 'announce') {
      if (ws.peerId && ws.peerId !== message.from) return;
      ws.peerId = message.from;
      // Late joiners receive the existing peer roster for deterministic host election.
      for (const client of wss.clients) {
        if (client === ws || client.readyState !== WebSocket.OPEN) continue;
        if (client.roomId !== ws.roomId || !client.peerId) continue;
        ws.send(JSON.stringify({ type: 'announce', from: client.peerId }));
      }
    } else if (!ws.peerId || message.from !== ws.peerId) {
      return;
    }

    if (message.type === 'app-message' &&
        (!message.payload || typeof message.payload !== 'object' ||
         message.payload.userId !== message.from || typeof message.payload.type !== 'string')) return;

    for (const client of wss.clients) {
      if (client === ws || client.readyState !== WebSocket.OPEN) continue;
      if (client.roomId !== ws.roomId) continue;
      if (message.to && client.peerId !== message.to) continue;
      client.send(JSON.stringify(message));
    }
  });

  ws.on('error', error => console.warn('Signalling client error:', error.message));
});

server.on('error', error => {
  console.error('Render signalling service failed:', error);
  process.exitCode = 1;
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Reality Engine Render signalling listening on ${port}; health=/health; websocket=/signal`);
});

const shutdown = () => {
  for (const client of wss.clients) client.close(1001, 'Server shutting down');
  wss.close(() => server.close(() => process.exit(0)));
  setTimeout(() => process.exit(1), 5000).unref();
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
