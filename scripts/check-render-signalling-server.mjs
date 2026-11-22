import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { WebSocket } from 'ws';

const port = 24000 + Math.floor(Math.random() * 10000);
const child = spawn(process.execPath, ['server/render-signalling-server.js'], {
  env: { ...process.env, PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let stdout = '';
let stderr = '';
child.stdout.setEncoding('utf8');
child.stderr.setEncoding('utf8');
child.stdout.on('data', chunk => { stdout += chunk; });
child.stderr.on('data', chunk => { stderr += chunk; });
const sockets = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const waitForMessage = (socket, timeoutMs = 2000) => Promise.race([
  once(socket, 'message').then(([raw]) => JSON.parse(raw.toString())),
  delay(timeoutMs).then(() => { throw new Error('Render signalling relay timed out'); }),
]);

try {
  for (let i = 0; i < 100 && !stdout.includes('health=/health'); i++) {
    if (child.exitCode !== null) throw new Error(`Render signalling exited: ${stderr}`);
    await delay(50);
  }
  assert.match(stdout, /health=\/health/, `Render signalling failed to start: ${stderr}`);

  const health = await fetch(`http://127.0.0.1:${port}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { status: 'ok', service: 'reality-engine-signalling' });

  const root = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(root.status, 404, 'signalling service must not pretend to host the frontend');

  const alice = new WebSocket(`ws://127.0.0.1:${port}/signal?room=render-room-token`);
  const bob = new WebSocket(`ws://127.0.0.1:${port}/signal?room=render-room-token`);
  const isolated = new WebSocket(`ws://127.0.0.1:${port}/signal?room=another-room-token`);
  sockets.push(alice, bob, isolated);
  await Promise.all(sockets.map(socket => once(socket, 'open')));

  const aliceRoster = waitForMessage(alice);
  const bobRoster = waitForMessage(bob);
  const isolatedReceivesNothing = new Promise(resolve => {
    const onMessage = () => resolve(false);
    isolated.once('message', onMessage);
    setTimeout(() => {
      isolated.off('message', onMessage);
      resolve(true);
    }, 250);
  });

  alice.send(JSON.stringify({ type: 'announce', from: 'alice' }));
  bob.send(JSON.stringify({ type: 'announce', from: 'bob' }));
  assert.equal((await aliceRoster).from, 'bob');
  assert.equal((await bobRoster).from, 'alice');
  assert.equal(await isolatedReceivesNothing, true, 'different rooms must remain isolated');

  const relay = waitForMessage(bob);
  alice.send(JSON.stringify({
    type: 'app-message',
    from: 'alice',
    payload: { type: 'delta', userId: 'alice', cells: [] },
  }));
  const relayed = await relay;
  assert.equal(relayed.payload.type, 'delta');

  console.log('Render health + room-isolated WebSocket contract: PASS');
} finally {
  for (const socket of sockets) {
    try { socket.terminate(); } catch {}
  }
  child.kill('SIGTERM');
}
