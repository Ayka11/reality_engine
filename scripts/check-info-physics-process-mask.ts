import assert from 'node:assert/strict';
import { VoxelGrid } from '../src/core/VoxelGrid.ts';
import { F } from '../src/core/CellState.ts';
import { PROC, defaultProcessMask } from '../src/process/ProcessDef.ts';
import { InfoPhysics } from '../src/simulation/InfoPhysics.ts';

function setCell(grid: VoxelGrid, x: number, y: number, z: number, values: Partial<Record<keyof typeof F, number>>) {
  const base = grid.idx(x, y, z);
  for (const [name, value] of Object.entries(values)) {
    const field = F[name as keyof typeof F];
    if (typeof field === 'number' && value !== undefined) grid.buffer[base + field] = value;
  }
}

function cellValues(grid: VoxelGrid, x: number, y: number, z: number) {
  const base = grid.idx(x, y, z);
  return {
    energy: grid.buffer[base + F.ENERGY],
    information: grid.buffer[base + F.INFORMATION],
    entropy: grid.buffer[base + F.ENTROPY],
    memory: grid.buffer[base + F.MEM_FIELD],
  };
}

const grid = new VoxelGrid(3, 3, 3);
setCell(grid, 1, 1, 1, {
  ENERGY: 800,
  INFORMATION: 900,
  ENTROPY: 0.5,
  SIGNAL: 100,
  MEM_FIELD: 0.2,
});
for (const [x, y, z] of [
  [0, 1, 1], [2, 1, 1], [1, 0, 1], [1, 2, 1], [1, 1, 0], [1, 1, 2],
] as const) {
  setCell(grid, x, y, z, { INFORMATION: 900, ENTROPY: 0.5 });
}

const centerIndex = grid.idx(1, 1, 1);
const watchedIndices = [
  centerIndex,
  grid.idx(0, 1, 1), grid.idx(2, 1, 1),
  grid.idx(1, 0, 1), grid.idx(1, 2, 1),
  grid.idx(1, 1, 0), grid.idx(1, 1, 2),
];
const fields = [F.ENERGY, F.INFORMATION, F.ENTROPY, F.MEM_FIELD];
const beforeDisabled = watchedIndices.map(index =>
  fields.map(field => grid.buffer[index + field]),
);
const disabledMask = defaultProcessMask() & ~(1 << PROC.INFORMATION);

new InfoPhysics().tick(grid, 1 / 60, disabledMask);

assert.deepEqual(
  watchedIndices.map(index => fields.map(field => grid.buffer[index + field])),
  beforeDisabled,
  'disabled INFORMATION must leave information, energy, entropy and memory unchanged',
);

// Re-enable information dynamics. The same input must now produce an observable,
// finite change in the intended fields.
new InfoPhysics().tick(grid, 1 / 60, defaultProcessMask());
const afterEnabled = cellValues(grid, 1, 1, 1);
assert.notEqual(afterEnabled.information, beforeDisabled[0][1],
  'enabled INFORMATION must update information');
assert.notEqual(afterEnabled.energy, beforeDisabled[0][0],
  'enabled INFORMATION must permit the high-information energy pathway');
assert.ok([afterEnabled.energy, afterEnabled.information, afterEnabled.entropy, afterEnabled.memory].every(Number.isFinite),
  'information dynamics must preserve finite field values');

console.log('InfoPhysics process-mask invariance regression: PASS');
