import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { WebSocket } from 'ws';

const port = 22000 + Math.floor(Math.random() * 10000);
const child = spawn(process.execPath, ['server/hf-server.js'], {
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
const waitForMessage = (socket, timeoutMs = 2500) => Promise.race([
  once(socket, 'message').then(([payload]) => JSON.parse(payload.toString())),
  delay(timeoutMs).then(() => { throw new Error('WebSocket relay timed out'); }),
]);

try {
  for (let i = 0; i < 120 && !stdout.includes('HTTP + signalling listening'); i++) {
    if (child.exitCode !== null) throw new Error(`HF runtime exited: ${stderr}`);
    await delay(50);
  }
  assert.match(stdout, /HTTP \+ signalling listening/, `HF runtime failed to start: ${stderr}`);

  const response = await fetch(`http://127.0.0.1:${port}/`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /text\/html/);
  assert.match(await response.text(), /Reality Engine/i);

  const spaRoute = await fetch(`http://127.0.0.1:${port}/science-lab`);
  assert.equal(spaRoute.status, 200, 'extensionless SPA route should fall back to index.html');
  assert.match(spaRoute.headers.get('content-type') || '', /text\/html/);

  const missingAsset = await fetch(`http://127.0.0.1:${port}/missing-bundle.js`);
  assert.equal(missingAsset.status, 404, 'missing static assets must not silently return index.html');

  const head = await fetch(`http://127.0.0.1:${port}/`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');

  const unsupportedMethod = await fetch(`http://127.0.0.1:${port}/`, { method: 'POST' });
  assert.equal(unsupportedMethod.status, 405);

  const alice = new WebSocket(`ws://127.0.0.1:${port}/signal?room=runtime-test-room`);
  const bob = new WebSocket(`ws://127.0.0.1:${port}/signal?room=runtime-test-room`);
  const charlie = new WebSocket(`ws://127.0.0.1:${port}/signal`);
  sockets.push(alice, bob, charlie);
  await Promise.all(sockets.map(socket => once(socket, 'open')));

  const aliceAnnounce = waitForMessage(alice);
  const bobAnnounce = waitForMessage(bob);
  const isolatedRoomReceivesNothing = new Promise(resolve => {
    const onMessage = () => resolve(false);
    charlie.once('message', onMessage);
    setTimeout(() => {
      charlie.off('message', onMessage);
      resolve(true);
    }, 300);
  });
  alice.send(JSON.stringify({ type: 'announce', from: 'alice' }));
  bob.send(JSON.stringify({ type: 'announce', from: 'bob' }));
  assert.equal((await aliceAnnounce).from, 'bob');
  assert.equal((await bobAnnounce).from, 'alice');
  assert.equal(await isolatedRoomReceivesNothing, true, 'clients without the room token must be isolated');

  const targeted = waitForMessage(bob);
  alice.send(JSON.stringify({ type: 'offer', from: 'alice', to: 'bob', payload: 'contract-check' }));
  const relayed = await targeted;
  assert.equal(relayed.type, 'offer');
  assert.equal(relayed.payload, 'contract-check');

  console.log('Combined HF HTTP + WebSocket runtime contract: PASS');
} finally {
  for (const socket of sockets) {
    try { socket.terminate(); } catch {}
  }
  child.kill('SIGTERM');
}
