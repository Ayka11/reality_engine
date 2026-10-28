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
assert.ok(gpu.includes('const PARAMS_FLOATS = 31;'))
assert.ok(gpu.includes('f32[20] = p.erosionRate;'))
assert.ok(gpu.includes('params.erosionRate * (1.0 - resistance)'))
assert.ok(gpu.includes('flow > 8.0'))

// Pressure diffusion must be parameterized in the GPU ABI and used by the shader.
assert.ok(gpu.includes('pressureDiffusion: f32,       // [21]'))
assert.ok(gpu.includes('const PARAMS_FLOATS = 31;'))
assert.ok(gpu.includes('f32[21] = p.pressureDiffusion;'))
assert.ok(gpu.includes('var nbP = array<f32,6>(c.pressure,c.pressure,c.pressure,c.pressure,c.pressure,c.pressure);'))
assert.ok(gpu.includes('lapP += nbP[d] - c.pressure;'))
assert.ok(gpu.includes('params.pressureDiffusion * dt * lapP'))
assert.ok(worker.includes('D_ * p.pressureDensityCoupling - T * 0.1'))
assert.ok(worker.includes('P + p.pressureDiffusion * lapP * dt'))

// Density flow must use its dedicated coefficient in CPU, GPU, and worker paths.
assert.ok(gpu.includes('densityDiffusion: f32,        // [22]'))
assert.ok(gpu.includes('const PARAMS_FLOATS = 31;'))
assert.ok(gpu.includes('f32[22] = p.densityDiffusion;'))
assert.ok(gpu.includes('params.densityDiffusion * dt * lapD'))
assert.ok(worker.includes('p.densityDiffusion * lapD * dt'))

// Phase transition rate is a shared model parameter, not a backend-specific constant.
assert.ok(cpu.includes('p.phaseTransitionRate * dt * 60'))
assert.ok(cpu.includes('p.phaseTransitionRate * 0.5 * dt * 60'))
assert.ok(worker.includes('p.phaseTransitionRate * dt * 60'))
assert.ok(gpu.includes('phaseTransitionRate: f32,     // [23]'))
assert.ok(gpu.includes('const PARAMS_FLOATS = 31;'))
assert.ok(gpu.includes('f32[23] = p.phaseTransitionRate;'))
assert.ok(gpu.includes('params.phaseTransitionRate * dt * 60.0'))
assert.ok(gpu.includes('params.phaseTransitionRate * 0.5 * dt * 60.0'))
 
// Crystallization uses the canonical configured rate and material multiplier on all backends.
assert.ok(cpu.includes('p.crystallizationRate * materialRate'))
assert.ok(cpu.includes('rate > 0 && (materialIndex === MAT.VACUUM'))
assert.ok(cpu.includes('front[base + F.MATERIAL_ID] = MAT.CRYSTAL'))
assert.ok(worker.includes('p.crystallizationRate * materialRate'))
assert.ok(worker.includes('rate > 0 && (currentMaterialId === MAT.VACUUM'))
assert.ok(gpu.includes('crystallizationRate: f32,     // [24]'))
assert.ok(gpu.includes('const PARAMS_FLOATS = 31;'))
assert.ok(gpu.includes('f32[24] = p.crystallizationRate;'))
assert.ok(gpu.includes('params.crystallizationRate * materialRate'))
assert.ok(gpu.includes('cRate > 0.0 && (matIdx == 0u || matIdx == 1u || matIdx == 2u)'))
assert.ok(gpu.includes('o.material_id = 3.0;'))


// Radiation uses shared model parameters and material absorption across all backends.
assert.ok(cpu.includes('p.radiationThreshold'))
assert.ok(cpu.includes('p.radiationDensityRate'))
assert.ok(cpu.includes('p.radiationEnergyRate'))
assert.ok(cpu.includes('material.radiationAbsorption'))
assert.ok(worker.includes('E > p.radiationThreshold'))
assert.ok(worker.includes('p.radiationDensityRate * (1 - material.radiationAbsorption)'))
assert.ok(worker.includes('p.radiationEnergyRate'))
assert.ok(gpu.includes('radiationDensityRate: f32,   // [25]'))
assert.ok(gpu.includes('radiationEnergyRate: f32,    // [26]'))
assert.ok(gpu.includes('radiationThreshold: f32,     // [27]'))
assert.ok(gpu.includes('f32[25] = p.radiationDensityRate;'))
assert.ok(gpu.includes('f32[26] = p.radiationEnergyRate;'))
assert.ok(gpu.includes('f32[27] = p.radiationThreshold;'))
assert.ok(gpu.includes('params.radiationDensityRate * (1.0 - absorbed)'))
assert.ok(gpu.includes('params.radiationEnergyRate'))
assert.ok(gpu.includes('c.energy > params.radiationThreshold'))

// Field rotation is parameterized and process-mask gated in all available paths.
assert.ok(cpu.includes('p.fieldRotationDamping'))
assert.ok(cpu.includes('p.fieldRotationNeighborCoupling'))
assert.ok(cpu.includes('p.fieldRotationCrossCoupling'))
assert.ok(worker.includes('FX * p.fieldRotationDamping'))
assert.ok(worker.includes('p.fieldRotationNeighborCoupling'))
assert.ok(worker.includes('p.fieldRotationCrossCoupling'))
assert.ok(gpu.includes('fieldRotationDamping: f32,   // [28]'))
assert.ok(gpu.includes('fieldRotationNeighborCoupling: f32, // [29]'))
assert.ok(gpu.includes('fieldRotationCrossCoupling: f32, // [30]'))
assert.ok(gpu.includes('f32[28] = p.fieldRotationDamping;'))
assert.ok(gpu.includes('f32[29] = p.fieldRotationNeighborCoupling;'))
assert.ok(gpu.includes('f32[30] = p.fieldRotationCrossCoupling;'))
assert.ok(gpu.includes('params.fieldRotationDamping'))
assert.ok(gpu.includes('params.fieldRotationNeighborCoupling'))
assert.ok(gpu.includes('params.fieldRotationCrossCoupling'))
assert.ok(gpu.includes('fieldNeighborCount += 1.0;'))
assert.ok(gpu.includes('if (active(16384u))'))
assert.ok(!gpu.includes('o.field_x = c.field_x * 0.95'))

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
