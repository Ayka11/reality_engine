import assert from 'node:assert/strict';
import { VoxelGrid } from '../src/core/VoxelGrid.ts';
import { F } from '../src/core/CellState.ts';
import { DEFAULT_PARAMS } from '../src/laws/MetaLaw.ts';
import { MAT } from '../src/materials/MaterialDef.ts';
import { PROC } from '../src/process/ProcessDef.ts';
import { FieldPhysics } from '../src/simulation/FieldPhysics.ts';

type ErosionResult = { density: number; information: number };

function runErosion(
  materialId: number,
  flow: number,
  mask: number,
): ErosionResult {
  const grid = new VoxelGrid(3, 3, 3);
  const base = grid.idx(1, 1, 1);
  grid.buffer[base + F.DENSITY] = 0.8;
  grid.buffer[base + F.INFORMATION] = 10;
  grid.buffer[base + F.FIELD_X] = flow;
  grid.buffer[base + F.MATERIAL_ID] = materialId;
  grid.snapshot();

  new FieldPhysics().tick(
    grid,
    1 / 60,
    { ...DEFAULT_PARAMS, erosionRate: 0.01 },
    mask,
  );

  return {
    density: grid.buffer[base + F.DENSITY],
    information: grid.buffer[base + F.INFORMATION],
  };
}

const disabled = runErosion(MAT.SAND, 10, 0);
assert.equal(disabled.density, Math.fround(0.8),
  'disabled erosion must leave density unchanged');
assert.equal(disabled.information, 10,
  'disabled erosion must leave information unchanged');

const belowThreshold = runErosion(MAT.SAND, 1, 1 << PROC.EROSION);
assert.equal(belowThreshold.density, Math.fround(0.8),
  'sub-threshold flow must not erode density');
assert.equal(belowThreshold.information, 10,
  'sub-threshold flow must not remove information');

const sand = runErosion(MAT.SAND, 10, 1 << PROC.EROSION);
const stone = runErosion(MAT.STONE, 10, 1 << PROC.EROSION);
assert.ok(Math.abs(sand.density - 0.792) < 1e-6,
  `sand erosion must use configured erosionRate and resistance (got ${sand.density})`);
assert.ok(Math.abs(stone.density - 0.7975) < 1e-6,
  `stone erosion must reflect higher material resistance (got ${stone.density})`);
assert.ok(sand.density < stone.density,
  'less resistant sand must erode faster than stone');
assert.ok(sand.information < 10 && stone.information < 10,
  'active erosion must apply the documented information reduction');
assert.ok([sand.density, sand.information, stone.density, stone.information].every(Number.isFinite),
  'erosion must preserve finite field values');

console.log('FieldPhysics erosion process/mask/material regression: PASS');
