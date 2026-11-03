import { CELL_FIELDS, F } from "../src/core/CellState";
import { VoxelGrid } from "../src/core/VoxelGrid";
import { DEFAULT_PARAMS, type PhysicsParams } from "../src/laws/MetaLaw";
import { MAT } from "../src/materials/MaterialDef";
import { PROC } from "../src/process/ProcessDef";
import { EntropyLayer } from "../src/simulation/EntropyLayer";
import { FieldPhysics } from "../src/simulation/FieldPhysics";

export const INTEGRATED_BIOLOGY_PARITY_DT = 0.016;

export const INTEGRATED_BIOLOGY_PARITY_INITIAL = Object.freeze({
  energy: 1000,
  density: 0.5,
  information: 40,
  entropy: 0.1,
  temperature: 0,
  materialId: MAT.VACUUM,
  bioPotential: 0,
  localTime: 0,
});

export const INTEGRATED_BIOLOGY_PARITY_PARAMS: Readonly<PhysicsParams> = Object.freeze({
  ...DEFAULT_PARAMS,
  crystallizationRate: 0.003,
  entropyGrowthRate: 0.001,
  entropyEnergyCoupling: 0.0005,
  metabolismRate: 0.12,
  timeBaseRate: 1,
  timeEnergyBoost: 0.002,
});

export const INTEGRATED_BIOLOGY_PARITY_PROCESS_MASK =
  (1 << PROC.CRYSTALLIZATION) |
  (1 << PROC.ENTROPY_GROWTH) |
  (1 << PROC.BIO_POTENTIAL) |
  (1 << PROC.METABOLISM);

export const INTEGRATED_BIOLOGY_PARITY_FIELDS = [
  "energy",
  "density",
  "information",
  "entropy",
  "materialId",
  "bioPotential",
  "localTime",
] as const;

export type IntegratedBiologyParityState = {
  energy: number;
  density: number;
  information: number;
  entropy: number;
  materialId: number;
  bioPotential: number;
  localTime: number;
};

export function runIntegratedBiologyParityReference(): IntegratedBiologyParityState {
  const grid = new VoxelGrid(3, 3, 3);
  const base = grid.idx(1, 1, 1);
  const initial = INTEGRATED_BIOLOGY_PARITY_INITIAL;

  grid.buffer[base + F.ENERGY] = initial.energy;
  grid.buffer[base + F.DENSITY] = initial.density;
  grid.buffer[base + F.INFORMATION] = initial.information;
  grid.buffer[base + F.ENTROPY] = initial.entropy;
  grid.buffer[base + F.TEMPERATURE] = initial.temperature;
  grid.buffer[base + F.MATERIAL_ID] = initial.materialId;
  grid.buffer[base + F.BIO_POTENTIAL] = initial.bioPotential;
  grid.buffer[base + F.LOCAL_TIME] = initial.localTime;
  grid.snapshot();

  // The dense CPU solver is the reference operator split:
  // all field/material transformations first, then entropy/biology/metabolism.
  new FieldPhysics().tick(
    grid,
    INTEGRATED_BIOLOGY_PARITY_DT,
    INTEGRATED_BIOLOGY_PARITY_PARAMS,
    INTEGRATED_BIOLOGY_PARITY_PROCESS_MASK,
  );
  new EntropyLayer().tick(
    grid,
    INTEGRATED_BIOLOGY_PARITY_DT,
    INTEGRATED_BIOLOGY_PARITY_PARAMS,
    INTEGRATED_BIOLOGY_PARITY_PROCESS_MASK,
  );

  return {
    energy: grid.buffer[base + F.ENERGY],
    density: grid.buffer[base + F.DENSITY],
    information: grid.buffer[base + F.INFORMATION],
    entropy: grid.buffer[base + F.ENTROPY],
    materialId: grid.buffer[base + F.MATERIAL_ID],
    bioPotential: grid.buffer[base + F.BIO_POTENTIAL],
    localTime: grid.buffer[base + F.LOCAL_TIME],
  };
}


