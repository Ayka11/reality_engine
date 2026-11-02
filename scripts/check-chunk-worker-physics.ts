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
assert.ok(Math.abs(energyAfterEnabled - 99.952) < 0.002,
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

// Cross-chunk diffusion must apply to every independently enabled scalar stencil,
// not only energy. Each case uses a fresh x=7/8 boundary cell and its own process bit.
const boundaryDensityPoint = { x: 7, y: 40, z: 20 }
send('setPhysics', {
  params: { ...params, energyDiffusion: 0, densityDiffusion: 0.0024,
    tempDiffusion: 0, tempEnergyCoupling: 0, pressureDiffusion: 0, pressureDensityCoupling: 0 },
  processMask: 1 << 2,
})
send('paint', { ...boundaryDensityPoint, f: F.D, v: 0.5, r: 0, mode: 'set' })
send('tick', { speed: 1 })
const boundaryDensityHalo = readField(
  latestFrame(), boundaryDensityPoint.x + 1, boundaryDensityPoint.y, boundaryDensityPoint.z, F.D,
)
assert.ok(boundaryDensityHalo > 0 && boundaryDensityHalo < 0.5,
  `density diffusion should cross a chunk boundary into an empty cell (got ${boundaryDensityHalo})`)

// The normal prune pass runs every 100 ticks. A low-density destination chunk
// must survive that pass while the neighboring source continues to feed it.
send('tick', { speed: 100 })
const sustainedBoundaryDensityHalo = readField(
  latestFrame(), boundaryDensityPoint.x + 1, boundaryDensityPoint.y, boundaryDensityPoint.z, F.D,
)
assert.ok(sustainedBoundaryDensityHalo > boundaryDensityHalo + 0.0001 &&
  sustainedBoundaryDensityHalo < 0.5,
  `density halo should keep accumulating across a chunk boundary after the 100-tick prune (initial ${boundaryDensityHalo}, later ${sustainedBoundaryDensityHalo})`)

// Sculpt undo must not delete a density-only chunk merely because its values
// fall below the generic 0.001 threshold. The edit is in a different cell of
// the same chunk so restoring that edit leaves the small density cell untouched.
const undoDensityPoint = { x: 32, y: 96, z: 40 }
send('setPhysics', {
  params: { ...params, energyDiffusion: 0, densityDiffusion: 0,
    tempDiffusion: 0, tempEnergyCoupling: 0, pressureDiffusion: 0, pressureDensityCoupling: 0 },
  processMask: 1 << 2,
})
send('paint', { ...undoDensityPoint, f: F.D, v: 0.00002, r: 0, mode: 'set' })
send('paint', { x: 33, y: 96, z: 40, f: F.E, v: 10, r: 0, mode: 'set', trackHistory: true })
send('undoSculpt')
send('tick', { speed: 1 })
const densityAfterUndoCleanup = readField(
  latestFrame(), undoDensityPoint.x, undoDensityPoint.y, undoDensityPoint.z, F.D,
)
assert.ok(densityAfterUndoCleanup > 0.00001,
  `undo cleanup must preserve low-density payload in a chunk with no other active fields (got ${densityAfterUndoCleanup})`)

const boundaryTemperaturePoint = { x: 7, y: 32, z: 20 }
send('setPhysics', {
  params: { ...params, energyDiffusion: 0, densityDiffusion: 0,
    tempDiffusion: 0.1, tempEnergyCoupling: 0, pressureDiffusion: 0, pressureDensityCoupling: 0 },
  processMask: 1 << 1,
})
send('paint', { ...boundaryTemperaturePoint, f: F.T, v: 100, r: 0, mode: 'set' })
send('tick', { speed: 1 })
const boundaryTemperatureHalo = readField(
  latestFrame(), boundaryTemperaturePoint.x + 1, boundaryTemperaturePoint.y, boundaryTemperaturePoint.z, F.T,
)
assert.ok(Math.abs(boundaryTemperatureHalo - 1.6) < 0.02,
  `temperature diffusion must cross the chunk boundary with Vacuum heat capacity (expected 1.6, got ${boundaryTemperatureHalo})`)

const boundaryPressurePoint = { x: 7, y: 48, z: 20 }
send('setPhysics', {
  params: { ...params, energyDiffusion: 0, densityDiffusion: 0,
    tempDiffusion: 0, tempEnergyCoupling: 0, pressureDiffusion: 0.1, pressureDensityCoupling: 0 },
  processMask: 1 << 13,
})
send('paint', { ...boundaryPressurePoint, f: F.P, v: 100, r: 0, mode: 'set' })
send('tick', { speed: 1 })
const boundaryPressureHalo = readField(
  latestFrame(), boundaryPressurePoint.x + 1, boundaryPressurePoint.y, boundaryPressurePoint.z, F.P,
)
assert.ok(boundaryPressureHalo > 0 && boundaryPressureHalo < 100,
  `pressure diffusion should cross a chunk boundary into an empty cell (got ${boundaryPressureHalo})`)

// Temperature diffusion uses PhysicsParams.tempDiffusion, not the old 0.07 literal.
const thermalPoint = { x: 20, y: 10, z: 10 }
send('setPhysics', { params, processMask: 1 << 1 })
send('paint', { ...thermalPoint, f: F.T, v: 100, r: 0, mode: 'set' })
send('tick', { speed: 1 })
const tempAfter = readField(latestFrame(), thermalPoint.x, thermalPoint.y, thermalPoint.z, F.T)
assert.ok(Math.abs(tempAfter - 90.4) < 0.002,
  `tempDiffusion should be resolved from PhysicsParams (got ${tempAfter})`)

// Material coefficients affect energy and thermal diffusion identically to the GPU solver.
const materialEnergyPoint = { x: 116, y: 48, z: 30 }
send('setPhysics', { params: { ...params, energyDiffusion: 0.1 }, processMask: 1 << 0 })
send('paint', { ...materialEnergyPoint, f: F.E, v: 100, r: 0, mode: 'set' })
send('paint', { ...materialEnergyPoint, f: F.MAT, v: MAT.METAL, r: 0, mode: 'set' })
send('tick', { speed: 1 })
const metalEnergyAfter = readField(
  latestFrame(), materialEnergyPoint.x, materialEnergyPoint.y, materialEnergyPoint.z, F.E,
)
assert.ok(Math.abs(metalEnergyAfter - 97.12) < 0.002,
  `metal conductivity must scale worker energy diffusion (expected 97.12, got ${metalEnergyAfter})`)

const materialTemperaturePoint = { x: 116, y: 64, z: 30 }
send('setPhysics', {
  params: { ...params, tempDiffusion: 0.1, tempEnergyCoupling: 0 },
  processMask: 1 << 1,
})
send('paint', { ...materialTemperaturePoint, f: F.T, v: 100, r: 0, mode: 'set' })
send('paint', { ...materialTemperaturePoint, f: F.MAT, v: MAT.METAL, r: 0, mode: 'set' })
send('tick', { speed: 1 })
const metalTemperatureAfter = readField(
  latestFrame(), materialTemperaturePoint.x, materialTemperaturePoint.y, materialTemperaturePoint.z, F.T,
)
assert.ok(Math.abs(metalTemperatureAfter - 99.52) < 0.002,
  `metal heat capacity must inversely scale worker thermal diffusion (expected 99.52, got ${metalTemperatureAfter})`)

// Combined energy/thermal execution must use the same pre-step energy source as CPU and GPU.
const coupledMaterialPoint = { x: 116, y: 80, z: 30 }
send('setPhysics', {
  params: { ...params, energyDiffusion: 0.1, tempDiffusion: 0,
    tempEnergyCoupling: 0.5 },
  processMask: (1 << 0) | (1 << 1),
})
send('paint', { ...coupledMaterialPoint, f: F.E, v: 100, r: 0, mode: 'set' })
send('paint', { ...coupledMaterialPoint, f: F.MAT, v: MAT.METAL, r: 0, mode: 'set' })
send('tick', { speed: 1 })
const coupledEnergy = readField(
  latestFrame(), coupledMaterialPoint.x, coupledMaterialPoint.y, coupledMaterialPoint.z, F.E,
)
const coupledTemperature = readField(
  latestFrame(), coupledMaterialPoint.x, coupledMaterialPoint.y, coupledMaterialPoint.z, F.T,
)
assert.ok(Math.abs(coupledEnergy - 97.12) < 0.002,
  `combined worker step must apply metal conductivity (got ${coupledEnergy})`)
assert.ok(Math.abs(coupledTemperature - 0.8) < 0.002,
  `thermal coupling must use pre-step energy in the worker (expected 0.8, got ${coupledTemperature})`)

// Phase transition eligibility uses pre-step density and composes with diffused density.
const phaseDiffusionPoint = { x: 116, y: 96, z: 30 }
send('setPhysics', {
  params: { ...params, energyDiffusion: 0, tempDiffusion: 0, tempEnergyCoupling: 0,
    densityDiffusion: 0.01, phaseTransitionRate: 0.008 },
  processMask: (1 << 2) | (1 << 8),
})
send('paint', { ...phaseDiffusionPoint, f: F.D, v: 0.50005, r: 0, mode: 'set' })
send('paint', { ...phaseDiffusionPoint, f: F.T, v: 600, r: 0, mode: 'set' })
send('paint', { ...phaseDiffusionPoint, f: F.S, v: 0.2, r: 0, mode: 'set' })
send('paint', { ...phaseDiffusionPoint, f: F.I, v: 10, r: 0, mode: 'set' })
send('tick', { speed: 1 })
const phaseDiffusionDensity = readField(
  latestFrame(), phaseDiffusionPoint.x, phaseDiffusionPoint.y, phaseDiffusionPoint.z, F.D,
)
assert.ok(Math.abs(phaseDiffusionDensity - 0.49188995) < 0.002,
  `worker phase transition must use pre-step density and retain diffusion output (got ${phaseDiffusionDensity})`)

// Crystallization must use pre-step eligibility and add to the density-diffusion output.
const crystalDiffusionPoint = { x: 116, y: 112, z: 30 }
send('setPhysics', {
  params: { ...params, energyDiffusion: 0, tempDiffusion: 0, tempEnergyCoupling: 0,
    densityDiffusion: 0.01, crystallizationRate: 0.003 },
  processMask: (1 << 2) | (1 << 11),
})
send('paint', { ...crystalDiffusionPoint, f: F.D, v: 0.38005, r: 0, mode: 'set' })
send('paint', { ...crystalDiffusionPoint, f: F.S, v: 0.1, r: 0, mode: 'set' })
send('paint', { ...crystalDiffusionPoint, f: F.MAT, v: MAT.VACUUM, r: 0, mode: 'set' })
send('tick', { speed: 1 })
const crystalDiffusionDensity = readField(
  latestFrame(), crystalDiffusionPoint.x, crystalDiffusionPoint.y, crystalDiffusionPoint.z, F.D,
)
const crystalDiffusionMaterial = readField(
  latestFrame(), crystalDiffusionPoint.x, crystalDiffusionPoint.y, crystalDiffusionPoint.z, F.MAT,
)
assert.ok(Math.abs(crystalDiffusionDensity - 0.37991555) < 0.002,
  `worker crystallization must compose with density diffusion (got ${crystalDiffusionDensity})`)
assert.equal(crystalDiffusionMaterial, MAT.CRYSTAL,
  "pre-step eligible vacuum must crystallize even if diffusion moves density below threshold")

// Density flow uses densityDiffusion independently of energyDiffusion.
const densityPoint = { x: 25, y: 25, z: 10 }
send('setPhysics', { params: { ...params, energyDiffusion: 0.1, densityDiffusion: 0.0024 }, processMask: 1 << 2 })
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

// Pressure diffusion must move pressure from an isolated high-pressure cell,
// and the parameter must affect the result independently from EOS relaxation.
const pressureDiffusionPoint = { x: 42, y: 42, z: 26 }
send('setPhysics', {
  params: { ...params, pressureDensityCoupling: 0, pressureDiffusion: 0.1 },
  processMask: 1 << 13,
})
send('paint', { ...pressureDiffusionPoint, f: F.P, v: 100, r: 0, mode: 'set' })
send('tick', { speed: 1 })
const pressureAfterDiffusion = readField(latestFrame(), pressureDiffusionPoint.x, pressureDiffusionPoint.y, pressureDiffusionPoint.z, F.P)
assert.ok(Math.abs(pressureAfterDiffusion - 97.44) < 0.02,
  `pressure diffusion should use the six-neighbor Laplacian (got ${pressureAfterDiffusion})`)

const pressureNoTransportPoint = { x: 54, y: 42, z: 26 }
send('setPhysics', {
  params: { ...params, pressureDensityCoupling: 0, pressureDiffusion: 0 },
  processMask: 1 << 13,
})
send('paint', { ...pressureNoTransportPoint, f: F.P, v: 100, r: 0, mode: 'set' })
send('tick', { speed: 1 })
const pressureWithoutTransport = readField(latestFrame(), pressureNoTransportPoint.x, pressureNoTransportPoint.y, pressureNoTransportPoint.z, F.P)
assert.ok(Math.abs(pressureWithoutTransport - 98.4) < 0.02,
  `zero pressureDiffusion must leave only equation-of-state relaxation (got ${pressureWithoutTransport})`)

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

// Gravity must respond to density gradients on all three axes, including across chunk boundaries.
const gravityPoint = { x: 90, y: 10, z: 7 }
send('setPhysics', { params: { ...params, gravityDensityCoupling: 0.1 }, processMask: 1 << 7 })
send('paint', { ...gravityPoint, f: F.D, v: 0.5, r: 0, mode: 'set' })
send('paint', { x: gravityPoint.x + 1, y: gravityPoint.y, z: gravityPoint.z, f: F.D, v: 1, r: 0, mode: 'set' })
send('paint', { x: gravityPoint.x, y: gravityPoint.y, z: gravityPoint.z + 1, f: F.D, v: 1, r: 0, mode: 'set' })
send('tick', { speed: 1 })
const gravityFrame = latestFrame()
const gravityFx = readField(gravityFrame, gravityPoint.x, gravityPoint.y, gravityPoint.z, F.FX)
const gravityFz = readField(gravityFrame, gravityPoint.x, gravityPoint.y, gravityPoint.z, F.FZ)
const gravityVx = readField(gravityFrame, gravityPoint.x, gravityPoint.y, gravityPoint.z, F.VX)
const gravityVy = readField(gravityFrame, gravityPoint.x, gravityPoint.y, gravityPoint.z, F.VY)
const gravityVz = readField(gravityFrame, gravityPoint.x, gravityPoint.y, gravityPoint.z, F.VZ)
assert.ok(gravityFx < 0, `gravity should respond to the x density gradient (got ${gravityFx})`)
assert.ok(gravityFz < 0, `gravity should respond to the z density gradient across a chunk boundary (got ${gravityFz})`)
assert.ok(gravityVx < 0 && gravityVz < 0, 'gravity must integrate velocity on X and Z')
assert.equal(gravityVy, 0, 'zero Y density gradient must not create Y velocity')

 // Gravity and field rotation must compose instead of rotation overwriting acceleration.
const combinedGravityPoint = { x: 100, y: 20, z: 20 }
send('setPhysics', {
  params: {
    ...params,
    gravityDensityCoupling: 0.1,
    fieldRotationDamping: 1,
    fieldRotationNeighborCoupling: 0,
    fieldRotationCrossCoupling: 0,
  },
  processMask: (1 << 7) | (1 << 14),
})
send('paint', { ...combinedGravityPoint, f: F.D, v: 0.5, r: 0, mode: 'set' })
send('paint', { x: combinedGravityPoint.x + 1, y: combinedGravityPoint.y, z: combinedGravityPoint.z, f: F.D, v: 1, r: 0, mode: 'set' })
send('tick', { speed: 1 })
const combinedGravityFrame = latestFrame()
const combinedGravityFx = readField(
  combinedGravityFrame, combinedGravityPoint.x, combinedGravityPoint.y, combinedGravityPoint.z, F.FX,
)
const combinedGravityVx = readField(
  combinedGravityFrame, combinedGravityPoint.x, combinedGravityPoint.y, combinedGravityPoint.z, F.VX,
)
assert.ok(combinedGravityFx < 0,
  `field rotation must preserve the gravity acceleration when both processes are enabled (got ${combinedGravityFx})`)
assert.ok(combinedGravityVx < 0,
  'gravity must integrate velocity when field rotation is enabled too')

// Neumann world boundaries mirror the center density; they must not create a false force.
const gravityEdgePoint = { x: 0, y: 30, z: 30 }
send('setPhysics', { params: { ...params, gravityDensityCoupling: 0.1 }, processMask: 1 << 7 })
send('paint', { ...gravityEdgePoint, f: F.D, v: 0.5, r: 0, mode: 'set' })
send('paint', { x: gravityEdgePoint.x + 1, y: gravityEdgePoint.y, z: gravityEdgePoint.z, f: F.D, v: 1, r: 0, mode: 'set' })
send('tick', { speed: 1 })
const gravityEdgeFx = readField(
  latestFrame(), gravityEdgePoint.x, gravityEdgePoint.y, gravityEdgePoint.z, F.FX,
)
// ChunkSimWorker advances with a fixed 16 ms step (0.016 s), not 1/60 s.
const expectedGravityEdgeFx = -0.1 * 0.25 * 0.016;
assert.ok(gravityEdgeFx < 0 && Math.abs(gravityEdgeFx - expectedGravityEdgeFx) < 1e-6,
  `worker gravity must use the mirrored Neumann boundary at x=0 (expected ${expectedGravityEdgeFx}, got ${gravityEdgeFx})`)
const gravityEdgeVx = readField(latestFrame(), gravityEdgePoint.x, gravityEdgePoint.y, gravityEdgePoint.z, F.VX)
assert.ok(Math.abs(gravityEdgeVx - expectedGravityEdgeFx) < 1e-6,
  `worker velocity must use the same mirrored-boundary acceleration (got ${gravityEdgeVx})`)

// A sub-threshold acceleration in a previously empty chunk must not be lost
// by the sparse field epsilon at a chunk boundary.
const gravityHaloPoint = { x: 15, y: 50, z: 40 }
send('setPhysics', { params: { ...params, gravityDensityCoupling: 0.1 }, processMask: 1 << 7 })
send('paint', { ...gravityHaloPoint, f: F.D, v: 0.5, r: 0, mode: 'set' })
send('tick', { speed: 1 })
const gravityHaloFx = readField(
  latestFrame(), gravityHaloPoint.x + 1, gravityHaloPoint.y, gravityHaloPoint.z, F.FX,
)
assert.ok(gravityHaloFx > 0 && gravityHaloFx < 0.001,
  `gravity acceleration should allocate a neighboring sparse chunk even below the generic 0.001 threshold (got ${gravityHaloFx})`)
const gravityHaloVx = readField(latestFrame(), gravityHaloPoint.x + 1, gravityHaloPoint.y, gravityHaloPoint.z, F.VX)
assert.ok(gravityHaloVx > 0 && gravityHaloVx < 0.001,
  `gravity must allocate the neighboring velocity chunk below the generic sparse threshold (got ${gravityHaloVx})`)

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
assert.ok(Math.abs(erodedDensity - 0.79232) < 1e-6,
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

// Field rotation must preserve and evolve all three vector components in the worker layout.
const rotationPoint = { x: 60, y: 60, z: 40 }
send('setPhysics', {
  params: {
    ...params,
    fieldRotationDamping: 0.8,
    fieldRotationNeighborCoupling: 0.2,
    fieldRotationCrossCoupling: 0.1,
  },
  processMask: 1 << 14,
})
send('paint', { ...rotationPoint, f: F.FX, v: 10, r: 0, mode: 'set' })
send('paint', { ...rotationPoint, f: F.FY, v: 4, r: 0, mode: 'set' })
send('paint', { ...rotationPoint, f: F.FZ, v: 5, r: 0, mode: 'set' })
send('paint', { x: rotationPoint.x - 1, y: rotationPoint.y, z: rotationPoint.z, f: F.FX, v: 2, r: 0, mode: 'set' })
send('paint', { x: rotationPoint.x - 1, y: rotationPoint.y, z: rotationPoint.z, f: F.FY, v: 6, r: 0, mode: 'set' })
send('paint', { x: rotationPoint.x - 1, y: rotationPoint.y, z: rotationPoint.z, f: F.FZ, v: 7, r: 0, mode: 'set' })
send('tick', { speed: 1 })
const rotatedX = readField(latestFrame(), rotationPoint.x, rotationPoint.y, rotationPoint.z, F.FX)
const rotatedY = readField(latestFrame(), rotationPoint.x, rotationPoint.y, rotationPoint.z, F.FY)
const rotatedZ = readField(latestFrame(), rotationPoint.x, rotationPoint.y, rotationPoint.z, F.FZ)
assert.ok(Math.abs(rotatedX - (10 * 0.8 + (2 / 6) * 0.2 + 4 * 0.1)) < 1e-5,
  `worker rotation must apply X damping, neighbor coupling, and cross coupling (got ${rotatedX})`)
assert.ok(Math.abs(rotatedY - (4 * 0.8 + (6 / 6) * 0.2 - 10 * 0.1)) < 1e-5,
  `worker rotation must apply Y damping, neighbor coupling, and cross coupling (got ${rotatedY})`)
assert.ok(Math.abs(rotatedZ - (5 * 0.8 + (7 / 6) * 0.2)) < 1e-5,
  `worker rotation must preserve the Z component with damping and neighbor coupling (got ${rotatedZ})`)

// A vector-only cell must activate adjacent empty cells for sparse field-rotation coupling.
const vectorHaloPoint = { x: 72, y: 60, z: 40 }
send('setPhysics', {
  params: {
    ...params,
    fieldRotationDamping: 0,
    fieldRotationNeighborCoupling: 0.6,
    fieldRotationCrossCoupling: 0,
  },
  processMask: 1 << 14,
})
send('paint', { ...vectorHaloPoint, f: F.FX, v: 6, r: 0, mode: 'set' })
send('tick', { speed: 1 })
const vectorHaloFx = readField(
  latestFrame(), vectorHaloPoint.x + 1, vectorHaloPoint.y, vectorHaloPoint.z, F.FX,
)
assert.ok(Math.abs(vectorHaloFx - 0.6) < 1e-5,
  `a vector-only source must activate its empty neighbor for rotation coupling (got ${vectorHaloFx})`)

// Density diffusion must conserve total density on the closed worker grid.
function sumSnapshotField(field: number): number {
  send('snapshot')
  const snapshot = messages.filter(message => message.cmd === 'snapshot').at(-1)
  assert.ok(snapshot?.data?.snap, 'worker must expose a complete snapshot for conservation accounting')
  let total = 0
  for (const chunk of snapshot!.data.snap as Array<{ key: number; data: number[] }>) {
    for (let cell = 0; cell < CHUNK_FLOATS / NF; cell++) {
      total += chunk.data[cell * NF + field]
    }
  }
  return total
}
const conservationPoint = { x: 84, y: 84, z: 30 }
send('setPhysics', { params: { ...params, densityDiffusion: 0.0024 }, processMask: 0 })
send('paint', { ...conservationPoint, f: F.D, v: 0.5, r: 0, mode: 'set' })
const densityTotalBefore = sumSnapshotField(F.D)
send('setPhysics', { params: { ...params, densityDiffusion: 0.0024 }, processMask: 1 << 2 })
send('tick', { speed: 1 })
const densityTotalAfter = sumSnapshotField(F.D)
assert.ok(Math.abs(densityTotalAfter - densityTotalBefore) < 1e-5,
  `closed-grid worker density diffusion must conserve total density (before ${densityTotalBefore}, after ${densityTotalAfter})`)

// Conservative advection crosses sparse chunk boundaries without losing mass.
const advectionSource = { x: 23, y: 84, z: 33 }
const advectionDestination = { x: 24, y: 84, z: 33 }
send('setPhysics', {
  params: { ...params, densityDiffusion: 0 },
  processMask: 1 << 16,
})
send('paint', { ...advectionSource, f: F.D, v: 0.5, r: 0, mode: 'set' })
send('paint', { ...advectionSource, f: F.VX, v: 1, r: 0, mode: 'set' })
send('paint', { ...advectionDestination, f: F.VX, v: 1, r: 0, mode: 'set' })
const advectionTotalBefore = sumSnapshotField(F.D)
send('tick', { speed: 1 })
const advectionFrame = latestFrame()
const advectionSourceAfter = readField(
  advectionFrame, advectionSource.x, advectionSource.y, advectionSource.z, F.D,
)
const advectionDestinationAfter = readField(
  advectionFrame, advectionDestination.x, advectionDestination.y, advectionDestination.z, F.D,
)
const advectionTotalAfter = sumSnapshotField(F.D)
assert.ok(advectionSourceAfter < 0.5 && advectionDestinationAfter > 0,
  `velocity must move density across the x=23/24 chunk boundary (source ${advectionSourceAfter}, destination ${advectionDestinationAfter})`)
assert.ok(Math.abs(advectionTotalAfter - advectionTotalBefore) < 1e-5,
  `worker density advection must conserve total density across chunks (before ${advectionTotalBefore}, after ${advectionTotalAfter})`)

console.log(JSON.stringify({
  status: 'PASS',
  energyAfterEnabled,
  energyAfterDisabled,
  tempAfter,
}))
