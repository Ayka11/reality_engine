import assert from 'node:assert/strict';
import { VoxelGrid } from '../src/core/VoxelGrid.ts';
import { F } from '../src/core/CellState.ts';
import { DEFAULT_PARAMS } from '../src/laws/MetaLaw.ts';
import { PROC } from '../src/process/ProcessDef.ts';
import { MAT, MATERIAL_LIBRARY } from '../src/materials/MaterialDef.ts';
import { FieldPhysics } from '../src/simulation/FieldPhysics.ts';

function runPressure(mask: number, pressureDiffusion: number): number {
  const grid = new VoxelGrid(3, 3, 3);
  const pressureIndex = grid.idx(1, 1, 1) + F.PRESSURE;
  grid.buffer[pressureIndex] = 100;
  grid.snapshot();

  new FieldPhysics().tick(
    grid,
    1 / 60,
    { ...DEFAULT_PARAMS, pressureDensityCoupling: 0, pressureDiffusion },
    mask,
  );
  return grid.buffer[pressureIndex];
}

const disabled = runPressure(0, 0.1);
assert.ok(Math.abs(disabled - 100) < 1e-5,
  `disabled pressure diffusion must leave pressure unchanged (got ${disabled})`);

const noTransport = runPressure(1 << PROC.PRESSURE_DIFFUSION, 0);
assert.ok(Math.abs(noTransport - (100 - 100 / 60)) < 1e-4,
  `pressure must relax toward the equation of state when transport is zero (got ${noTransport})`);

const transported = runPressure(1 << PROC.PRESSURE_DIFFUSION, 0.1);
assert.ok(Math.abs(transported - (100 - 100 / 60 - 1)) < 1e-4,
  `pressureDiffusion must transport pressure through the six-neighbor Laplacian (got ${transported})`);
assert.ok(transported < noTransport,
  'positive pressure diffusion must lower an isolated high-pressure cell');
assert.ok([disabled, noTransport, transported].every(Number.isFinite),
  'pressure transport and relaxation must preserve finite values');


function runMaterialPressure(materialId: number): number {
  const grid = new VoxelGrid(3, 3, 3);
  const base = grid.idx(1, 1, 1);
  grid.buffer[base + F.DENSITY] = 0.5;
  grid.buffer[base + F.TEMPERATURE] = 0;
  grid.buffer[base + F.PRESSURE] = 0;
  grid.buffer[base + F.MATERIAL_ID] = materialId;
  grid.snapshot();
  new FieldPhysics().tick(grid, 1 / 60, {
    ...DEFAULT_PARAMS,
    pressureDensityCoupling: 100,
    pressureDiffusion: 0,
  }, 1 << PROC.PRESSURE_DIFFUSION);
  return grid.buffer[base + F.PRESSURE];
}

for (const materialId of [MAT.STONE, MAT.METAL]) {
  const material = MATERIAL_LIBRARY[materialId];
  const pressure = runMaterialPressure(materialId);
  const expected = 50 * material.elasticity / 60;
  assert.ok(Math.abs(pressure - expected) < 1e-5,
    `pressure response must scale with ${material.name} elasticity (expected ${expected}, got ${pressure})`);
}

console.log('FieldPhysics pressure diffusion/mask/parameter regression: PASS');
