import assert from 'node:assert/strict';
import { VoxelGrid } from '../src/core/VoxelGrid.ts';
import { F } from '../src/core/CellState.ts';
import { DEFAULT_PARAMS } from '../src/laws/MetaLaw.ts';
import { PROC } from '../src/process/ProcessDef.ts';
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

console.log('FieldPhysics pressure diffusion/mask/parameter regression: PASS');
