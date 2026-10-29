import assert from 'node:assert/strict';
import { VoxelGrid } from '../src/core/VoxelGrid.ts';
import { F } from '../src/core/CellState.ts';
import { DEFAULT_PARAMS } from '../src/laws/MetaLaw.ts';
import { MAT } from '../src/materials/MaterialDef.ts';
import { PROC } from '../src/process/ProcessDef.ts';
import { FieldPhysics } from '../src/simulation/FieldPhysics.ts';

type RadiationResult = { density: number; energy: number };

type RadiationOptions = {
  energy?: number;
  density?: number;
  materialId?: number;
  mask?: number;
  threshold?: number;
  densityRate?: number;
  energyRate?: number;
};

function runRadiation(options: RadiationOptions = {}): RadiationResult {
  const {
    energy = 600,
    density = 0.5,
    materialId = MAT.VACUUM,
    mask = 1 << PROC.RADIATION,
    threshold = 500,
    densityRate = 0.001,
    energyRate = 0.002,
  } = options;
  const grid = new VoxelGrid(3, 3, 3);
  const base = grid.idx(1, 1, 1);
  grid.buffer[base + F.ENERGY] = energy;
  grid.buffer[base + F.DENSITY] = density;
  grid.buffer[base + F.MATERIAL_ID] = materialId;
  grid.snapshot();

  new FieldPhysics().tick(grid, 1 / 60, {
    ...DEFAULT_PARAMS,
    radiationThreshold: threshold,
    radiationDensityRate: densityRate,
    radiationEnergyRate: energyRate,
  }, mask);

  return {
    density: grid.buffer[base + F.DENSITY],
    energy: grid.buffer[base + F.ENERGY],
  };
}

const initial = { density: Math.fround(0.5), energy: Math.fround(600) };

const disabled = runRadiation({ mask: 0 });
assert.equal(disabled.density, initial.density, 'disabled radiation must preserve density');
assert.equal(disabled.energy, initial.energy, 'disabled radiation must preserve energy');

const belowThreshold = runRadiation({ energy: 499 });
assert.equal(belowThreshold.density, Math.fround(0.5), 'below-threshold energy must not affect density');
assert.equal(belowThreshold.energy, Math.fround(499), 'below-threshold energy must not be depleted');

const zeroRates = runRadiation({ densityRate: 0, energyRate: 0 });
assert.equal(zeroRates.density, initial.density, 'zero radiation rates must preserve density');
assert.equal(zeroRates.energy, initial.energy, 'zero radiation rates must preserve energy');

const vacuum = runRadiation({ materialId: MAT.VACUUM });
assert.ok(Math.abs(vacuum.density - 0.4) < 1e-5,
  `vacuum must apply the full configured density response (got ${vacuum.density})`);
assert.ok(Math.abs(vacuum.energy - 599.8) < 1e-3,
  `energy loss must use radiationEnergyRate and configured threshold (got ${vacuum.energy})`);

const stone = runRadiation({ materialId: MAT.STONE });
assert.ok(Math.abs(stone.density - 0.44) < 1e-5,
  `stone's 0.4 absorption must reduce density loss (got ${stone.density})`);
assert.ok(Math.abs(stone.energy - vacuum.energy) < 1e-4,
  'material absorption changes density response only under the shared radiation contract');

const sand = runRadiation({ materialId: MAT.SAND });
assert.ok(Math.abs(sand.density - 0.435) < 1e-5,
  `sand's absorption must affect density loss (got ${sand.density})`);

const clamped = runRadiation({
  energy: 600,
  density: 0.01,
  densityRate: 0.1,
  energyRate: 100,
});
assert.equal(clamped.density, 0, 'radiation density loss must clamp at zero');
assert.equal(clamped.energy, 0, 'radiation energy loss must clamp at zero');

assert.ok([disabled, belowThreshold, zeroRates, vacuum, stone, sand, clamped].every(result =>
  [result.density, result.energy].every(Number.isFinite)),
  'radiation must preserve finite field values');

console.log('FieldPhysics radiation threshold/rates/material/mask regression: PASS');
