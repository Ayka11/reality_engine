import { F } from "../src/core/CellState";
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
