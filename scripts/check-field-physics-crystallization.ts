import assert from 'node:assert/strict';
import { VoxelGrid } from '../src/core/VoxelGrid.ts';
import { F } from '../src/core/CellState.ts';
import { DEFAULT_PARAMS } from '../src/laws/MetaLaw.ts';
import { MAT } from '../src/materials/MaterialDef.ts';
import { PROC } from '../src/process/ProcessDef.ts';
import { FieldPhysics } from '../src/simulation/FieldPhysics.ts';

type Result = { density: number; entropy: number; materialId: number };

function runCrystallization(materialId: number, rate: number, mask = 1 << PROC.CRYSTALLIZATION): Result {
  const grid = new VoxelGrid(3, 3, 3);
  const base = grid.idx(1, 1, 1);
  grid.buffer[base + F.DENSITY] = 0.5;
  grid.buffer[base + F.ENTROPY] = 0.1;
  grid.buffer[base + F.MATERIAL_ID] = materialId;
  grid.snapshot();

  new FieldPhysics().tick(grid, 1 / 60, { ...DEFAULT_PARAMS, crystallizationRate: rate }, mask);
  return {
    density: grid.buffer[base + F.DENSITY],
    entropy: grid.buffer[base + F.ENTROPY],
    materialId: grid.buffer[base + F.MATERIAL_ID],
  };
}

const disabled = runCrystallization(MAT.STONE, DEFAULT_PARAMS.crystallizationRate, 0);
assert.equal(disabled.density, Math.fround(0.5), 'disabled crystallization must not change density');
assert.equal(disabled.entropy, Math.fround(0.1), 'disabled crystallization must not change entropy');
assert.equal(disabled.materialId, MAT.STONE, 'disabled crystallization must not change material');

const zeroRate = runCrystallization(MAT.STONE, 0);
assert.equal(zeroRate.density, Math.fround(0.5), 'zero rate must not change density');
assert.equal(zeroRate.entropy, Math.fround(0.1), 'zero rate must not change entropy');
assert.equal(zeroRate.materialId, MAT.STONE, 'zero rate must not convert material');

const vacuum = runCrystallization(MAT.VACUUM, 0.003);
assert.ok(Math.abs(vacuum.density - 0.50024) < 1e-6, `vacuum uses unit material multiplier (got ${vacuum.density})`);
assert.equal(vacuum.materialId, MAT.CRYSTAL, 'vacuum may crystallize into crystal');

const stone = runCrystallization(MAT.STONE, 0.003);
assert.ok(Math.abs(stone.density - 0.50012) < 1e-6, `stone uses 0.5 material multiplier (got ${stone.density})`);
assert.equal(stone.materialId, MAT.CRYSTAL, 'stone may crystallize into crystal');

const sand = runCrystallization(MAT.SAND, 0.003);
assert.ok(Math.abs(sand.density - 0.500072) < 1e-6, `sand uses 0.3 material multiplier (got ${sand.density})`);
assert.equal(sand.materialId, MAT.CRYSTAL, 'sand may crystallize into crystal');

const metal = runCrystallization(MAT.METAL, 0.003);
assert.ok(Math.abs(metal.density - 0.50036) < 1e-6, `metal uses 1.5 material multiplier (got ${metal.density})`);
assert.equal(metal.materialId, MAT.METAL, 'ineligible material must not convert');

assert.ok([disabled, zeroRate, vacuum, stone, sand, metal].every(r =>
  [r.density, r.entropy, r.materialId].every(Number.isFinite)),
  'crystallization must preserve finite fields');

console.log('FieldPhysics crystallization rate/mask/material regression: PASS');
