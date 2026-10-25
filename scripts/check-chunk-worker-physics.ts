import assert from 'node:assert/strict'
import { CHUNK_FLOATS, F, NF, chunkKey } from '../src/core/ChunkGrid.ts'
import { DEFAULT_PARAMS } from '../src/laws/MetaLaw.ts'

type WorkerMessage = { cmd: string; data?: any; ab?: ArrayBuffer; tick?: number }
const messages: WorkerMessage[] = []
const fakeSelf: { onmessage?: (event: MessageEvent) => void; postMessage: (message: WorkerMessage, transfer?: Transferable[]) => void } = {
  postMessage(message) { messages.push(message) },
}
Object.defineProperty(globalThis, 'self', { value: fakeSelf, configurable: true })
await import('../src/core/ChunkSimWorker.ts')

function send(cmd: string, data: Record<string, unknown> = {}) {
  assert.ok(fakeSelf.onmessage, 'worker message handler should be installed')
  fakeSelf.onmessage!({ data: { cmd, data } } as MessageEvent)
}
function latestFrame(): ArrayBuffer {
  const frame = messages.filter(message => message.cmd === 'frame').at(-1)
  assert.ok(frame?.ab, 'worker tick should return a frame')
  return frame.ab!
}
function readField(ab: ArrayBuffer, x: number, y: number, z: number, field: number): number {
  const u32 = new Uint32Array(ab)
  const f32 = new Float32Array(ab)
  const key = chunkKey(Math.floor(x / 8), Math.floor(y / 8), Math.floor(z / 8))
  const localCell = ((z & 7) * 8 * 8 + (y & 7) * 8 + (x & 7)) * NF
  for (let chunk = 0, offset = 1; chunk < u32[0]; chunk++, offset += 1 + CHUNK_FLOATS) {
    if (u32[offset] === key) return f32[offset + 1 + localCell + field]
  }
  throw new Error(`chunk ${key} missing from dirty frame`)
}

const point = { x: 10, y: 10, z: 10 }
const params = { ...DEFAULT_PARAMS, energyDiffusion: 0.1, tempDiffusion: 0.1, tempEnergyCoupling: 0 }

// Energy process enabled: the canonical parameter changes the energy field.
send('setPhysics', { params, processMask: 1 << 0 })
send('paint', { ...point, f: F.E, v: 100, r: 0, mode: 'set' })
send('tick', { speed: 1 })
const energyAfterEnabled = readField(latestFrame(), point.x, point.y, point.z, F.E)
assert.ok(Math.abs(energyAfterEnabled - 99.04) < 0.02,
  `energyDiffusion and bit 0 should control the worker step (got ${energyAfterEnabled})`)

// The same field is unchanged when its process bit is disabled.
send('setPhysics', { params, processMask: 0 })
send('tick', { speed: 1 })
const energyAfterDisabled = readField(latestFrame(), point.x, point.y, point.z, F.E)
assert.ok(Math.abs(energyAfterDisabled - energyAfterEnabled) < 1e-5,
  'disabled energy diffusion must not change energy')

// Temperature diffusion uses PhysicsParams.tempDiffusion, not the old 0.07 literal.
const thermalPoint = { x: 20, y: 10, z: 10 }
send('setPhysics', { params, processMask: 1 << 1 })
send('paint', { ...thermalPoint, f: F.T, v: 100, r: 0, mode: 'set' })
send('tick', { speed: 1 })
const tempAfter = readField(latestFrame(), thermalPoint.x, thermalPoint.y, thermalPoint.z, F.T)
assert.ok(Math.abs(tempAfter - 99.04) < 0.02,
  `tempDiffusion should be resolved from PhysicsParams (got ${tempAfter})`)

console.log(JSON.stringify({
  status: 'PASS',
  energyAfterEnabled,
  energyAfterDisabled,
  tempAfter,
}))
