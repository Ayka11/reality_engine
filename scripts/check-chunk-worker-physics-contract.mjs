import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

const worker = await fs.readFile('src/core/ChunkSimWorker.ts', 'utf8')
const main = await fs.readFile('src/main.ts', 'utf8')
const defs = await fs.readFile('src/process/ProcessDef.ts', 'utf8')
const params = await fs.readFile('src/laws/MetaLaw.ts', 'utf8')

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

console.log('Chunk worker physics parameter/mask contract: PASS')
