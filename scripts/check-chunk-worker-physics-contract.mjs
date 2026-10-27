import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

const worker = await fs.readFile('src/core/ChunkSimWorker.ts', 'utf8')
const cpu = await fs.readFile('src/simulation/FieldPhysics.ts', 'utf8')
const main = await fs.readFile('src/main.ts', 'utf8')
const defs = await fs.readFile('src/process/ProcessDef.ts', 'utf8')
const params = await fs.readFile('src/laws/MetaLaw.ts', 'utf8')
const gpu = await fs.readFile('src/gpu/GPUBackend.ts', 'utf8')

// The sparse worker must use the canonical bitmask, not its former string Set.
assert.ok(worker.includes("import { PROC, defaultProcessMask } from '../process/ProcessDef'"))
assert.ok(worker.includes("import { DEFAULT_PARAMS, type PhysicsParams } from '../laws/MetaLaw'"))
assert.ok(worker.includes('let physicsParams: PhysicsParams = { ...DEFAULT_PARAMS }'))
assert.ok(worker.includes('let processMask = defaultProcessMask()'))
assert.ok(worker.includes("cmd === 'setPhysics'"))
assert.ok(!worker.includes('activeProcs'), 'legacy Set<string> activation must not return')
assert.ok(worker.includes('isProcessActive(PROC.ENERGY_DIFFUSION)'))
assert.ok(worker.includes('p.energyDiffusion * lapE * dt'))
assert.ok(worker.includes('p.tempDiffusion * lapT * dt'))
assert.ok(worker.includes('p.tempEnergyCoupling'))
assert.ok(worker.includes('p.entropyGrowthRate'))
assert.ok(worker.includes('p.entropyEnergyCoupling'))
assert.ok(worker.includes('p.infoGrowthThreshE'))
assert.ok(worker.includes('p.infoGrowthThreshD'))
assert.ok(worker.includes('p.infoEntropySupp'))
assert.ok(worker.includes('p.timeBaseRate'))
assert.ok(worker.includes('p.timeEnergyBoost'))

// Erosion uses the canonical rate and the same threshold across backends.
assert.ok(worker.includes('density > 0.65 && flow > 8.0'))
assert.ok(gpu.includes('erosionRate: f32,            // [20]'))
assert.ok(gpu.includes('const PARAMS_FLOATS = 23;'))
assert.ok(gpu.includes('f32[20] = p.erosionRate;'))
assert.ok(gpu.includes('params.erosionRate * (1.0 - resistance)'))
assert.ok(gpu.includes('flow > 8.0'))

// Pressure diffusion must be parameterized in the GPU ABI and used by the shader.
assert.ok(gpu.includes('pressureDiffusion: f32,       // [21]'))
assert.ok(gpu.includes('const PARAMS_FLOATS = 23;'))
assert.ok(gpu.includes('f32[21] = p.pressureDiffusion;'))
assert.ok(gpu.includes('var nbP = array<f32,6>(c.pressure,c.pressure,c.pressure,c.pressure,c.pressure,c.pressure);'))
assert.ok(gpu.includes('lapP += nbP[d] - c.pressure;'))
assert.ok(gpu.includes('params.pressureDiffusion * dt * lapP'))
assert.ok(worker.includes('D_ * p.pressureDensityCoupling - T * 0.1'))
assert.ok(worker.includes('P + p.pressureDiffusion * lapP * dt'))

// Density flow must use its dedicated coefficient in CPU, GPU, and worker paths.
assert.ok(gpu.includes('densityDiffusion: f32,        // [22]'))
assert.ok(gpu.includes('const PARAMS_FLOATS = 23;'))
assert.ok(gpu.includes('f32[22] = p.densityDiffusion;'))
assert.ok(gpu.includes('params.densityDiffusion * dt * lapD'))
assert.ok(worker.includes('p.densityDiffusion * lapD * dt'))

// Phase transition rate is a shared model parameter, not a backend-specific constant.
assert.ok(cpu.includes('p.phaseTransitionRate * dt * 60'))
assert.ok(cpu.includes('p.phaseTransitionRate * 0.5 * dt * 60'))
assert.ok(worker.includes('p.phaseTransitionRate * dt * 60'))
assert.ok(gpu.includes('phaseTransitionRate: f32,     // [23]'))
assert.ok(gpu.includes('const PARAMS_FLOATS = 24;'))
assert.ok(gpu.includes('f32[23] = p.phaseTransitionRate;'))
assert.ok(gpu.includes('params.phaseTransitionRate * dt * 60.0'))
assert.ok(gpu.includes('params.phaseTransitionRate * 0.5 * dt * 60.0'))

// Main must forward resolved LawEngine state to the sparse worker at startup and ticks.
assert.ok(main.includes("cmd: 'setPhysics'"))
assert.ok(main.includes('params: { ...sim.laws.params }'))
assert.ok(main.includes('processMask: sim.laws.activeProcessMask'))
assert.ok(main.includes('syncChunkWorkerPhysics();'))

// Keep the process IDs and parameter contract discoverable from the canonical definitions.
for (const process of [
  'ENERGY_DIFFUSION', 'TEMP_DIFFUSION', 'DENSITY_FLOW', 'ENTROPY_GROWTH',
  'INFORMATION', 'BIO_POTENTIAL', 'WAVE_PROPAGATION', 'GRAVITY',
  'PHASE_TRANSITION', 'METABOLISM', 'SIGNAL_PROPAGATION', 'CRYSTALLIZATION',
  'RADIATION', 'PRESSURE_DIFFUSION', 'FIELD_ROTATION', 'EROSION',
]) assert.ok(defs.includes(process), `missing process registry entry: ${process}`)
for (const parameter of [
  'energyDiffusion', 'tempDiffusion', 'tempEnergyCoupling', 'densityDiffusion',
  'pressureDiffusion', 'pressureDensityCoupling', 'phaseTransitionRate', 'crystallizationRate',
  'metabolismRate', 'signalPropagationRate', 'radiationDensityRate', 'radiationEnergyRate',
  'radiationThreshold', 'erosionRate', 'fieldRotationDamping',
  'fieldRotationNeighborCoupling', 'fieldRotationCrossCoupling',
  'entropyGrowthRate', 'entropyEnergyCoupling',
  'infoGrowthRate', 'infoEntropySupp', 'infoGrowthThreshE',
  'infoGrowthThreshD', 'waveSpeed', 'waveDamping',
  'gravityDensityCoupling', 'timeBaseRate', 'timeEnergyBoost',
]) assert.ok(params.includes(parameter), `missing PhysicsParams field: ${parameter}`)

console.log('CPU/GPU/chunk-worker physics parameter/mask contract: PASS')
