import assert from 'node:assert/strict';
import { VoxelGrid } from '../src/core/VoxelGrid.ts';
import { F } from '../src/core/CellState.ts';
import { DEFAULT_PARAMS } from '../src/laws/MetaLaw.ts';
import { PROC } from '../src/process/ProcessDef.ts';
import { FieldPhysics } from '../src/simulation/FieldPhysics.ts';

type FieldVector = { x: number; y: number; z: number };

function runFieldRotation(mask: number, overrides: Partial<typeof DEFAULT_PARAMS> = {}): FieldVector {
  const grid = new VoxelGrid(3, 3, 3);
  const center = grid.idx(1, 1, 1);
  const neighbor = grid.idx(0, 1, 1);
  grid.buffer[center + F.FIELD_X] = 10;
  grid.buffer[center + F.FIELD_Y] = 4;
  grid.buffer[center + F.FIELD_Z] = 5;
  grid.buffer[neighbor + F.FIELD_X] = 2;
  grid.buffer[neighbor + F.FIELD_Y] = 6;
  grid.buffer[neighbor + F.FIELD_Z] = 7;
  grid.snapshot();

  new FieldPhysics().tick(grid, 1 / 60, { ...DEFAULT_PARAMS, ...overrides }, mask);
  return {
    x: grid.buffer[center + F.FIELD_X],
    y: grid.buffer[center + F.FIELD_Y],
    z: grid.buffer[center + F.FIELD_Z],
  };
}

const initial = { x: Math.fround(10), y: Math.fround(4), z: Math.fround(5) };
const disabled = runFieldRotation(0);
assert.deepEqual(disabled, initial,
  'disabled field rotation must not apply the previous unconditional smoothing');

const activeMask = 1 << PROC.FIELD_ROTATION;
const tuned = runFieldRotation(activeMask, {
  fieldRotationDamping: 0.8,
  fieldRotationNeighborCoupling: 0.2,
  fieldRotationCrossCoupling: 0.1,
});
assert.ok(Math.abs(tuned.x - (10 * 0.8 + (2 / 6) * 0.2 + 4 * 0.1)) < 1e-5,
  `fieldRotationDamping/neighbor/cross parameters must control X (got ${tuned.x})`);
assert.ok(Math.abs(tuned.y - (4 * 0.8 + (6 / 6) * 0.2 - 10 * 0.1)) < 1e-5,
  `field rotation parameters must control Y (got ${tuned.y})`);
assert.ok(Math.abs(tuned.z - (5 * 0.8 + (7 / 6) * 0.2)) < 1e-5,
  `field rotation parameters must control Z (got ${tuned.z})`);

const zeroed = runFieldRotation(activeMask, {
  fieldRotationDamping: 0,
  fieldRotationNeighborCoupling: 0,
  fieldRotationCrossCoupling: 0,
});
assert.deepEqual(zeroed, { x: 0, y: 0, z: 0 },
  'zero coefficients must eliminate field-rotation output');

assert.ok([disabled, tuned, zeroed].every(v => [v.x, v.y, v.z].every(Number.isFinite)),
  'field rotation must preserve finite vector fields');

console.log('FieldPhysics field-rotation mask/parameter regression: PASS');
