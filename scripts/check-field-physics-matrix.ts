import assert from "node:assert/strict";
import { CELL_FIELDS, F } from "../src/core/CellState.ts";
import { VoxelGrid } from "../src/core/VoxelGrid.ts";
import { DEFAULT_PARAMS, type PhysicsParams } from "../src/laws/MetaLaw.ts";
import { PROC } from "../src/process/ProcessDef.ts";
import { WORLD } from "../src/core/WorldConstants.ts";
import { FieldPhysics } from "../src/simulation/FieldPhysics.ts";
import { EntropyLayer } from "../src/simulation/EntropyLayer.ts";
import { MAT, MATERIAL_LIBRARY } from "../src/materials/MaterialDef.ts";

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
  materialScale: number;
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
    materialScale: MATERIAL_LIBRARY[MAT.VACUUM].conductivity,
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
    materialScale: 1,
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
    materialScale: 1 / Math.max(MATERIAL_LIBRARY[MAT.VACUUM].heatCapacity, 0.1),
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
    materialScale: 1,
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
  const centerBase = grid.idx(1, 1, 1);
  const centerIndex = centerBase + scenario.field;
  grid.buffer[centerBase + F.MATERIAL_ID] = MAT.VACUUM;
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
      const expected = scenario.expected(scenario.amplitude, coefficient * scenario.materialScale, dt);
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

// Gravity is a density-gradient acceleration and must not directly create or destroy density.
function runGravityGradient(
  includeX: boolean, includeZ: boolean, processEnabled = true, rotationEnabled = false,
): { density: number; fx: number; fy: number; fz: number; vx: number; vy: number; vz: number } {
  const grid = new VoxelGrid(3, 3, 3);
  const center = grid.idx(1, 1, 1);
  grid.buffer[center + F.DENSITY] = 0.4;
  if (includeX) grid.buffer[grid.idx(2, 1, 1) + F.DENSITY] = 0.8;
  if (includeZ) grid.buffer[grid.idx(1, 1, 2) + F.DENSITY] = 0.8;
  grid.snapshot();
  const mask = (processEnabled ? (1 << PROC.GRAVITY) : 0)
    | (rotationEnabled ? (1 << PROC.FIELD_ROTATION) : 0);
  new FieldPhysics().tick(grid, 1 / 60, {
    ...DEFAULT_PARAMS,
    gravityDensityCoupling: 0.1,
    fieldRotationDamping: 1,
    fieldRotationNeighborCoupling: 0,
    fieldRotationCrossCoupling: 0,
  }, mask);
  return {
    density: grid.buffer[center + F.DENSITY],
    fx: grid.buffer[center + F.FIELD_X],
    fy: grid.buffer[center + F.FIELD_Y],
    fz: grid.buffer[center + F.FIELD_Z],
    vx: grid.buffer[center + F.VELOCITY_X],
    vy: grid.buffer[center + F.VELOCITY_Y],
    vz: grid.buffer[center + F.VELOCITY_Z],
  };
}
const gravityGradient = runGravityGradient(true, true);
assert.ok(Math.abs(gravityGradient.density - 0.4) < 1e-7,
  "gravity acceleration must not directly modify density (within Float32 precision)");
assert.ok(gravityGradient.fx < 0 && gravityGradient.fz < 0,
  "CPU gravity must update the legacy field vector down both positive density gradients");
assert.ok(gravityGradient.vx < 0 && gravityGradient.vz < 0,
  "CPU gravity must integrate density-gradient acceleration into dedicated velocity");
assert.equal(gravityGradient.vy, 0,
  "zero Y density gradient must not create Y velocity");
assert.equal(gravityGradient.fy, 0,
  "a zero Y density gradient must not create Y acceleration");
const gravityDisabled = runGravityGradient(true, true, false);
assert.equal(gravityDisabled.fx, 0,
  "disabled gravity must leave the field vector unchanged");
assert.equal(gravityDisabled.vx, 0,
  "disabled gravity must leave dedicated velocity unchanged");
const gravityRotated = runGravityGradient(true, false, true, true);
assert.ok(gravityRotated.fx < 0,
  "field rotation must preserve gravity acceleration when both processes are enabled");
assert.ok(gravityRotated.vx < 0,
  "gravity must integrate velocity when field rotation is enabled too");