export const HIGH_TEMPERATURE_PARITY_DT = 0.016;
export const HIGH_TEMPERATURE_PARITY_INITIAL = Object.freeze({
  temperature: 2100,
  materialId: MAT.VACUUM,
});
export const HIGH_TEMPERATURE_PARITY_PARAMS: Readonly<PhysicsParams> = Object.freeze({
  ...DEFAULT_PARAMS,
  tempDiffusion: 0.01,
  tempEnergyCoupling: 0,
});
export const HIGH_TEMPERATURE_PARITY_PROCESS_MASK = 1 << PROC.TEMP_DIFFUSION;

export function runDenseHighTemperatureDiffusionReference(): number {
  const grid = new VoxelGrid(3, 3, 3);
  const base = grid.idx(1, 1, 1);
  grid.buffer[base + F.TEMPERATURE] = HIGH_TEMPERATURE_PARITY_INITIAL.temperature;
  grid.buffer[base + F.MATERIAL_ID] = HIGH_TEMPERATURE_PARITY_INITIAL.materialId;
  grid.snapshot();
  new FieldPhysics().tick(
    grid,
    HIGH_TEMPERATURE_PARITY_DT,
    HIGH_TEMPERATURE_PARITY_PARAMS,
    HIGH_TEMPERATURE_PARITY_PROCESS_MASK,
  );
  return grid.buffer[base + F.TEMPERATURE];
}


export const INTEGRATED_FIELD_PARITY_SIZE = 5;
export const INTEGRATED_FIELD_PARITY_OFFSET = 1;
export const INTEGRATED_FIELD_PARITY_DT = 0.016;

export const INTEGRATED_FIELD_PARITY_PARAMS: Readonly<PhysicsParams> = Object.freeze({
  ...DEFAULT_PARAMS,
  energyDiffusion: 0.05,
  tempDiffusion: 0.01,
  tempEnergyCoupling: 0.005,
  densityDiffusion: 0.0024,
  pressureDiffusion: 0.08,
  pressureDensityCoupling: 100,
  phaseTransitionRate: 0.008,
  crystallizationRate: 0.003,
  metabolismRate: 0.12,
  signalPropagationRate: 0.06,
  radiationDensityRate: 0.00008,
  radiationEnergyRate: 0.0001,
  radiationThreshold: 400,
  erosionRate: 0.0018,
  fieldRotationDamping: 0.94,
  fieldRotationNeighborCoupling: 0.05,
  fieldRotationCrossCoupling: 0.01,
  entropyGrowthRate: 0.001,
  entropyEnergyCoupling: 0.0005,
  infoGrowthRate: 0.3,
  infoEntropySupp: 0.5,
  infoGrowthThreshE: 100,
  infoGrowthThreshD: 0.3,
  gravityDensityCoupling: 0.1,
  waveSpeed: 2,
  waveDamping: 0.98,
  timeBaseRate: 1,
  timeEnergyBoost: 0.002,
});

export const INTEGRATED_FIELD_PARITY_PROCESS_MASK = [
  PROC.ENERGY_DIFFUSION,
  PROC.TEMP_DIFFUSION,
  PROC.DENSITY_FLOW,
  PROC.ENTROPY_GROWTH,
  PROC.INFORMATION,
  PROC.BIO_POTENTIAL,
  PROC.WAVE_PROPAGATION,
  PROC.GRAVITY,
  PROC.PHASE_TRANSITION,
  PROC.METABOLISM,
  PROC.SIGNAL_PROPAGATION,
  PROC.CRYSTALLIZATION,
  PROC.RADIATION,
  PROC.PRESSURE_DIFFUSION,
  PROC.FIELD_ROTATION,
  PROC.EROSION,
  PROC.DENSITY_ADVECTION,
].reduce((mask, process) => mask | (1 << process), 0);

