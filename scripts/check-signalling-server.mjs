import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';

const port = 18000 + Math.floor(Math.random() * 20000);
const child = spawn(process.execPath, ['server/signalling-server.js'], {
  env: { ...process.env, SIGNAL_PORT: String(port) },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let stderr = '';
child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => { stderr += chunk; });

function waitForServer() {
  return new Promise((resolve, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`Signalling server startup timed out. stderr: ${stderr}`)), 8000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      output += chunk;
      if (output.includes('Signalling server listening')) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Signalling server exited early (${code}). stderr: ${stderr}`));
    });
  });
}

function waitForOpen(socket) {
  return new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
}

const sockets = [];
try {
  await waitForServer();
  const sender = new WebSocket(`ws://127.0.0.1:${port}`);
  const receiver = new WebSocket(`ws://127.0.0.1:${port}`);
  sockets.push(sender, receiver);
  await Promise.all(sockets.map(waitForOpen));

  const messageReceived = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Signalling relay did not deliver the message within 2 seconds')), 2000);
    receiver.once('message', (data) => {
      clearTimeout(timer);
      resolve(data.toString());
    });
  });

  sender.send('reality-engine-signalling-contract');
  assert.equal(await messageReceived, 'reality-engine-signalling-contract');
  console.log('Signalling server relay contract: PASS');
} finally {
  for (const socket of sockets) {
    try { socket.terminate(); } catch {}
  }
  child.kill('SIGTERM');
}
