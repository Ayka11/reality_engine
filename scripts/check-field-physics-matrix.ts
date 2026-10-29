import assert from "node:assert/strict";
import { CELL_FIELDS, F } from "../src/core/CellState.ts";
import { VoxelGrid } from "../src/core/VoxelGrid.ts";
import { DEFAULT_PARAMS, type PhysicsParams } from "../src/laws/MetaLaw.ts";
import { PROC } from "../src/process/ProcessDef.ts";
import { WORLD } from "../src/core/WorldConstants.ts";
import { FieldPhysics } from "../src/simulation/FieldPhysics.ts";

type DiffusionParameter =
  | "energyDiffusion"
  | "densityDiffusion"
  | "tempDiffusion"
  | "pressureDiffusion";

type Scenario = {
  name: string;
  field: number;
  process: number;
  parameter: DiffusionParameter;
  amplitude: number;
  coefficients: number[];
  expected: (amplitude: number, coefficient: number, dt: number) => number;
  tolerance: number;
  min: number;
  max: number;
};

const commonDiffusion = (amplitude: number, coefficient: number, dt: number) =>
  amplitude - 6 * amplitude * coefficient * dt;

const scenarios: Scenario[] = [
  {
    name: "energy",
    field: F.ENERGY,
    process: PROC.ENERGY_DIFFUSION,
    parameter: "energyDiffusion",
    amplitude: 100,
    coefficients: [0, 0.01, 0.05, 0.1],
    expected: commonDiffusion,
    tolerance: 1e-5,
    min: 0,
    max: WORLD.ENERGY_MAX,
  },
  {
    name: "density",
    field: F.DENSITY,
    process: PROC.DENSITY_FLOW,
    parameter: "densityDiffusion",
    amplitude: 0.5,
    coefficients: [0, 0.0008, 0.0016, 0.0024],
    expected: commonDiffusion,
    tolerance: 1e-6,
    min: 0,
    max: 1,
  },
  {
    name: "temperature",
    field: F.TEMPERATURE,
    process: PROC.TEMP_DIFFUSION,
    parameter: "tempDiffusion",
    amplitude: 100,
    coefficients: [0, 0.01, 0.05, 0.1],
    expected: commonDiffusion,
    tolerance: 1e-5,
    min: 0,
    max: 2000,
  },
  {
    name: "pressure",
    field: F.PRESSURE,
    process: PROC.PRESSURE_DIFFUSION,
    parameter: "pressureDiffusion",
    amplitude: 100,
    coefficients: [0, 0.025, 0.05, 0.1],
    expected: (amplitude, coefficient, dt) =>
      amplitude - 6 * amplitude * coefficient * dt - amplitude * dt,
    tolerance: 1e-4,
    min: -9999,
    max: 9999,
  },
];

const dtValues = [0, 1 / 120, 1 / 60, 1 / 30];

function parametersFor(parameter: DiffusionParameter, coefficient: number): PhysicsParams {
  const params: PhysicsParams = {
    ...DEFAULT_PARAMS,
    energyDiffusion: 0,
    densityDiffusion: 0,
    tempDiffusion: 0,
    tempEnergyCoupling: 0,
    pressureDiffusion: 0,
    pressureDensityCoupling: 0,
    gravityDensityCoupling: 0,
  };
  params[parameter] = coefficient;
  return params;
}

function runCentered(
  scenario: Scenario,
  dt: number,
  coefficient: number,
  mask = 1 << scenario.process,
) {
  const grid = new VoxelGrid(3, 3, 3);
  const centerIndex = grid.idx(1, 1, 1) + scenario.field;
  grid.buffer[centerIndex] = scenario.amplitude;
  grid.snapshot();
  const before = Array.from(grid.buffer);
  const totalBefore = grid.totalField(scenario.field);

  new FieldPhysics().tick(grid, dt, parametersFor(scenario.parameter, coefficient), mask);

  const after = Array.from(grid.buffer);
  const totalAfter = grid.totalField(scenario.field);
  const actual = grid.buffer[centerIndex];
  for (let i = 0; i < after.length; i++) {
    assert.ok(Number.isFinite(after[i]), scenario.name + " diffusion produced a non-finite value at offset " + i);
  }
  for (let cell = 0; cell < grid.size; cell++) {
    const value = after[cell * CELL_FIELDS + scenario.field];
    assert.ok(value >= scenario.min - 1e-6 && value <= scenario.max + 1e-6,
      scenario.name + " left its configured field bounds: " + value);
  }

  return { grid, before, after, actual, totalBefore, totalAfter };
}

