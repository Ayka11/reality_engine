import { WebSocket, WebSocketServer } from 'ws';

const PORT = Number(process.env.SIGNAL_PORT || 8888);
const wss = new WebSocketServer({ port: PORT });

wss.on('connection', (ws) => {
  ws.on('message', (msg) => {
    // Relay messages to every other connected peer.
    for (const client of wss.clients) {
      if (client !== ws && client.readyState === WebSocket.OPEN) {
        client.send(msg.toString());
      }
    }
  });
  ws.on('error', (err) => {
    console.warn('WS client error', err && err.message);
  });
});

wss.on('listening', () => {
  console.log(`Signalling server listening on ws://127.0.0.1:${PORT}`);
});
wss.on('error', (err) => {
  console.error('Signalling server failed to start:', err);
  process.exitCode = 1;
});
