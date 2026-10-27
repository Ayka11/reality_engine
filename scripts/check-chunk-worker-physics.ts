import assert from 'node:assert/strict'
import { CHUNK_FLOATS, F, NF, chunkKey } from '../src/core/ChunkGrid.ts'
import { DEFAULT_PARAMS } from '../src/laws/MetaLaw.ts'
import { MAT } from '../src/materials/MaterialDef.ts'

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
const energyHalo = readField(latestFrame(), point.x + 1, point.y, point.z, F.E)
assert.ok(energyHalo > 0 && energyHalo < 1,
  `energy diffusion should reach a previously empty neighboring cell (got ${energyHalo})`)

// The same field is unchanged when its process bit is disabled.
send('setPhysics', { params, processMask: 0 })
send('tick', { speed: 1 })
const energyAfterDisabled = readField(latestFrame(), point.x, point.y, point.z, F.E)
assert.ok(Math.abs(energyAfterDisabled - energyAfterEnabled) < 1e-5,
  'disabled energy diffusion must not change energy')

// Diffusion must cross the x=7/8 chunk boundary into a newly allocated chunk.
send('setPhysics', { params, processMask: 1 << 0 })
const boundaryPoint = { x: 7, y: 40, z: 10 }
send('paint', { ...boundaryPoint, f: F.E, v: 100, r: 0, mode: 'set' })
send('tick', { speed: 1 })
const boundaryHalo = readField(latestFrame(), boundaryPoint.x + 1, boundaryPoint.y, boundaryPoint.z, F.E)
assert.ok(boundaryHalo > 0 && boundaryHalo < 1,
  `energy diffusion should cross a chunk boundary into an empty cell (got ${boundaryHalo})`)

// Temperature diffusion uses PhysicsParams.tempDiffusion, not the old 0.07 literal.
const thermalPoint = { x: 20, y: 10, z: 10 }
send('setPhysics', { params, processMask: 1 << 1 })
send('paint', { ...thermalPoint, f: F.T, v: 100, r: 0, mode: 'set' })
send('tick', { speed: 1 })
const tempAfter = readField(latestFrame(), thermalPoint.x, thermalPoint.y, thermalPoint.z, F.T)
assert.ok(Math.abs(tempAfter - 99.04) < 0.02,
  `tempDiffusion should be resolved from PhysicsParams (got ${tempAfter})`)

// Density flow is controlled by the canonical energy-diffusion mobility coefficient.
const densityPoint = { x: 25, y: 25, z: 10 }
send('setPhysics', { params: { ...params, energyDiffusion: 0.1 }, processMask: 1 << 2 })
send('paint', { ...densityPoint, f: F.D, v: 0.5, r: 0, mode: 'set' })
send('tick', { speed: 1 })
const densityAfter = readField(latestFrame(), densityPoint.x, densityPoint.y, densityPoint.z, F.D)
assert.ok(Math.abs(densityAfter - 0.4998848) < 0.00002,
  `density flow should use configured mobility (got ${densityAfter})`)

// Pressure process: the pressure field relaxes toward the density/temperature
// equation of state using the configured pressure-density coupling.
const pressurePoint = { x: 30, y: 10, z: 10 }
send('setPhysics', { params: { ...params, pressureDensityCoupling: 100 }, processMask: 1 << 13 })
send('paint', { ...pressurePoint, f: F.D, v: 0.5, r: 0, mode: 'set' })
send('tick', { speed: 1 })
const pressureAfter = readField(latestFrame(), pressurePoint.x, pressurePoint.y, pressurePoint.z, F.P)
assert.ok(Math.abs(pressureAfter - 0.8) < 0.03,
  `pressureDensityCoupling should affect pressure relaxation (got ${pressureAfter})`)

// Wave process: the scalar wave field responds to its spatial Laplacian.
const wavePoint = { x: 50, y: 10, z: 10 }
send('setPhysics', { params: { ...params, waveSpeed: 2, waveDamping: 1 }, processMask: 1 << 6 })
send('paint', { ...wavePoint, f: F.WAVE, v: 1, r: 0, mode: 'set' })
send('tick', { speed: 1 })
const waveAfter = readField(latestFrame(), wavePoint.x, wavePoint.y, wavePoint.z, F.WAVE)
assert.ok(waveAfter < 1 && waveAfter > 0.98,
  `waveSpeed should propagate the wave field (got ${waveAfter})`)

// Crystallization is observable in both field values and the material ID.
const crystalPoint = { x: 70, y: 10, z: 10 }
send('setPhysics', { params, processMask: 1 << 11 })
send('paint', { ...crystalPoint, f: F.D, v: 0.6, r: 0, mode: 'set' })
send('paint', { ...crystalPoint, f: F.S, v: 0.1, r: 0, mode: 'set' })
send('paint', { ...crystalPoint, f: F.MAT, v: MAT.STONE, r: 0, mode: 'set' })
send('tick', { speed: 1 })
const crystalMaterial = readField(latestFrame(), crystalPoint.x, crystalPoint.y, crystalPoint.z, F.MAT)
const crystalEntropy = readField(latestFrame(), crystalPoint.x, crystalPoint.y, crystalPoint.z, F.S)
assert.equal(crystalMaterial, MAT.CRYSTAL, 'crystallization should convert eligible stone to crystal')
assert.ok(crystalEntropy < 0.1, 'crystallization should reduce entropy in ordered regions')

