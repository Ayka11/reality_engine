import assert from 'node:assert/strict'
import fs from 'node:fs/promises'

const worker = await fs.readFile('src/core/ChunkSimWorker.ts', 'utf8')
const chunkGrid = await fs.readFile('src/core/ChunkGrid.ts', 'utf8')
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

// Density diffusion uses a conservative six-neighbor Laplacian with mirrored closed boundaries.
assert.ok(cpu.includes('let lapD = -nCount * cD;'))
assert.ok(gpu.includes('var nbD = array<f32,6>(c.density,c.density,c.density,c.density,c.density,c.density);'))
assert.ok(gpu.includes('lapD += nbD[d] - c.density;'))
assert.ok(worker.includes('lapD -= nc * D_'))
assert.ok((await fs.readFile('scripts/check-field-physics-matrix.ts', 'utf8'))
  .includes('density diffusion failed the closed-grid mass-conservation check'))
assert.ok((await fs.readFile('scripts/check-chunk-worker-physics.ts', 'utf8'))
  .includes('closed-grid worker density diffusion must conserve total density'))

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

// Sparse worker's transferable cell layout must carry the full 3D field vector.
assert.ok(chunkGrid.includes('export const NF = 18'))
assert.ok(chunkGrid.includes('VX:  15'))
assert.ok(chunkGrid.includes('VY:  16'))
assert.ok(chunkGrid.includes('VZ:  17'))
assert.ok(chunkGrid.includes('FZ:  14'))
assert.ok(gpu.includes('velocity_x:   f32,  // 21'))
assert.ok(gpu.includes('velocity_y:   f32,  // 22'))
assert.ok(gpu.includes('velocity_z:   f32,  // 23'))
assert.ok(main.includes("import { CHUNK_FLOATS } from './core/ChunkGrid';"))
assert.ok(main.includes('const CF = CHUNK_FLOATS;'))
assert.ok(worker.includes('F.FZ'))
assert.ok(worker.includes('const accelerationZ = -p.gravityDensityCoupling * (frontD - backD) * 0.5'))
assert.ok(worker.includes('nextFZ += accelerationZ * dt'))
assert.ok(worker.includes('grid.set(x, y, z, F.VZ, VZ + accelerationZ * dt)'),
  'worker gravity must apply the z-axis density gradient to field vector and dedicated velocity')

// Field rotation is parameterized and process-mask gated in all available paths.
assert.ok(cpu.includes('p.fieldRotationDamping'))
assert.ok(cpu.includes('p.fieldRotationNeighborCoupling'))
assert.ok(cpu.includes('p.fieldRotationCrossCoupling'))
assert.ok(worker.includes('FX * p.fieldRotationDamping'))
assert.ok(worker.includes('p.fieldRotationNeighborCoupling'))
assert.ok(worker.includes('p.fieldRotationCrossCoupling'))
assert.ok(worker.includes('const activationFields = [F.E, F.T, F.D, F.I, F.P, F.WAVE, F.FX, F.FY, F.FZ, F.VX, F.VY, F.VZ]'))
assert.ok(worker.includes('fzSum += sourceRead(nx, ny, nz, F.FZ)'))
assert.ok(worker.includes('nextFZ = rotateFZ * p.fieldRotationDamping + fzSum / Math.max(nc, 1) * p.fieldRotationNeighborCoupling'))
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

// Process registry metadata must describe the implemented operators, not aspirational physics.
assert.ok(defs.includes("Density smooths through a six-neighbor Laplacian"))
assert.ok(defs.includes("outputs:['fieldVector','velocity']"))
assert.ok(defs.includes("mass transport is a separate process"))
assert.ok(defs.includes("inputs:['fieldVector'], outputs:['fieldVector']"))
assert.ok(!defs.includes("Mass flows along pressure gradients."))
assert.ok(!defs.includes("Density curves the field, attracting mass."))
assert.ok(defs.includes("Pressure diffuses between neighbors and relaxes toward a density/temperature equilibrium."))
assert.ok(defs.includes("inputs:['pressure','density','temperature'], outputs:['pressure']"))
assert.ok(defs.includes("inputs:['density','fieldVector','materialId'], outputs:['density','information']"))

// CPU, GPU, and sparse worker use the same density-gradient acceleration model.
assert.ok(cpu.includes('p.gravityDensityCoupling * (rightD - leftD)'))
assert.ok(cpu.includes('p.gravityDensityCoupling * (upD - downD)'))
assert.ok(cpu.includes('p.gravityDensityCoupling * (frontD - backD)'))
assert.ok(cpu.includes('nextVx += accelerationX * dt') && cpu.includes('nextVy += accelerationY * dt') && cpu.includes('nextVz += accelerationZ * dt'))
assert.ok(gpu.includes('if (active(128u))'))
assert.ok(gpu.includes('params.gravityDensityCoupling * (nbD[1] - nbD[0])'))
assert.ok(gpu.includes('params.gravityDensityCoupling * (nbD[3] - nbD[2])'))
assert.ok(gpu.includes('params.gravityDensityCoupling * (nbD[5] - nbD[4])'))
assert.ok(gpu.includes('o.velocity_x = c.velocity_x + acceleration_x * dt'))
assert.ok(gpu.includes('o.velocity_y = c.velocity_y + acceleration_y * dt'))
assert.ok(gpu.includes('o.velocity_z = c.velocity_z + acceleration_z * dt'))
assert.ok(worker.includes('p.gravityDensityCoupling * (rightD - leftD)'))
assert.ok(worker.includes('grid.set(x, y, z, F.VX, VX + accelerationX * dt)'))
assert.ok(worker.includes('grid.set(x, y, z, F.VY, VY + accelerationY * dt)'))
assert.ok(worker.includes('grid.set(x, y, z, F.VZ, VZ + accelerationZ * dt)'))
assert.ok(worker.includes('p.gravityDensityCoupling * (upD - downD)'))
assert.ok(worker.includes('p.gravityDensityCoupling * (frontD - backD)'))
// Gravity acceleration must survive same-tick field rotation on all backends.
assert.ok(cpu.includes('const rotateFx = nextFx, rotateFy = nextFy, rotateFz = nextFz'))
assert.ok(gpu.includes('let rotateFx = o.field_x;'))
assert.ok(worker.includes('const rotateFX = nextFX, rotateFY = nextFY, rotateFZ = nextFZ'))

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
