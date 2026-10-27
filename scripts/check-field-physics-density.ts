import assert from 'node:assert/strict';
import { VoxelGrid } from '../src/core/VoxelGrid.ts';
import { F } from '../src/core/CellState.ts';
import { DEFAULT_PARAMS } from '../src/laws/MetaLaw.ts';
import { PROC } from '../src/process/ProcessDef.ts';
import { FieldPhysics } from '../src/simulation/FieldPhysics.ts';

function runDensity(mask: number, densityDiffusion: number): number {
  const grid = new VoxelGrid(3, 3, 3);
  const densityIndex = grid.idx(1, 1, 1) + F.DENSITY;
  grid.buffer[densityIndex] = 0.5;
  grid.snapshot();

  new FieldPhysics().tick(
    grid,
    1 / 60,
    { ...DEFAULT_PARAMS, energyDiffusion: 0.1, densityDiffusion },
    mask,
  );
  return grid.buffer[densityIndex];
}

const disabled = runDensity(0, 0.0024);
assert.ok(Math.abs(disabled - 0.5) < 1e-6,
  `disabled density flow must leave density unchanged (got ${disabled})`);

const noMobility = runDensity(1 << PROC.DENSITY_FLOW, 0);
assert.ok(Math.abs(noMobility - 0.5) < 1e-6,
  `zero densityDiffusion must prevent transport even when energyDiffusion is nonzero (got ${noMobility})`);

const transported = runDensity(1 << PROC.DENSITY_FLOW, 0.0024);
assert.ok(Math.abs(transported - 0.49988) < 1e-5,
  `density flow must use densityDiffusion rather than energyDiffusion (got ${transported})`);
assert.ok(transported < 0.5,
  'enabled density flow must smooth an isolated high-density cell');
assert.ok([disabled, noMobility, transported].every(Number.isFinite),
  'density flow must preserve finite field values');

console.log('FieldPhysics density mobility/mask/parameter regression: PASS');
