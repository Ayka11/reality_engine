const WebSocket = require('ws');

const PORT = process.env.PORT || 8888;
const wss = new WebSocket.Server({ port: PORT });

wss.on('connection', (ws) => {
  ws.on('message', (msg) => {
    // naive relay: broadcast to all other peers
    for (const client of wss.clients) {
      if (client !== ws && client.readyState === WebSocket.OPEN) client.send(msg);
    }
  });
  ws.on('error', (err) => {
    console.warn('WS client error', err && err.message);
  });
});

console.log(`Signalling server listening on ws://localhost:${PORT}`);