const gravityBoundaryGrid = new VoxelGrid(3, 3, 3);
gravityBoundaryGrid.buffer[gravityBoundaryGrid.idx(0, 1, 1) + F.DENSITY] = 0.4;
gravityBoundaryGrid.buffer[gravityBoundaryGrid.idx(1, 1, 1) + F.DENSITY] = 0.8;
gravityBoundaryGrid.snapshot();
new FieldPhysics().tick(gravityBoundaryGrid, 1 / 60, {
  ...DEFAULT_PARAMS, gravityDensityCoupling: 0.1,
}, 1 << PROC.GRAVITY);
assert.ok(gravityBoundaryGrid.buffer[gravityBoundaryGrid.idx(0, 1, 1) + F.FIELD_X] < 0,
  "CPU gravity must use a mirrored Neumann boundary instead of creating an edge force toward empty space");

// Density advection is a separate process and must transport mass without clipping it away.
function runDensityAdvection(
  densities: number[], velocities: number[], dt: number, enabled = true,
): number[] {
  const grid = new VoxelGrid(densities.length, 1, 1);
  for (let x = 0; x < densities.length; x++) {
    const base = grid.idx(x, 0, 0);
    grid.buffer[base + F.DENSITY] = densities[x];
    grid.buffer[base + F.VELOCITY_X] = velocities[x];
  }
  grid.snapshot();
  new FieldPhysics().tick(grid, dt, DEFAULT_PARAMS,
    enabled ? (1 << PROC.DENSITY_ADVECTION) : 0);
  return Array.from({ length: densities.length }, (_, x) =>
    grid.buffer[grid.idx(x, 0, 0) + F.DENSITY]);
}
const advected = runDensityAdvection([0.5, 0, 0], [1, 1, 1], 0.25);
assert.ok(Math.abs(advected[0] - 0.375) < 1e-6 &&
  Math.abs(advected[1] - 0.125) < 1e-6,
  `positive X velocity must move density into the downstream cell (got ${advected})`);
assert.ok(Math.abs(advected.reduce((sum, value) => sum + value, 0) - 0.5) < 1e-6,
  "density advection must conserve mass on a closed grid");
assert.deepEqual(runDensityAdvection([0.5, 0, 0], [1, 1, 1], 0.25, false), [0.5, 0, 0],
  "disabled density advection must leave density unchanged");
const limited = runDensityAdvection([0.1, 0.95], [100, 100], 1);
assert.ok(limited.every(value => value >= 0 && value <= 1),
  `flux limiting must keep density within [0,1] (got ${limited})`);
assert.ok(Math.abs(limited[0] + limited[1] - 1.05) < 1e-6,
  "flux limiting must conserve mass when donor and receiver approach their bounds");
assert.ok(Math.abs(limited[1] - 1) < 1e-6,
  "incoming flux limiter must respect the receiver's remaining capacity");
const stationary = runDensityAdvection([0.5, 0], [0, 0], 1);
assert.deepEqual(stationary, [0.5, 0],
  "zero velocity must produce no density transport");
const closedEdge = runDensityAdvection([0.5, 0], [-1, -1], 0.25);
assert.deepEqual(closedEdge, [0.5, 0],
  "world edge must have zero normal flux rather than leaking density");

