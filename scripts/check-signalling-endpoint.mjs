import assert from 'node:assert/strict';
import { buildSignallingUrl, getConfiguredSignallingUrl } from '../src/network/signallingEndpoint.ts';

assert.equal(
  buildSignallingUrl('wss://example.onrender.com/signal', 'room-token-1234', 'https://example.hf.space/', false),
  'wss://example.onrender.com/signal?room=room-token-1234',
  'production must use the configured external Render endpoint',
);
assert.equal(
  buildSignallingUrl(undefined, 'room-token-1234', 'http://localhost:3000/', true),
  'ws://localhost:3000/signal?room=room-token-1234',
  'development must preserve same-origin signalling',
);
assert.equal(
  buildSignallingUrl(undefined, 'room-token-1234', 'https://example.hf.space/', false),
  null,
  'Static Space production must not attempt a nonexistent same-origin WebSocket service',
);
assert.equal(
  buildSignallingUrl('https://example.onrender.com/signal', 'room-token-1234', 'https://example.hf.space/', false),
  null,
  'configured endpoint must use ws or wss protocol',
);
assert.equal(
  buildSignallingUrl('wss://example.onrender.com/other', 'room-token-1234', 'https://example.hf.space/', false),
  null,
  'configured endpoint must use the /signal path',
);
assert.equal(
  buildSignallingUrl('wss://example.onrender.com/signal', 'bad', 'https://example.hf.space/', false),
  null,
  'invalid room IDs must not create a remote socket',
);
console.log('External signalling endpoint contract: PASS');

assert.equal(
  getConfiguredSignallingUrl(undefined, 'wss://runtime.onrender.com/signal'),
  'wss://runtime.onrender.com/signal',
  'Hugging Face runtime variable must configure the endpoint without a rebuild-time Vite variable',
);
assert.equal(
  getConfiguredSignallingUrl('wss://build.onrender.com/signal', 'wss://runtime.onrender.com/signal'),
  'wss://runtime.onrender.com/signal',
  'Hugging Face runtime configuration must take precedence over the baked Vite fallback',
);
assert.equal(
  getConfiguredSignallingUrl('wss://build.onrender.com/signal', undefined),
  'wss://build.onrender.com/signal',
  'Vite build configuration must remain supported outside Hugging Face Static',
);
