import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const port = Number(process.env.PORT || 7860);
const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://localhost');
  let file;
  try { file = path.resolve(root, '.' + decodeURIComponent(url.pathname)); } catch { res.writeHead(400); res.end(); return; }
  if (!file.startsWith(root + path.sep) && file !== root) { res.writeHead(403); res.end(); return; }
  try {
    const body = await readFile(file);
    const type = file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : file.endsWith('.svg') ? 'image/svg+xml' : 'application/octet-stream';
    res.writeHead(200, { 'content-type': type, 'x-content-type-options': 'nosniff' }); res.end(body);
  } catch {
    try { const body = await readFile(path.join(root, 'index.html')); res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(body); }
    catch { res.writeHead(503); res.end('Frontend build unavailable'); }
  }
});
const wss = new WebSocketServer({ server, path: '/signal' });
wss.on('connection', ws => {
  ws.on('message', raw => {
    let message; try { message = JSON.parse(raw.toString()); } catch { return; }
    if (!message || typeof message.type !== 'string' || typeof message.from !== 'string') return;
    if (message.type === 'announce') ws.peerId = message.from;
    for (const client of wss.clients) {
      if (client === ws || client.readyState !== WebSocket.OPEN) continue;
      if (message.to && client.peerId && client.peerId !== message.to) continue;
      client.send(JSON.stringify(message));
    }
  });
  ws.on('error', error => console.warn('Signalling client error:', error.message));
});
server.on('error', error => { console.error('HTTP/WS server failed:', error); process.exitCode = 1; });
server.listen(port, '0.0.0.0', () => console.log('Reality Engine HTTP + signalling listening on ' + port + ' at /signal'));