for (const [axis, field] of [
  [0, F.VELOCITY_X], [1, F.VELOCITY_Y], [2, F.VELOCITY_Z],
] as const) {
  const grid = new VoxelGrid(3, 3, 3);
  const donor = [1, 1, 1] as const;
  const receiver = [1 + (axis === 0 ? 1 : 0), 1 + (axis === 1 ? 1 : 0), 1 + (axis === 2 ? 1 : 0)] as const;
  grid.buffer[grid.idx(...donor) + F.DENSITY] = 0.5;
  grid.buffer[grid.idx(...donor) + field] = 1;
  grid.buffer[grid.idx(...receiver) + field] = 1;
  grid.snapshot();
  new FieldPhysics().tick(grid, 0.25, DEFAULT_PARAMS, 1 << PROC.DENSITY_ADVECTION);
  const donorAfter = grid.buffer[grid.idx(...donor) + F.DENSITY];
  const receiverAfter = grid.buffer[grid.idx(...receiver) + F.DENSITY];
  assert.ok(donorAfter < 0.5 && receiverAfter > 0,
    `density advection must transport along axis ${axis} (donor ${donorAfter}, receiver ${receiverAfter})`);
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

// Material coefficients are part of the canonical diffusion model, not GPU-only hints.
function runMaterialDiffusion(
  materialId: number,
  field: number,
  process: number,
  parameter: "energyDiffusion" | "tempDiffusion",
): number {
  const grid = new VoxelGrid(3, 3, 3);
  const base = grid.idx(1, 1, 1);
  grid.buffer[base + F.MATERIAL_ID] = materialId;
  grid.buffer[base + field] = 100;
  grid.snapshot();
  const params: PhysicsParams = {
    ...DEFAULT_PARAMS,
    energyDiffusion: 0,
    tempDiffusion: 0,
    tempEnergyCoupling: 0,
    [parameter]: 0.01,
  };
  new FieldPhysics().tick(grid, 1 / 60, params, 1 << process);
  return grid.buffer[base + field];
}

for (const materialId of [MAT.VACUUM, MAT.METAL]) {
  const material = MATERIAL_LIBRARY[materialId];
  const energy = runMaterialDiffusion(
    materialId, F.ENERGY, PROC.ENERGY_DIFFUSION, "energyDiffusion",
  );
  const expectedEnergy = 100 - 0.1 * material.conductivity;
  assert.ok(Math.abs(energy - expectedEnergy) < 1e-5,
    `energy diffusion must scale by ${material.name} conductivity (expected ${expectedEnergy}, got ${energy})`);

  const temperature = runMaterialDiffusion(
    materialId, F.TEMPERATURE, PROC.TEMP_DIFFUSION, "tempDiffusion",
  );
  const expectedTemperature = 100 - 0.1 / Math.max(material.heatCapacity, 0.1);
  assert.ok(Math.abs(temperature - expectedTemperature) < 1e-5,
    `thermal diffusion must use inverse ${material.name} heat capacity (expected ${expectedTemperature}, got ${temperature})`);
}


const coupledGrid = new VoxelGrid(3, 3, 3);
const coupledBase = coupledGrid.idx(1, 1, 1);
coupledGrid.buffer[coupledBase + F.MATERIAL_ID] = MAT.METAL;
coupledGrid.buffer[coupledBase + F.ENERGY] = 100;
coupledGrid.snapshot();
new FieldPhysics().tick(coupledGrid, 0.016, {
  ...DEFAULT_PARAMS,
  energyDiffusion: 0.1,
  tempDiffusion: 0,
  tempEnergyCoupling: 0.5,
}, (1 << PROC.ENERGY_DIFFUSION) | (1 << PROC.TEMP_DIFFUSION));
assert.ok(Math.abs(coupledGrid.buffer[coupledBase + F.ENERGY] - 97.12) < 1e-5,
  "metal conductivity must affect energy diffusion during combined thermal coupling");
assert.ok(Math.abs(coupledGrid.buffer[coupledBase + F.TEMPERATURE] - 0.8) < 1e-5,
  "thermal energy coupling must read pre-step energy, not the diffused energy candidate");


const entropyGrid = new VoxelGrid(3, 3, 3);
const entropyBase = entropyGrid.idx(1, 1, 1);
entropyGrid.buffer[entropyBase + F.MATERIAL_ID] = MAT.VACUUM;
entropyGrid.buffer[entropyBase + F.ENERGY] = 100;
entropyGrid.buffer[entropyBase + F.TEMPERATURE] = 100;
entropyGrid.buffer[entropyBase + F.ENTROPY] = 0.2;
entropyGrid.snapshot();
const entropyParams: PhysicsParams = {
  ...DEFAULT_PARAMS,
  energyDiffusion: 0.1,
  tempDiffusion: 0.1,
  tempEnergyCoupling: 0,
  entropyGrowthRate: 0.01,
  entropyEnergyCoupling: 0.001,
};
const entropyMask = (1 << PROC.ENERGY_DIFFUSION) |
  (1 << PROC.TEMP_DIFFUSION) |
  (1 << PROC.ENTROPY_GROWTH);
new FieldPhysics().tick(entropyGrid, 0.016, entropyParams, entropyMask);
new EntropyLayer().tick(entropyGrid, 0.016, entropyParams, entropyMask);
const expectedPostDiffusionEnergy = 99.952;
const expectedPostDiffusionTemperature = 90.4;
const expectedEntropy = 0.2 + (
  entropyParams.entropyGrowthRate
  + expectedPostDiffusionEnergy * entropyParams.entropyEnergyCoupling
  + expectedPostDiffusionTemperature * 0.00005
) * 0.016;
const expectedEntropyEnergy = expectedPostDiffusionEnergy *
  (1 - expectedEntropy * 0.0005 * 0.016 * 60);
assert.ok(Math.abs(entropyGrid.buffer[entropyBase + F.TEMPERATURE] - expectedPostDiffusionTemperature) < 1e-5,
  "CPU thermal diffusion must run before entropy growth");
assert.ok(Math.abs(entropyGrid.buffer[entropyBase + F.ENTROPY] - expectedEntropy) < 1e-5,
  "CPU entropy growth must use the post-diffusion energy and temperature");
assert.ok(Math.abs(entropyGrid.buffer[entropyBase + F.ENERGY] - expectedEntropyEnergy) < 1e-5,
  "CPU entropy attenuation must use the newly integrated entropy");


function runCpuBioMetabolism(
  materialId: number,
  processMask: number,
): { bio: number; energy: number; information: number; entropy: number } {
  const grid = new VoxelGrid(3, 3, 3);
  const base = grid.idx(1, 1, 1);
  grid.buffer[base + F.MATERIAL_ID] = materialId;
  grid.buffer[base + F.ENERGY] = 100;
  grid.buffer[base + F.INFORMATION] = 40;
  grid.buffer[base + F.DENSITY] = 0.5;
  grid.buffer[base + F.ENTROPY] = 0.2;
  grid.buffer[base + F.BIO_POTENTIAL] = 0;
  new EntropyLayer().tick(grid, 1 / 60, {
    ...DEFAULT_PARAMS,
    metabolismRate: 0.6,
  }, processMask);
  return {
    bio: grid.buffer[base + F.BIO_POTENTIAL],
    energy: grid.buffer[base + F.ENERGY],
    information: grid.buffer[base + F.INFORMATION],
    entropy: grid.buffer[base + F.ENTROPY],
  };
}

const bioMask = 1 << PROC.BIO_POTENTIAL;
const metabolismMask = (1 << PROC.BIO_POTENTIAL) | (1 << PROC.METABOLISM);
const organicBio = runCpuBioMetabolism(MAT.ORGANIC_TISSUE, bioMask);
const stoneBio = runCpuBioMetabolism(MAT.STONE, bioMask);
assert.ok(Math.abs(organicBio.bio - 0.67) < 1e-5,
  `CPU Bio-Potential must include organic material affinity (expected 0.67, got ${organicBio.bio})`);
assert.ok(Math.abs(stoneBio.bio - 0.27) < 1e-5,
  `CPU Bio-Potential must include stone material affinity (expected 0.27, got ${stoneBio.bio})`);
const organicMetabolism = runCpuBioMetabolism(MAT.ORGANIC_TISSUE, metabolismMask);
const expectedMetabolismRate = 0.67 * 0.6 / 60;
assert.ok(Math.abs(organicMetabolism.energy - (100 - expectedMetabolismRate * 60)) < 1e-5,
  `CPU metabolism must use PhysicsParams.metabolismRate (got energy ${organicMetabolism.energy})`);
assert.ok(Math.abs(organicMetabolism.information - (40 + expectedMetabolismRate * 25)) < 1e-5,
  `CPU metabolism information output mismatch (got ${organicMetabolism.information})`);
assert.ok(Math.abs(organicMetabolism.entropy - (0.2 + expectedMetabolismRate * 0.008)) < 1e-5,
  `CPU metabolism entropy output mismatch (got ${organicMetabolism.entropy})`);


const localTimeGrid = new VoxelGrid(3, 3, 3);
const localTimeBase = localTimeGrid.idx(1, 1, 1);
localTimeGrid.buffer[localTimeBase + F.ENERGY] = 100;
localTimeGrid.buffer[localTimeBase + F.ENTROPY] = 0.2;
new EntropyLayer().tick(localTimeGrid, 0.016, {
  ...DEFAULT_PARAMS,
  timeBaseRate: 1.5,
  timeEnergyBoost: 0.002,
}, 0);
const expectedLocalTime = 0.016 * 1.5 * (1 + 100 * 0.002 + 0.2 * 0.5);
assert.ok(Math.abs(localTimeGrid.buffer[localTimeBase + F.LOCAL_TIME] - expectedLocalTime) < 1e-6,
  "CPU local time must use the normalized base-rate/energy/entropy formula");

const signalGrid = new VoxelGrid(3, 3, 3);
const signalBase = signalGrid.idx(1, 1, 1);
signalGrid.buffer[signalBase + F.INFORMATION] = 100;
signalGrid.snapshot();
new FieldPhysics().tick(signalGrid, 1 / 60, {
  ...DEFAULT_PARAMS,
  infoGrowthRate: 0.5,
  signalPropagationRate: 0.2,
}, 1 << PROC.SIGNAL_PROPAGATION);
assert.ok(Math.abs(signalGrid.buffer[signalBase + F.INFORMATION] - 99) < 1e-5,
  `CPU signal propagation must use PhysicsParams.signalPropagationRate (got ${signalGrid.buffer[signalBase + F.INFORMATION]})`);


console.log("CPU material bio-affinity/metabolism parameter regression: PASS");

console.log("CPU energy/thermal/entropy operator-order regression: PASS");

console.log("Material-dependent energy/thermal diffusion regression: PASS");