// Gravity uses density gradients to update the field vector.
const gravityPoint = { x: 90, y: 10, z: 10 }
send('setPhysics', { params: { ...params, gravityDensityCoupling: 0.1 }, processMask: 1 << 7 })
send('paint', { ...gravityPoint, f: F.D, v: 0.5, r: 0, mode: 'set' })
send('paint', { x: gravityPoint.x + 1, y: gravityPoint.y, z: gravityPoint.z, f: F.D, v: 1, r: 0, mode: 'set' })
send('tick', { speed: 1 })
const gravityFx = readField(latestFrame(), gravityPoint.x, gravityPoint.y, gravityPoint.z, F.FX)
assert.ok(gravityFx < 0, `gravity should respond to the density gradient (got ${gravityFx})`)

// INFORMATION and SIGNAL_PROPAGATION must compose, not overwrite one another.
const informationPoint = { x: 120, y: 40, z: 10 }
const informationParams = {
  ...params,
  infoGrowthRate: 2,
  infoGrowthThreshE: 1,
  infoGrowthThreshD: 0.1,
  infoEntropySupp: 0,
  signalPropagationRate: 1,
}
send('setPhysics', {
  params: informationParams,
  processMask: (1 << 4) | (1 << 10),
})
send('paint', { ...informationPoint, f: F.E, v: 100, r: 0, mode: 'set' })
send('paint', { ...informationPoint, f: F.D, v: 0.8, r: 0, mode: 'set' })
send('paint', { ...informationPoint, f: F.I, v: 10, r: 0, mode: 'set' })
// Equal neighboring information makes the signal Laplacian zero. The combined
// processes must still retain the positive INFORMATION growth contribution.
for (const [dx, dy, dz] of [[-1, 0, 0], [1, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1]]) {
  send('paint', {
    x: informationPoint.x + dx,
    y: informationPoint.y + dy,
    z: informationPoint.z + dz,
    f: F.I, v: 10, r: 0, mode: 'set',
  })
}
send('tick', { speed: 1 })
const informationAfterCombined = readField(
  latestFrame(), informationPoint.x, informationPoint.y, informationPoint.z, F.I,
)
assert.ok(informationAfterCombined > 10,
  `INFORMATION growth must survive when SIGNAL_PROPAGATION is also enabled (got ${informationAfterCombined})`)

// Wave-to-energy coupling must not push the energy field below zero.
const waveEnergyPoint = { x: 100, y: 40, z: 20 }
send('setPhysics', { params: { ...params, waveSpeed: 2, waveDamping: 1 }, processMask: 1 << 6 })
send('paint', { ...waveEnergyPoint, f: F.E, v: 0, r: 0, mode: 'set' })
send('paint', { ...waveEnergyPoint, f: F.WAVE, v: -1000, r: 0, mode: 'set' })
send('tick', { speed: 1 })
const energyAfterNegativeWave = readField(latestFrame(), waveEnergyPoint.x, waveEnergyPoint.y, waveEnergyPoint.z, F.E)
assert.ok(energyAfterNegativeWave >= 0,
  `wave-to-energy coupling must preserve the non-negative energy invariant (got ${energyAfterNegativeWave})`)

// Erosion responds to the canonical rate, material resistance, and flow threshold.
const erosionParams = { ...params, erosionRate: 0.01 }
const erosionPoint = { x: 110, y: 10, z: 10 }
send('setPhysics', { params: erosionParams, processMask: 1 << 15 })
send('paint', { ...erosionPoint, f: F.D, v: 0.8, r: 0, mode: 'set' })
send('paint', { ...erosionPoint, f: F.FX, v: 10, r: 0, mode: 'set' })
send('paint', { ...erosionPoint, f: F.MAT, v: MAT.SAND, r: 0, mode: 'set' })
send('tick', { speed: 1 })
const erodedDensity = readField(latestFrame(), erosionPoint.x, erosionPoint.y, erosionPoint.z, F.D)
assert.ok(Math.abs(erodedDensity - 0.792) < 1e-6,
  `erosion should honor the configured rate and sand resistance (got ${erodedDensity})`)

// Low flow must not erode, even with EROSION enabled.
const lowFlowPoint = { x: 100, y: 10, z: 10 }
send('paint', { ...lowFlowPoint, f: F.D, v: 0.8, r: 0, mode: 'set' })
send('paint', { ...lowFlowPoint, f: F.FX, v: 1, r: 0, mode: 'set' })
send('paint', { ...lowFlowPoint, f: F.MAT, v: MAT.SAND, r: 0, mode: 'set' })
send('tick', { speed: 1 })
const lowFlowDensity = readField(latestFrame(), lowFlowPoint.x, lowFlowPoint.y, lowFlowPoint.z, F.D)
assert.ok(Math.abs(lowFlowDensity - 0.8) < 1e-5,
  `sub-threshold worker flow must not erode density (got ${lowFlowDensity})`)

console.log(JSON.stringify({
  status: 'PASS',
  energyAfterEnabled,
  energyAfterDisabled,
  tempAfter,
}))