for (const scenario of scenarios) {
  const disabled = runCentered(scenario, 1 / 60, scenario.coefficients.at(-1)!, 0);
  assert.deepEqual(disabled.after, disabled.before,
    scenario.name + " changed state while its process bit was disabled");

  const measured = new Map<string, number>();
  for (const dt of dtValues) {
    let previousChange = -Infinity;
    for (const coefficient of scenario.coefficients) {
      const run = runCentered(scenario, dt, coefficient);
      const expected = scenario.expected(scenario.amplitude, coefficient, dt);
      assert.ok(Math.abs(run.actual - expected) <= scenario.tolerance,
        scenario.name + " matrix mismatch: dt=" + dt + ", coefficient=" + coefficient +
        ", expected=" + expected + ", actual=" + run.actual);
      const change = Math.abs(scenario.amplitude - run.actual);
      assert.ok(change + scenario.tolerance >= previousChange,
        scenario.name + " response decreased when the diffusion coefficient increased");
      previousChange = change;
      measured.set(dt + ":" + coefficient, run.actual);
    }
  }

  for (const coefficient of scenario.coefficients) {
    let previousChange = -Infinity;
    for (const dt of dtValues) {
      const actual = measured.get(dt + ":" + coefficient)!;
      const change = Math.abs(scenario.amplitude - actual);
      assert.ok(change + scenario.tolerance >= previousChange,
        scenario.name + " response decreased as dt increased");
      previousChange = change;
    }
  }
}

const densityScenario = scenarios.find(s => s.name === "density")!;
const densityConservation = runCentered(densityScenario, 1 / 60, 0.0024);
assert.ok(Math.abs(densityConservation.totalAfter - densityConservation.totalBefore) < 1e-6,
  "density diffusion failed the closed-grid mass-conservation check");

function replay(): number[] {
  const grid = new VoxelGrid(4, 4, 4);
  const seeded = [
    { x: 1, y: 1, z: 1, energy: 100, density: 0.4, temperature: 100, pressure: 10 },
    { x: 0, y: 1, z: 1, energy: 5, density: 0.1, temperature: 50, pressure: 2 },
    { x: 2, y: 1, z: 1, energy: 8, density: 0.05, temperature: 25, pressure: 1 },
    { x: 1, y: 0, z: 1, energy: 4, density: 0.2, temperature: 20, pressure: 4 },
    { x: 1, y: 2, z: 1, energy: 2, density: 0.08, temperature: 30, pressure: 3 },
    { x: 1, y: 1, z: 0, energy: 9, density: 0.12, temperature: 45, pressure: 6 },
    { x: 1, y: 1, z: 2, energy: 3, density: 0.15, temperature: 35, pressure: 5 },
  ];
  for (const cell of seeded) {
    const base = grid.idx(cell.x, cell.y, cell.z);
    grid.buffer[base + F.ENERGY] = cell.energy;
    grid.buffer[base + F.DENSITY] = cell.density;
    grid.buffer[base + F.TEMPERATURE] = cell.temperature;
    grid.buffer[base + F.PRESSURE] = cell.pressure;
  }
  grid.snapshot();
  const mask =
    (1 << PROC.ENERGY_DIFFUSION) |
    (1 << PROC.DENSITY_FLOW) |
    (1 << PROC.TEMP_DIFFUSION) |
    (1 << PROC.PRESSURE_DIFFUSION);
  new FieldPhysics().tick(grid, 1 / 60, {
    ...DEFAULT_PARAMS,
    energyDiffusion: 0.01,
    densityDiffusion: 0.0016,
    tempDiffusion: 0.05,
    tempEnergyCoupling: 0,
    pressureDiffusion: 0.05,
    pressureDensityCoupling: 50,
  }, mask);
  return Array.from(grid.buffer);
}
assert.deepEqual(replay(), replay(), "CPU FieldPhysics is not deterministic for identical input and process mask");

console.log("FieldPhysics dt/coefficient/process-mask/bounds/conservation/reproducibility matrix: PASS");
