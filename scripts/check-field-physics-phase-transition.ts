import assert from 'node:assert/strict';
import { VoxelGrid } from '../src/core/VoxelGrid.ts';
import { F } from '../src/core/CellState.ts';
import { DEFAULT_PARAMS } from '../src/laws/MetaLaw.ts';
import { PROC } from '../src/process/ProcessDef.ts';
import { FieldPhysics } from '../src/simulation/FieldPhysics.ts';

type Result = { density: number; entropy: number; information: number };

function runPhaseTransition(temperature: number, rate: number, mask = 1 << PROC.PHASE_TRANSITION): Result {
  const grid = new VoxelGrid(3, 3, 3);
  const base = grid.idx(1, 1, 1);
  grid.buffer[base + F.TEMPERATURE] = temperature;
  grid.buffer[base + F.DENSITY] = 0.8;
  grid.buffer[base + F.ENTROPY] = 0.2;
  grid.buffer[base + F.INFORMATION] = 10;
  grid.snapshot();

  new FieldPhysics().tick(
    grid,
    1 / 60,
    { ...DEFAULT_PARAMS, phaseTransitionRate: rate },
    mask,
  );

  return {
    density: grid.buffer[base + F.DENSITY],
    entropy: grid.buffer[base + F.ENTROPY],
    information: grid.buffer[base + F.INFORMATION],
  };
}

const disabled = runPhaseTransition(600, 0, 0);
assert.equal(disabled.density, Math.fround(0.8), 'disabled phase transition must not alter density');
assert.equal(disabled.entropy, Math.fround(0.2), 'disabled phase transition must not alter entropy');

const zeroRate = runPhaseTransition(600, 0);
assert.equal(zeroRate.density, Math.fround(0.8), 'zero phaseTransitionRate must prevent boiling density change');
assert.equal(zeroRate.entropy, Math.fround(0.2), 'zero phaseTransitionRate must prevent boiling entropy change');

const boiling = runPhaseTransition(600, 0.008);
assert.ok(Math.abs(boiling.density - 0.792) < 1e-6, `boiling must use configured rate (got ${boiling.density})`);
assert.ok(Math.abs(boiling.entropy - 0.208) < 1e-6, `boiling entropy must use configured rate (got ${boiling.entropy})`);
assert.ok(Math.abs(boiling.information - 9.95) < 1e-5, 'boiling information reduction must remain unchanged');

const freezing = runPhaseTransition(20, 0.008);
assert.ok(Math.abs(freezing.density - 0.804) < 1e-6, `freezing must use half configured rate (got ${freezing.density})`);
assert.ok(Math.abs(freezing.entropy - 0.196) < 1e-6, `freezing entropy must use half configured rate (got ${freezing.entropy})`);
assert.ok([disabled, zeroRate, boiling, freezing].every(r => [r.density, r.entropy, r.information].every(Number.isFinite)),
  'phase transition must preserve finite values');

console.log('FieldPhysics phase-transition rate/mask regression: PASS');