export const INTEGRATED_FIELD_PARITY_FIELDS = [
  ["energy", F.ENERGY],
  ["density", F.DENSITY],
  ["information", F.INFORMATION],
  ["entropy", F.ENTROPY],
  ["temperature", F.TEMPERATURE],
  ["pressure", F.PRESSURE],
  ["fieldX", F.FIELD_X],
  ["fieldY", F.FIELD_Y],
  ["fieldZ", F.FIELD_Z],
  ["localTime", F.LOCAL_TIME],
  ["bioPotential", F.BIO_POTENTIAL],
  ["wavePhase", F.WAVE_PHASE],
  ["waveAmplitude", F.WAVE_AMP],
  ["materialId", F.MATERIAL_ID],
  ["velocityX", F.VELOCITY_X],
  ["velocityY", F.VELOCITY_Y],
  ["velocityZ", F.VELOCITY_Z],
] as const;

export function createIntegratedFieldParityInitialCells(): Float32Array {
  const size = INTEGRATED_FIELD_PARITY_SIZE;
  const cells = new Float32Array(size * size * size * CELL_FIELDS);
  for (let z = 1; z <= 3; z++) {
    for (let y = 1; y <= 3; y++) {
      for (let x = 1; x <= 3; x++) {
        const center = x === 2 && y === 2 && z === 2;
        const base = ((z * size + y) * size + x) * CELL_FIELDS;
        const gradient = x * 0.013 + y * 0.009 + z * 0.006;
        cells[base + F.ENERGY] = center ? 1200 : 650 + 30 * gradient;
        cells[base + F.DENSITY] = center ? 0.8 : 0.42 + gradient;
        cells[base + F.INFORMATION] = center ? 50 : 25 + 5 * gradient;
        cells[base + F.ENTROPY] = center ? 0.1 : 0.13 + gradient * 0.02;
        cells[base + F.TEMPERATURE] = center ? 600 : 350 + 20 * (x + y + z);
        cells[base + F.PRESSURE] = center ? 80 : 35 + 3 * (x + y + z);
        cells[base + F.FIELD_X] = center ? 4 : 0.2 * x;
        cells[base + F.FIELD_Y] = center ? 4 : 0.15 * y;
        cells[base + F.FIELD_Z] = center ? 4 : 0.1 * z;
        cells[base + F.LOCAL_TIME] = 0.1 + gradient * 0.01;
        cells[base + F.BIO_POTENTIAL] = 0.2;
        cells[base + F.WAVE_PHASE] = center ? 0.7 : 0.15 * gradient;
        cells[base + F.WAVE_AMP] = center ? 0.8 : 0.1;
        cells[base + F.MATERIAL_ID] = MAT.STONE;
        cells[base + F.VELOCITY_X] = center ? 0.2 : 0.08 * x;
        cells[base + F.VELOCITY_Y] = center ? -0.1 : -0.03 * y;
        cells[base + F.VELOCITY_Z] = center ? 0.05 : 0.02 * z;
      }
    }
  }
  return cells;
}

export function runDenseIntegratedFieldParityReference(): Float32Array {
  const size = INTEGRATED_FIELD_PARITY_SIZE;
  const grid = new VoxelGrid(size, size, size);
  grid.buffer.set(createIntegratedFieldParityInitialCells());
  grid.snapshot();
  new FieldPhysics().tick(
    grid,
    INTEGRATED_FIELD_PARITY_DT,
    INTEGRATED_FIELD_PARITY_PARAMS,
    INTEGRATED_FIELD_PARITY_PROCESS_MASK,
  );
  new EntropyLayer().tick(
    grid,
    INTEGRATED_FIELD_PARITY_DT,
    INTEGRATED_FIELD_PARITY_PARAMS,
    INTEGRATED_FIELD_PARITY_PROCESS_MASK,
  );
  return new Float32Array(grid.buffer);
}
